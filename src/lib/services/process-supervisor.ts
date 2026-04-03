import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { parseCommand } from '@/lib/utils/exec-helpers';

export type ProcessTerminationReason =
  | 'manual-cancel'
  | 'overall-timeout'
  | 'no-output-timeout'
  | 'spawn-error'
  | 'signal'
  | 'exit';

export type ProcessSessionStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export type PtyBackendKind = 'native' | 'fallback';

export interface SpawnChildInput {
  mode: 'child';
  argv: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  stdinMode?: 'inherit' | 'pipe-open' | 'pipe-closed';
  windowsVerbatimArguments?: boolean;
}

export interface SpawnPtyInput {
  mode: 'pty';
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  cols?: number;
  rows?: number;
  forceFallback?: boolean;
}

export type SpawnInput = SpawnChildInput | SpawnPtyInput;

export interface SpawnSessionRequest {
  agentId: string;
  taskId?: string;
  tier?: string;
  launchMode: 'child' | 'pty';
  bufferSize: number;
  sessionTimeoutMs?: number;
  noOutputTimeoutMs?: number;
  spawn: SpawnInput;
}

export interface ProcessSessionSnapshot {
  sessionId: string;
  agentId: string;
  taskId?: string;
  tier?: string;
  launchMode: 'child' | 'pty';
  status: ProcessSessionStatus;
  pid?: number;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: string | number | null;
  reason?: ProcessTerminationReason;
  totalOutputChars: number;
  droppedOutputChars: number;
}

export interface ProcessSessionResult extends ProcessSessionSnapshot {
  stdout: string;
  stderr: string;
}

export interface ProcessSessionOutputWindow {
  sessionId: string;
  status: ProcessSessionStatus;
  reason?: ProcessTerminationReason;
  output: string;
  nextOffset: number;
  totalOutputChars: number;
  droppedOutputChars: number;
  truncatedBeforeOffset: boolean;
}

interface SessionInputWriter {
  write(data: string): void;
  end(): void;
  destroyed?: boolean;
}

interface SpawnedSessionProcess {
  pid?: number;
  stdin?: SessionInputWriter;
  ptyBackend?: PtyBackendKind;
  onSpawn(listener: () => void): void;
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  onError(listener: (error: Error) => void): void;
  onClose(listener: (outcome: { exitCode: number | null; signal: string | number | null }) => void): void;
  terminate(graceMs: number): void;
}

interface InternalSession {
  sessionId: string;
  agentId: string;
  taskId?: string;
  tier?: string;
  launchMode: 'child' | 'pty';
  status: ProcessSessionStatus;
  pid?: number;
  startedAt: Date;
  endedAt?: Date;
  exitCode?: number | null;
  signal?: string | number | null;
  reason?: ProcessTerminationReason;
  totalOutputChars: number;
  droppedOutputChars: number;
  stdout: string;
  stderr: string;
  mergedOutput: string;
  waitPromise: Promise<ProcessSessionResult>;
  resolveWait: (value: ProcessSessionResult) => void;
  rejectWait: (reason?: unknown) => void;
  stdin?: SessionInputWriter;
  process?: SpawnedSessionProcess;
  ptyBackend?: PtyBackendKind;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  noOutputTimer?: ReturnType<typeof setTimeout>;
  forcedReason?: ProcessTerminationReason;
  settled: boolean;
  bufferSize: number;
}

type NativePtyModule = typeof import('@lydell/node-pty');
type NativePtyLoader = () => Promise<NativePtyModule> | NativePtyModule;

interface PtyShellResolution {
  name: string;
  path: string;
  args: string[];
}

const DEFAULT_FORCE_KILL_WAIT_FALLBACK_MS = 4000;
const DEFAULT_TERMINATION_GRACE_MS = 3000;
const MAX_LOG_WINDOW = 20000;
const DEFAULT_PTY_COLS = 120;
const DEFAULT_PTY_ROWS = 30;

const defaultNativePtyLoader: NativePtyLoader = () => import('@lydell/node-pty');

let nativePtyLoader: NativePtyLoader = defaultNativePtyLoader;
let platformOverrideForTests: NodeJS.Platform | undefined;

function getPlatform(): NodeJS.Platform {
  return platformOverrideForTests ?? process.platform;
}

function clampPositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.max(1, Math.floor(value));
}

function toStringEnv(env?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(env ?? {}).filter(([, value]) => value !== undefined),
    ),
  } as NodeJS.ProcessEnv;
}

function appendMergedOutput(session: InternalSession, chunk: string): void {
  if (!chunk) {
    return;
  }

  session.totalOutputChars += chunk.length;
  session.mergedOutput += chunk;

  if (session.mergedOutput.length > session.bufferSize) {
    const trimAmount = session.mergedOutput.length - session.bufferSize;
    session.mergedOutput = session.mergedOutput.slice(trimAmount);
    session.droppedOutputChars += trimAmount;
  }
}

function buildSnapshot(session: InternalSession): ProcessSessionSnapshot {
  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
    taskId: session.taskId,
    tier: session.tier,
    launchMode: session.launchMode,
    status: session.status,
    pid: session.pid,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString(),
    exitCode: session.exitCode,
    signal: session.signal,
    reason: session.reason,
    totalOutputChars: session.totalOutputChars,
    droppedOutputChars: session.droppedOutputChars,
  };
}

function buildResult(session: InternalSession): ProcessSessionResult {
  return {
    ...buildSnapshot(session),
    stdout: session.stdout,
    stderr: session.stderr,
  };
}

function mapFinalStatus(reason: ProcessTerminationReason, exitCode: number | null | undefined): ProcessSessionStatus {
  switch (reason) {
    case 'manual-cancel':
      return 'cancelled';
    case 'overall-timeout':
    case 'no-output-timeout':
      return 'timed_out';
    case 'spawn-error':
    case 'signal':
      return 'failed';
    case 'exit':
      return exitCode === 0 ? 'completed' : 'failed';
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTreeUnix(pid: number, graceMs: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  setTimeout(() => {
    try {
      if (isProcessAlive(-pid)) {
        process.kill(-pid, 'SIGKILL');
        return;
      }
    } catch {
      // Fall back to direct pid kill below.
    }

    try {
      if (isProcessAlive(pid)) {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // Process already exited.
    }
  }, graceMs).unref();
}

function runTaskkill(args: string[]): void {
  spawn('taskkill', args, {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  }).unref();
}

function killProcessTreeWindows(pid: number, graceMs: number): void {
  runTaskkill(['/T', '/PID', String(pid)]);
  setTimeout(() => {
    if (!isProcessAlive(pid)) {
      return;
    }
    runTaskkill(['/F', '/T', '/PID', String(pid)]);
  }, graceMs).unref();
}

function killProcessTree(pid: number, graceMs: number): void {
  if (getPlatform() === 'win32') {
    killProcessTreeWindows(pid, graceMs);
    return;
  }

  killProcessTreeUnix(pid, graceMs);
}

function findExecutable(name: string): string | undefined {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) {
      continue;
    }

    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching.
    }
  }

  return undefined;
}

function resolvePtyShell(): PtyShellResolution {
  const configuredShell = process.env.SHELL?.trim();
  const configuredShellName = configuredShell ? path.basename(configuredShell) : undefined;
  const configuredShellExists = configuredShell && fs.existsSync(configuredShell);

  if (configuredShellName === 'fish') {
    const compatibleShell = findExecutable('bash') ?? findExecutable('sh');
    if (compatibleShell) {
      return {
        name: path.basename(compatibleShell),
        path: compatibleShell,
        args: ['-lc'],
      };
    }
  }

  if (configuredShell && configuredShellExists) {
    return {
      name: path.basename(configuredShell),
      path: configuredShell,
      args: ['-lc'],
    };
  }

  const fallbackShell = findExecutable(configuredShellName || '') ?? findExecutable('bash') ?? findExecutable('sh');
  if (fallbackShell) {
    return {
      name: path.basename(fallbackShell),
      path: fallbackShell,
      args: ['-lc'],
    };
  }

  return {
    name: 'sh',
    path: '/bin/sh',
    args: ['-lc'],
  };
}

function wrapPtyCommand(command: string, shellName: string): string {
  if (shellName === 'zsh') {
    return `setopt nonomatch; ${command}`;
  }

  return command;
}

function shellJoinArgv(argv: string[]): string {
  return argv.map(shellQuoteArg).join(' ');
}

function shellQuoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolvePtyCommand(command: string): {
  file: string;
  args: string[];
  fallbackWrapperCommand: string;
} {
  const parsed = parseCommand(command);
  if (!('error' in parsed)) {
    return {
      file: parsed.binary,
      args: parsed.args,
      fallbackWrapperCommand: shellJoinArgv([parsed.binary, ...parsed.args]),
    };
  }

  const shell = resolvePtyShell();
  const wrappedCommand = wrapPtyCommand(command, shell.name);
  const args = [...shell.args, wrappedCommand];

  return {
    file: shell.path,
    args,
    fallbackWrapperCommand: shellJoinArgv([shell.path, ...args]),
  };
}

function createChildProcess(input: SpawnChildInput): ChildProcess {
  if (input.argv.length === 0) {
    throw new Error('argv cannot be empty');
  }

  const stdinMode = input.stdinMode ?? 'pipe-open';
  const stdio: ['inherit' | 'pipe' | 'ignore', 'pipe', 'pipe'] = [
    stdinMode === 'inherit' ? 'inherit' : stdinMode === 'pipe-closed' ? 'ignore' : 'pipe',
    'pipe',
    'pipe',
  ];

  return spawn(input.argv[0]!, input.argv.slice(1), {
    cwd: input.cwd,
    env: toStringEnv(input.env),
    detached: getPlatform() !== 'win32',
    stdio,
    windowsVerbatimArguments: input.windowsVerbatimArguments,
  });
}

function adaptChildProcess(child: ChildProcess, ptyBackend?: PtyBackendKind): SpawnedSessionProcess {
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');

  return {
    pid: child.pid ?? undefined,
    stdin: child.stdin
      ? {
          write: (data: string) => {
            if (!child.stdin || child.stdin.destroyed) {
              return;
            }
            child.stdin.write(data);
          },
          end: () => {
            if (!child.stdin || child.stdin.destroyed) {
              return;
            }
            child.stdin.end();
          },
          get destroyed() {
            return child.stdin?.destroyed;
          },
        }
      : undefined,
    ptyBackend,
    onSpawn: (listener) => {
      child.once('spawn', listener);
    },
    onStdout: (listener) => {
      child.stdout?.on('data', listener);
    },
    onStderr: (listener) => {
      child.stderr?.on('data', listener);
    },
    onError: (listener) => {
      child.once('error', listener);
    },
    onClose: (listener) => {
      child.once('close', (exitCode, signal) => {
        listener({
          exitCode,
          signal,
        });
      });
    },
    terminate: (graceMs) => {
      if (child.pid) {
        killProcessTree(child.pid, graceMs);
        return;
      }

      try {
        child.kill('SIGTERM');
      } catch {
        // Process may already be gone.
      }
    },
  };
}

function createPtyWrapperProcess(input: SpawnPtyInput): SpawnedSessionProcess {
  if (getPlatform() === 'win32') {
    throw new Error('Unix PTY fallback is not supported on Windows in this build');
  }

  const cols = clampPositiveInt(input.cols) ?? DEFAULT_PTY_COLS;
  const rows = clampPositiveInt(input.rows) ?? DEFAULT_PTY_ROWS;
  const env = {
    ...toStringEnv(input.env),
    TERM: input.env?.TERM ?? 'xterm-256color',
    COLUMNS: String(cols),
    LINES: String(rows),
  };

  const scriptPath = findExecutable('script');
  if (!scriptPath) {
    throw new Error('Unix PTY fallback requires the `script` binary to be available on PATH');
  }

  const resolvedCommand = resolvePtyCommand(input.command);

  const child = spawn(scriptPath, ['-qefc', resolvedCommand.fallbackWrapperCommand, '/dev/null'], {
    cwd: input.cwd,
    env,
    detached: getPlatform() !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return adaptChildProcess(child, 'fallback');
}

async function createNativePtyProcess(input: SpawnPtyInput): Promise<SpawnedSessionProcess> {
  if (getPlatform() === 'win32') {
    throw new Error('Native PTY backend is not supported on Windows in this build');
  }

  const nativePty = await Promise.resolve(nativePtyLoader());
  const cols = clampPositiveInt(input.cols) ?? DEFAULT_PTY_COLS;
  const rows = clampPositiveInt(input.rows) ?? DEFAULT_PTY_ROWS;
  const env = {
    ...toStringEnv(input.env),
    TERM: input.env?.TERM ?? 'xterm-256color',
    COLUMNS: String(cols),
    LINES: String(rows),
  };
  const resolvedCommand = resolvePtyCommand(input.command);

  let closed = false;
  let closeOutcome: { exitCode: number | null; signal: string | number | null } | null = null;
  const closeListeners = new Set<(outcome: { exitCode: number | null; signal: string | number | null }) => void>();
  const stdoutListeners = new Set<(chunk: string) => void>();
  const bufferedStdoutChunks: string[] = [];

  let ptyProcess: NativePtyModule['spawn'] extends (...args: any[]) => infer T ? T : never;
  try {
    ptyProcess = nativePty.spawn(resolvedCommand.file, resolvedCommand.args, {
      name: env.TERM ?? 'xterm-256color',
      cols,
      rows,
      cwd: input.cwd,
      env,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  ptyProcess.onData((data: string) => {
    if (stdoutListeners.size === 0) {
      bufferedStdoutChunks.push(data);
      return;
    }

    for (const listener of stdoutListeners) {
      listener(data);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    closed = true;
    closeOutcome = {
      exitCode,
      signal: exitCode !== null ? null : signal ?? null,
    };

    for (const listener of closeListeners) {
      listener(closeOutcome);
    }
    closeListeners.clear();
  });

  return {
    pid: ptyProcess.pid ?? undefined,
    stdin: {
      write: (data: string) => {
        if (closed) {
          return;
        }
        ptyProcess.write(data);
      },
      end: () => {
        if (closed) {
          return;
        }
        ptyProcess.write('\x04');
      },
      get destroyed() {
        return closed;
      },
    },
    ptyBackend: 'native',
    onSpawn: (listener) => {
      queueMicrotask(listener);
    },
    onStdout: (listener) => {
      stdoutListeners.add(listener);
      if (bufferedStdoutChunks.length > 0) {
        for (const chunk of bufferedStdoutChunks) {
          listener(chunk);
        }
        bufferedStdoutChunks.length = 0;
      }
    },
    onStderr: () => {
      // Native PTY output is merged into the terminal stream.
    },
    onError: () => {
      // node-pty surfaces initialization errors synchronously; runtime output is delivered via onData/onExit.
    },
    onClose: (listener) => {
      if (closeOutcome) {
        listener(closeOutcome);
        return;
      }

      closeListeners.add(listener);
    },
    terminate: (graceMs) => {
      if (closed) {
        return;
      }

      try {
        ptyProcess.kill('SIGTERM');
      } catch {
        // Best effort only.
      }

      if (ptyProcess.pid) {
        killProcessTree(ptyProcess.pid, graceMs);
        return;
      }

      setTimeout(() => {
        if (closed) {
          return;
        }

        try {
          ptyProcess.kill('SIGKILL');
        } catch {
          // Best effort only.
        }
      }, graceMs).unref();
    },
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createPreferredPtyProcess(sessionId: string, input: SpawnPtyInput): Promise<SpawnedSessionProcess> {
  if (input.forceFallback) {
    console.warn(`[ProcessSupervisor] PTY native backend disabled by runtime.exec.forcePtyFallback; using fallback backend for session ${sessionId}`);

    try {
      const fallback = createPtyWrapperProcess(input);
      console.info(`[ProcessSupervisor] PTY backend selected: fallback for session ${sessionId}`);
      return fallback;
    } catch (error) {
      throw new Error(
        `No supported PTY backend available: forced fallback is enabled and the Unix wrapper backend is unavailable (${formatErrorMessage(error)})`,
      );
    }
  }

  try {
    const nativeProcess = await createNativePtyProcess(input);
    console.info(`[ProcessSupervisor] PTY backend selected: native for session ${sessionId}`);
    return nativeProcess;
  } catch (nativeError) {
    const nativeMessage = formatErrorMessage(nativeError);

    try {
      const fallback = createPtyWrapperProcess(input);
      console.warn(`[ProcessSupervisor] Native PTY backend unavailable for session ${sessionId}: ${nativeMessage}. Falling back to the Unix wrapper backend.`);
      console.info(`[ProcessSupervisor] PTY backend selected: fallback for session ${sessionId}`);
      return fallback;
    } catch (fallbackError) {
      throw new Error(
        `No supported PTY backend available: native PTY failed (${nativeMessage}); fallback wrapper failed (${formatErrorMessage(fallbackError)})`,
      );
    }
  }
}

async function createSessionProcess(sessionId: string, input: SpawnInput): Promise<SpawnedSessionProcess> {
  if (input.mode === 'pty') {
    return createPreferredPtyProcess(sessionId, input);
  }

  return adaptChildProcess(createChildProcess(input));
}

class ProcessSupervisor {
  private readonly sessions = new Map<string, InternalSession>();

  async spawnSession(request: SpawnSessionRequest): Promise<ProcessSessionSnapshot> {
    const sessionId = `exec_${randomUUID()}`;
    const wait = Promise.withResolvers<ProcessSessionResult>();

    const session: InternalSession = {
      sessionId,
      agentId: request.agentId,
      taskId: request.taskId,
      tier: request.tier,
      launchMode: request.launchMode,
      status: 'starting',
      startedAt: new Date(),
      totalOutputChars: 0,
      droppedOutputChars: 0,
      stdout: '',
      stderr: '',
      mergedOutput: '',
      waitPromise: wait.promise,
      resolveWait: wait.resolve,
      rejectWait: wait.reject,
      settled: false,
      bufferSize: Math.max(1, Math.floor(request.bufferSize)),
    };

    this.sessions.set(sessionId, session);

    const timeoutMs = clampPositiveInt(request.sessionTimeoutMs ?? request.spawn.timeoutMs);
    const noOutputTimeoutMs = clampPositiveInt(request.noOutputTimeoutMs ?? request.spawn.noOutputTimeoutMs);

    try {
      const processHandle = await createSessionProcess(sessionId, request.spawn);

      session.process = processHandle;
      session.pid = processHandle.pid;
      session.stdin = processHandle.stdin;
      session.ptyBackend = processHandle.ptyBackend;

      const touchOutput = () => {
        if (!noOutputTimeoutMs || session.settled) {
          return;
        }

        if (session.noOutputTimer) {
          clearTimeout(session.noOutputTimer);
        }

        session.noOutputTimer = setTimeout(() => {
          this.requestCancel(sessionId, 'no-output-timeout');
        }, noOutputTimeoutMs);
      };

      if (timeoutMs) {
        session.timeoutTimer = setTimeout(() => {
          this.requestCancel(sessionId, 'overall-timeout');
        }, timeoutMs);
      }

      if (noOutputTimeoutMs) {
        touchOutput();
      }

      processHandle.onStdout((chunk: string) => {
        session.stdout += chunk;
        appendMergedOutput(session, chunk);
        touchOutput();
      });

      processHandle.onStderr((chunk: string) => {
        session.stderr += chunk;
        appendMergedOutput(session, chunk);
        touchOutput();
      });

      processHandle.onSpawn(() => {
        if (session.settled) {
          return;
        }
        session.status = 'running';
      });

      processHandle.onError((error) => {
        session.stderr += error.message;
        appendMergedOutput(session, error.message);
        this.finalizeSession(sessionId, {
          exitCode: null,
          signal: null,
          reason: 'spawn-error',
        });
      });

      processHandle.onClose(({ exitCode, signal }) => {
        this.finalizeSession(sessionId, {
          exitCode,
          signal,
          reason: session.forcedReason ?? (signal ? 'signal' : 'exit'),
        });
      });

      if (request.spawn.mode === 'pty') {
        setTimeout(() => {
          if (session.settled || session.forcedReason !== 'manual-cancel') {
            return;
          }
          this.finalizeSession(sessionId, {
            exitCode: null,
            signal: 'SIGKILL',
            reason: 'manual-cancel',
          });
        }, DEFAULT_FORCE_KILL_WAIT_FALLBACK_MS).unref();
      }

      return buildSnapshot(session);
    } catch (error) {
      session.stderr += formatErrorMessage(error);
      appendMergedOutput(session, session.stderr);
      this.finalizeSession(sessionId, {
        exitCode: null,
        signal: null,
        reason: 'spawn-error',
      });
      return buildSnapshot(session);
    }
  }

  async waitForSession(sessionId: string, timeoutMs?: number): Promise<ProcessSessionResult | null> {
    const session = this.requireSession(sessionId);
    if (timeoutMs === undefined) {
      return session.waitPromise;
    }

    return Promise.race([
      session.waitPromise,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs).unref();
      }),
    ]);
  }

  listSessions(agentId?: string): ProcessSessionSnapshot[] {
    return Array.from(this.sessions.values())
      .filter(session => !agentId || session.agentId === agentId)
      .map(buildSnapshot)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  getSessionSnapshot(sessionId: string): ProcessSessionSnapshot {
    return buildSnapshot(this.requireSession(sessionId));
  }

  getPtyBackendForSession(sessionId: string): PtyBackendKind | null {
    return this.requireSession(sessionId).ptyBackend ?? null;
  }

  pollSession(sessionId: string, offset = 0, limit = 4000): ProcessSessionOutputWindow {
    return this.readOutputWindow(sessionId, offset, limit);
  }

  readSessionLog(sessionId: string, offset = 0, limit = 4000): ProcessSessionOutputWindow {
    return this.readOutputWindow(sessionId, offset, limit);
  }

  writeSession(sessionId: string, data: string): ProcessSessionSnapshot {
    const session = this.requireSession(sessionId);

    if (session.launchMode !== 'pty') {
      throw new Error(`Process session ${sessionId} does not accept PTY input`);
    }

    if (session.status !== 'running') {
      throw new Error(`Process session ${sessionId} is not running`);
    }

    if (!session.stdin || session.stdin.destroyed) {
      throw new Error(`Process session ${sessionId} does not have a writable input stream`);
    }

    session.stdin.write(data);
    return buildSnapshot(session);
  }

  killSession(sessionId: string): ProcessSessionSnapshot {
    this.requestCancel(sessionId, 'manual-cancel');
    return buildSnapshot(this.requireSession(sessionId));
  }

  setNativePtyModuleLoaderForTests(loader?: NativePtyLoader): void {
    nativePtyLoader = loader ?? defaultNativePtyLoader;
  }

  setPlatformForTests(platform?: NodeJS.Platform): void {
    platformOverrideForTests = platform;
  }

  resetPtyBackendForTests(): void {
    nativePtyLoader = defaultNativePtyLoader;
    platformOverrideForTests = undefined;
  }

  resetForTests(): void {
    for (const sessionId of this.sessions.keys()) {
      try {
        this.requestCancel(sessionId, 'manual-cancel');
      } catch {
        // Best effort cleanup only.
      }
    }
    this.sessions.clear();
    this.resetPtyBackendForTests();
  }

  private readOutputWindow(sessionId: string, offset = 0, limit = 4000): ProcessSessionOutputWindow {
    const session = this.requireSession(sessionId);
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.min(MAX_LOG_WINDOW, Math.max(1, Math.floor(limit)));
    const bufferStartOffset = session.droppedOutputChars;
    const totalOutputChars = session.totalOutputChars;
    const effectiveOffset = Math.max(safeOffset, bufferStartOffset);
    const startIndex = effectiveOffset - bufferStartOffset;
    const output = session.mergedOutput.slice(startIndex, startIndex + safeLimit);

    return {
      sessionId,
      status: session.status,
      reason: session.reason,
      output,
      nextOffset: effectiveOffset + output.length,
      totalOutputChars,
      droppedOutputChars: session.droppedOutputChars,
      truncatedBeforeOffset: safeOffset < bufferStartOffset,
    };
  }

  private requestCancel(sessionId: string, reason: ProcessTerminationReason): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.settled) {
      return;
    }

    session.forcedReason = reason;

    if (session.process) {
      session.process.terminate(DEFAULT_TERMINATION_GRACE_MS);
      return;
    }

    this.finalizeSession(sessionId, {
      exitCode: null,
      signal: null,
      reason,
    });
  }

  private finalizeSession(
    sessionId: string,
    outcome: {
      exitCode: number | null;
      signal: string | number | null;
      reason: ProcessTerminationReason;
    },
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.settled) {
      return;
    }

    session.settled = true;
    session.endedAt = new Date();
    session.exitCode = outcome.exitCode;
    session.signal = outcome.signal;
    session.reason = outcome.reason;
    session.status = mapFinalStatus(outcome.reason, outcome.exitCode);

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
    }
    if (session.noOutputTimer) {
      clearTimeout(session.noOutputTimer);
    }

    session.resolveWait(buildResult(session));
  }

  private requireSession(sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Process session not found: ${sessionId}`);
    }
    return session;
  }
}

export const processSupervisor = new ProcessSupervisor();
