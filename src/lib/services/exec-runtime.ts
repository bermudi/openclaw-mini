import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  ContainerRuntime,
  ExecLaunchMode,
  ExecMountPermission,
  ExecTier,
} from '@/lib/config/schema';
import { getBinaryBasename, parseCommand } from '@/lib/utils/exec-helpers';
import {
  getSandboxDir,
  getSandboxOutputDir,
} from '@/lib/services/sandbox-service';
import type { SpawnInput } from '@/lib/services/process-supervisor';

export type ExecCommandMode = 'direct' | 'shell';

export interface ResolvedExecMount {
  alias: string;
  hostPath: string;
  normalizedHostPath: string;
  permissions: ExecMountPermission;
  createIfMissing: boolean;
  containerPath: string;
  implicit: boolean;
}

export interface ExecWorkingDirectory {
  requested?: string;
  scope: 'sandbox' | 'mount';
  mountAlias: string;
  hostPath: string;
  containerPath: string;
}

export interface ExecStartupDiagnostics {
  enabled: boolean;
  defaultTier: ExecTier;
  maxTier: ExecTier;
  containerRuntime: ContainerRuntime | null;
  defaultTierRequiresContainer: boolean;
  defaultTierViable: boolean;
  messages: string[];
}

export interface PreparedExecLaunch {
  tier: ExecTier;
  launchMode: ExecLaunchMode;
  commandMode: ExecCommandMode;
  mounts: ResolvedExecMount[];
  workingDirectory: ExecWorkingDirectory;
  spawn: SpawnInput;
}

export interface BuildExecLaunchInput {
  agentId: string;
  command: string;
  tier: ExecTier;
  launchMode: ExecLaunchMode;
  commandMode: ExecCommandMode;
  cwd?: string;
  allowlist: string[];
  mounts?: Array<{
    alias: string;
    hostPath: string;
    permissions: ExecMountPermission;
    createIfMissing: boolean;
  }>;
  containerRuntime: ContainerRuntime | null;
  timeoutMs: number;
  ptyCols: number;
  ptyRows: number;
}

export interface SurfaceExecFileResult {
  sourcePath: string;
  surfacedPath: string;
}

export const DEFAULT_EXEC_CONTAINER_IMAGE = 'docker.io/library/ubuntu:24.04';

const EXEC_TIER_RANK: Record<ExecTier, number> = {
  'locked-down': 0,
  sandbox: 1,
  host: 2,
};

let detectedContainerRuntimeOverride: ContainerRuntime | null | undefined;
let detectedContainerRuntimeCache: ContainerRuntime | null | undefined;

export function resetExecRuntimeStateForTests(): void {
  detectedContainerRuntimeOverride = undefined;
  detectedContainerRuntimeCache = undefined;
}

export function setDetectedContainerRuntimeForTests(runtime: ContainerRuntime | null | undefined): void {
  detectedContainerRuntimeOverride = runtime;
  detectedContainerRuntimeCache = undefined;
}

export function compareExecTiers(left: ExecTier, right: ExecTier): number {
  return EXEC_TIER_RANK[left] - EXEC_TIER_RANK[right];
}

export function isExecTierAllowed(requestedTier: ExecTier, maxTier: ExecTier): boolean {
  return compareExecTiers(requestedTier, maxTier) <= 0;
}

function isContainerRuntimeAvailable(candidate: ContainerRuntime): boolean {
  if (detectedContainerRuntimeOverride !== undefined) {
    return detectedContainerRuntimeOverride === candidate;
  }

  try {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

export function detectContainerRuntime(configuredRuntime?: ContainerRuntime | null): ContainerRuntime | null {
  if (configuredRuntime) {
    return isContainerRuntimeAvailable(configuredRuntime) ? configuredRuntime : null;
  }

  if (detectedContainerRuntimeOverride !== undefined) {
    return detectedContainerRuntimeOverride;
  }

  if (detectedContainerRuntimeCache !== undefined) {
    return detectedContainerRuntimeCache;
  }

  for (const candidate of ['docker', 'podman'] as const) {
    if (isContainerRuntimeAvailable(candidate)) {
      detectedContainerRuntimeCache = candidate;
      return candidate;
    }
  }

  detectedContainerRuntimeCache = null;
  return null;
}

export function getExecStartupDiagnostics(input: {
  enabled: boolean;
  defaultTier: ExecTier;
  maxTier: ExecTier;
  containerRuntime: ContainerRuntime | null;
}): ExecStartupDiagnostics {
  const defaultTierRequiresContainer = input.defaultTier !== 'host';
  const defaultTierViable = !defaultTierRequiresContainer || input.containerRuntime !== null;
  const messages: string[] = [];

  messages.push(
    input.containerRuntime
      ? `Container runtime detected: ${input.containerRuntime}`
      : 'Container runtime detected: none',
  );

  messages.push(
    defaultTierViable
      ? `Default exec tier '${input.defaultTier}' is viable at startup`
      : `Default exec tier '${input.defaultTier}' requires Docker or Podman, but neither is available`,
  );

  return {
    enabled: input.enabled,
    defaultTier: input.defaultTier,
    maxTier: input.maxTier,
    containerRuntime: input.containerRuntime,
    defaultTierRequiresContainer,
    defaultTierViable,
    messages,
  };
}

export function buildSafeExecEnv(tier: ExecTier): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TERM: process.env.TERM ?? 'xterm-256color',
  };

  if (tier !== 'locked-down') {
    env.NODE_ENV = process.env.NODE_ENV ?? 'production';
    if (process.env.LANG) {
      env.LANG = process.env.LANG;
    }
    if (process.env.LC_ALL) {
      env.LC_ALL = process.env.LC_ALL;
    }
  }

  return env;
}

export function validateExecMounts(
  agentId: string,
  tier: ExecTier,
  mounts: Array<{
    alias: string;
    hostPath: string;
    permissions: ExecMountPermission;
    createIfMissing: boolean;
  }> = [],
): ResolvedExecMount[] {
  const sandboxDir = normalizeRealDirectoryPath(getSandboxDir(agentId), true);
  const resolvedMounts: ResolvedExecMount[] = [
    {
      alias: 'sandbox',
      hostPath: sandboxDir,
      normalizedHostPath: sandboxDir,
      permissions: tier === 'locked-down' ? 'read-only' : 'read-write',
      createIfMissing: true,
      containerPath: '/workspace/sandbox',
      implicit: true,
    },
  ];

  for (const mount of mounts) {
    const normalizedHostPath = normalizeRealDirectoryPath(mount.hostPath, mount.createIfMissing);
    resolvedMounts.push({
      alias: mount.alias,
      hostPath: normalizedHostPath,
      normalizedHostPath,
      permissions: mount.permissions,
      createIfMissing: mount.createIfMissing,
      containerPath: `/workspace/mounts/${mount.alias}`,
      implicit: false,
    });
  }

  const sorted = [...resolvedMounts].sort((left, right) => left.normalizedHostPath.localeCompare(right.normalizedHostPath));

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const next = sorted[nextIndex]!;
      if (!pathsOverlap(current.normalizedHostPath, next.normalizedHostPath)) {
        continue;
      }

      throw new Error(
        `Execution mounts must not overlap: '${current.alias}' (${current.normalizedHostPath}) overlaps '${next.alias}' (${next.normalizedHostPath})`,
      );
    }
  }

  return resolvedMounts;
}

export function resolveExecWorkingDirectory(input: {
  agentId: string;
  tier: ExecTier;
  cwd?: string;
  mounts: ResolvedExecMount[];
}): ExecWorkingDirectory {
  const sandboxMount = input.mounts.find(mount => mount.alias === 'sandbox');
  if (!sandboxMount) {
    throw new Error('Missing implicit sandbox mount');
  }

  const requested = input.cwd?.trim();
  if (!requested) {
    return buildWorkingDirectory(undefined, sandboxMount, sandboxMount.hostPath);
  }

  const mountReference = parseMountReference(requested);
  if (mountReference) {
    const mount = input.mounts.find(candidate => candidate.alias === mountReference.alias);
    if (!mount) {
      throw new Error(`Unknown execution mount alias: ${mountReference.alias}`);
    }

    const resolvedHostPath = resolvePathWithinRoot(mount.hostPath, mountReference.subpath);
    ensureExistingDirectory(resolvedHostPath, requested);
    return buildWorkingDirectory(requested, mount, resolvedHostPath);
  }

  if (input.tier !== 'host' && path.isAbsolute(requested)) {
    throw new Error('Isolated execution cwd must use mount:<alias>/... or stay within the implicit sandbox');
  }

  const baseDirectory = sandboxMount.hostPath;
  const resolvedHostPath = path.isAbsolute(requested)
    ? path.resolve(requested)
    : resolvePathWithinRoot(baseDirectory, requested);

  const containingMount = findContainingMount(resolvedHostPath, input.mounts);
  if (!containingMount) {
    throw new Error(`Execution cwd is outside the allowed sandbox/mount roots: ${requested}`);
  }

  ensureExistingDirectory(resolvedHostPath, requested);
  return buildWorkingDirectory(requested, containingMount, resolvedHostPath);
}

export function buildExecLaunch(input: BuildExecLaunchInput): PreparedExecLaunch {
  const mounts = validateExecMounts(input.agentId, input.tier, input.mounts ?? []);
  const workingDirectory = resolveExecWorkingDirectory({
    agentId: input.agentId,
    tier: input.tier,
    cwd: input.cwd,
    mounts,
  });

  if (input.commandMode === 'shell') {
    const shellPolicyError = validateShellModeForTier(input.tier);
    if (shellPolicyError) {
      throw new Error(shellPolicyError);
    }
  }

  const safeEnv = buildSafeExecEnv(input.tier);
  const spawn = input.tier === 'host'
    ? buildHostSpawnInput({
        command: input.command,
        launchMode: input.launchMode,
        commandMode: input.commandMode,
        allowlist: input.allowlist,
        cwd: workingDirectory.hostPath,
        timeoutMs: input.timeoutMs,
        env: safeEnv,
        cols: input.ptyCols,
        rows: input.ptyRows,
      })
    : buildContainerSpawnInput({
        command: input.command,
        tier: input.tier,
        launchMode: input.launchMode,
        commandMode: input.commandMode,
        allowlist: input.allowlist,
        cwd: workingDirectory,
        mounts,
        containerRuntime: input.containerRuntime,
        timeoutMs: input.timeoutMs,
        cols: input.ptyCols,
        rows: input.ptyRows,
      });

  return {
    tier: input.tier,
    launchMode: input.launchMode,
    commandMode: input.commandMode,
    mounts,
    workingDirectory,
    spawn,
  };
}

export function buildContainerCommandArgv(input: {
  containerRuntime: ContainerRuntime;
  tier: ExecTier;
  mounts: ResolvedExecMount[];
  cwd: ExecWorkingDirectory;
  env: Record<string, string>;
  commandMode: ExecCommandMode;
  command: string;
  allowlist: string[];
}): string[] {
  if (input.tier === 'host') {
    throw new Error('Host tier does not use container launch arguments');
  }

  const baseArgv = [
    input.containerRuntime,
    'run',
    '--rm',
    '-i',
    '--workdir',
    input.cwd.containerPath,
  ];

  for (const mount of input.mounts) {
    const mountMode = input.tier === 'locked-down' || mount.permissions === 'read-only' ? 'ro' : 'rw';
    baseArgv.push('-v', `${mount.hostPath}:${mount.containerPath}:${mountMode}`);
  }

  if (input.tier === 'locked-down') {
    baseArgv.push('--network', 'none');
  }

  for (const [key, value] of Object.entries(input.env)) {
    baseArgv.push('--env', `${key}=${value}`);
  }

  baseArgv.push(DEFAULT_EXEC_CONTAINER_IMAGE);

  if (input.commandMode === 'direct') {
    const parsed = parseCommand(input.command);
    if ('error' in parsed) {
      throw new Error(parsed.error);
    }

    assertDirectCommandAllowed(parsed.binary, input.allowlist);
    return [...baseArgv, parsed.binary, ...parsed.args];
  }

  const shellPolicyError = validateShellModeForTier(input.tier);
  if (shellPolicyError) {
    throw new Error(shellPolicyError);
  }

  return [...baseArgv, '/bin/sh', '-lc', input.command];
}

export function surfaceExecFiles(input: {
  agentId: string;
  files: string[];
  workingDirectory: ExecWorkingDirectory;
  mounts: ResolvedExecMount[];
}): SurfaceExecFileResult[] {
  const sandboxMount = input.mounts.find(mount => mount.alias === 'sandbox');
  if (!sandboxMount) {
    throw new Error('Missing implicit sandbox mount');
  }

  const surfacedDirectory = path.join(getSandboxOutputDir(input.agentId), 'surfaced');
  fs.mkdirSync(surfacedDirectory, { recursive: true });

  return input.files.map((filePath, index) => {
    const sourcePath = resolveExecFilePath(filePath, input.workingDirectory, input.mounts);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Surface file not found: ${filePath}`);
    }

    const stats = fs.statSync(sourcePath);
    if (!stats.isFile()) {
      throw new Error(`Surface path is not a file: ${filePath}`);
    }

    if (isPathWithin(sourcePath, sandboxMount.hostPath)) {
      return {
        sourcePath,
        surfacedPath: sourcePath,
      };
    }

    const baseName = path.basename(sourcePath);
    const surfacedPath = path.join(
      surfacedDirectory,
      `${Date.now()}-${index}-${baseName}`,
    );

    fs.copyFileSync(sourcePath, surfacedPath);

    return {
      sourcePath,
      surfacedPath,
    };
  });
}

export function validateShellModeForTier(tier: ExecTier): string | null {
  if (tier === 'locked-down') {
    return 'Shell mode is not allowed for locked-down execution';
  }

  return null;
}

function buildHostSpawnInput(input: {
  command: string;
  launchMode: ExecLaunchMode;
  commandMode: ExecCommandMode;
  allowlist: string[];
  cwd: string;
  timeoutMs: number;
  env: Record<string, string>;
  cols: number;
  rows: number;
}): SpawnInput {
  if (input.commandMode === 'direct') {
    const parsed = parseCommand(input.command);
    if ('error' in parsed) {
      throw new Error(parsed.error);
    }

    assertDirectCommandAllowed(parsed.binary, input.allowlist);

    if (input.launchMode === 'child') {
      return {
        mode: 'child',
        argv: [parsed.binary, ...parsed.args],
        cwd: input.cwd,
        env: input.env,
        timeoutMs: input.timeoutMs,
        stdinMode: 'pipe-open',
      };
    }

    return {
      mode: 'pty',
      command: shellJoinArgv([parsed.binary, ...parsed.args]),
      cwd: input.cwd,
      env: input.env,
      timeoutMs: input.timeoutMs,
      cols: input.cols,
      rows: input.rows,
    };
  }

  const shellArgv = buildHostShellArgv(input.command);
  if (input.launchMode === 'child') {
    return {
      mode: 'child',
      argv: shellArgv,
      cwd: input.cwd,
      env: input.env,
      timeoutMs: input.timeoutMs,
      stdinMode: 'pipe-open',
    };
  }

  return {
    mode: 'pty',
    command: shellJoinArgv(shellArgv),
    cwd: input.cwd,
    env: input.env,
    timeoutMs: input.timeoutMs,
    cols: input.cols,
    rows: input.rows,
  };
}

function buildContainerSpawnInput(input: {
  command: string;
  tier: ExecTier;
  launchMode: ExecLaunchMode;
  commandMode: ExecCommandMode;
  allowlist: string[];
  cwd: ExecWorkingDirectory;
  mounts: ResolvedExecMount[];
  containerRuntime: ContainerRuntime | null;
  timeoutMs: number;
  cols: number;
  rows: number;
}): SpawnInput {
  if (!input.containerRuntime) {
    throw new Error(`Execution tier '${input.tier}' requires Docker or Podman, but no supported container runtime is available`);
  }

  const argv = buildContainerCommandArgv({
    containerRuntime: input.containerRuntime,
    tier: input.tier,
    mounts: input.mounts,
    cwd: input.cwd,
    env: buildSafeExecEnv(input.tier),
    commandMode: input.commandMode,
    command: input.command,
    allowlist: input.allowlist,
  });

  if (input.launchMode === 'child') {
    return {
      mode: 'child',
      argv,
      cwd: process.cwd(),
      env: buildSafeExecEnv(input.tier),
      timeoutMs: input.timeoutMs,
      stdinMode: 'pipe-open',
    };
  }

  return {
    mode: 'pty',
    command: shellJoinArgv(argv),
    cwd: process.cwd(),
    env: buildSafeExecEnv(input.tier),
    timeoutMs: input.timeoutMs,
    cols: input.cols,
    rows: input.rows,
  };
}

function buildHostShellArgv(command: string): string[] {
  if (process.platform === 'win32') {
    return ['cmd.exe', '/d', '/s', '/c', command];
  }

  const shellPath = process.env.SHELL?.trim() || '/bin/sh';
  const shellName = path.basename(shellPath);
  const wrappedCommand = shellName === 'zsh' ? `setopt nonomatch; ${command}` : command;
  return [shellPath, '-lc', wrappedCommand];
}

function normalizeRealDirectoryPath(hostPath: string, createIfMissing: boolean): string {
  const resolved = path.resolve(hostPath);

  if (!fs.existsSync(resolved)) {
    if (!createIfMissing) {
      throw new Error(`Execution mount path does not exist: ${resolved}`);
    }
    fs.mkdirSync(resolved, { recursive: true });
  }

  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`Execution mount path must be a directory: ${resolved}`);
  }

  const normalizedResolved = normalizeForComparison(resolved);
  const realPath = normalizeForComparison(fs.realpathSync.native(resolved));

  if (normalizedResolved !== realPath) {
    throw new Error(`Execution mount paths must not traverse symlinks: ${resolved}`);
  }

  return realPath;
}

function pathsOverlap(left: string, right: string): boolean {
  return isPathWithin(left, right) || isPathWithin(right, left);
}

function ensureExistingDirectory(directoryPath: string, requested: string): void {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`Execution cwd does not exist: ${requested}`);
  }

  if (!fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`Execution cwd must be a directory: ${requested}`);
  }
}

function buildWorkingDirectory(
  requested: string | undefined,
  mount: ResolvedExecMount,
  resolvedHostPath: string,
): ExecWorkingDirectory {
  const relativePath = path.relative(mount.hostPath, resolvedHostPath);
  const containerPath = relativePath
    ? path.posix.join(mount.containerPath, toPosixPath(relativePath))
    : mount.containerPath;

  return {
    requested,
    scope: mount.alias === 'sandbox' ? 'sandbox' : 'mount',
    mountAlias: mount.alias,
    hostPath: resolvedHostPath,
    containerPath,
  };
}

function findContainingMount(candidatePath: string, mounts: ResolvedExecMount[]): ResolvedExecMount | null {
  const normalizedCandidate = normalizeForComparison(candidatePath);
  const matches = mounts.filter(mount => isPathWithin(normalizedCandidate, mount.hostPath));
  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => right.hostPath.length - left.hostPath.length);
  return matches[0] ?? null;
}

function resolvePathWithinRoot(rootPath: string, relativePath: string): string {
  const resolvedPath = path.resolve(rootPath, relativePath);
  if (!isPathWithin(resolvedPath, rootPath)) {
    throw new Error(`Path escapes allowed execution root: ${relativePath}`);
  }
  return normalizeForComparison(resolvedPath);
}

function resolveExecFilePath(
  filePath: string,
  workingDirectory: ExecWorkingDirectory,
  mounts: ResolvedExecMount[],
): string {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    throw new Error('Surface file path must not be empty');
  }

  const mountReference = parseMountReference(trimmed);
  if (mountReference) {
    const mount = mounts.find(candidate => candidate.alias === mountReference.alias);
    if (!mount) {
      throw new Error(`Unknown execution mount alias: ${mountReference.alias}`);
    }
    return resolvePathWithinRoot(mount.hostPath, mountReference.subpath);
  }

  const resolvedPath = path.isAbsolute(trimmed)
    ? normalizeForComparison(trimmed)
    : normalizeForComparison(path.resolve(workingDirectory.hostPath, trimmed));

  if (!findContainingMount(resolvedPath, mounts)) {
    throw new Error(`Surface file is outside the allowed sandbox/mount roots: ${filePath}`);
  }

  return resolvedPath;
}

function parseMountReference(value: string): { alias: string; subpath: string } | null {
  if (!value.startsWith('mount:')) {
    return null;
  }

  const remainder = value.slice('mount:'.length);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex === -1) {
    return { alias: remainder, subpath: '' };
  }

  return {
    alias: remainder.slice(0, slashIndex),
    subpath: remainder.slice(slashIndex + 1),
  };
}

function assertDirectCommandAllowed(binary: string, allowlist: string[]): void {
  const binaryBasename = getBinaryBasename(binary);
  if (!allowlist.includes(binaryBasename)) {
    throw new Error(
      `Command '${binaryBasename}' is not in the allowlist. Allowed commands: ${allowlist.join(', ') || '(none)'}`,
    );
  }
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

function normalizeForComparison(value: string): string {
  return path.normalize(path.resolve(value));
}

function isPathWithin(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizeForComparison(candidatePath);
  const root = normalizeForComparison(rootPath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
