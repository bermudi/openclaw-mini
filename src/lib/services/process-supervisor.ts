import { randomUUID } from 'crypto';
import { spawn, type ChildProcess } from 'child_process';

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
  stdin?: {
    write(data: string): void;
    end(): void;
    destroyed?: boolean;
  };
  child?: ChildProcess;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  noOutputTimer?: ReturnType<typeof setTimeout>;
  forcedReason?: ProcessTerminationReason;
  settled: boolean;
  bufferSize: number;
}

const DEFAULT_FORCE_KILL_WAIT_FALLBACK_MS = 4000;
const DEFAULT_TERMINATION_GRACE_MS = 3000;
const MAX_LOG_WINDOW = 20000;

function clampPositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.max(1, Math.floor(value));
}

function toStringEnv(env?: Record<string, string | undefined>): Record<string, string> {
  if (!env) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
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
  if (process.platform === 'win32') {
    killProcessTreeWindows(pid, graceMs);
    return;
  }

  killProcessTreeUnix(pid, graceMs);
}

function createPtyWrapperProcess(input: SpawnPtyInput): ChildProcess {
  if (process.platform === 'win32') {
    throw new Error('PTY launch mode is not supported on Windows in this build');
  }

  const cols = clampPositiveInt(input.cols) ?? 120;
  const rows = clampPositiveInt(input.rows) ?? 30;
  const env = {
    ...toStringEnv(input.env),
    TERM: input.env?.TERM ?? 'xterm-256color',
    COLUMNS: String(cols),
    LINES: String(rows),
  };

  return spawn('script', ['-qefc', input.command, '/dev/null'], {
    cwd: input.cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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
    detached: process.platform !== 'win32',
    stdio,
    windowsVerbatimArguments: input.windowsVerbatimArguments,
  });
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
      const child = request.spawn.mode === 'pty'
        ? createPtyWrapperProcess(request.spawn)
        : createChildProcess(request.spawn);

      session.child = child;
      session.pid = child.pid ?? undefined;
      session.stdin = child.stdin
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
        : undefined;

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

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');

      child.stdout?.on('data', (chunk: string) => {
        session.stdout += chunk;
        appendMergedOutput(session, chunk);
        touchOutput();
      });

      child.stderr?.on('data', (chunk: string) => {
        session.stderr += chunk;
        appendMergedOutput(session, chunk);
        touchOutput();
      });

      child.once('spawn', () => {
        session.status = 'running';
      });

      child.once('error', (error) => {
        session.stderr += error.message;
        appendMergedOutput(session, error.message);
        this.finalizeSession(sessionId, {
          exitCode: null,
          signal: null,
          reason: 'spawn-error',
        });
      });

      child.once('close', (code, signal) => {
        this.finalizeSession(sessionId, {
          exitCode: code,
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
      session.stderr += error instanceof Error ? error.message : String(error);
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

  resetForTests(): void {
    for (const sessionId of this.sessions.keys()) {
      try {
        this.requestCancel(sessionId, 'manual-cancel');
      } catch {
        // Best effort cleanup only.
      }
    }
    this.sessions.clear();
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
    const session = this.requireSession(sessionId);
    if (session.settled) {
      return;
    }

    session.forcedReason = reason;

    if (session.child?.pid) {
      killProcessTree(session.child.pid, DEFAULT_TERMINATION_GRACE_MS);
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
