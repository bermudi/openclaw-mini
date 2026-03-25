/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  buildContainerCommandArgv,
  buildExecLaunch,
  surfaceExecFiles,
  validateExecMounts,
  resolveExecWorkingDirectory,
} from '../src/lib/services/exec-runtime';
import { setSandboxRootForTests } from '../src/lib/services/sandbox-service';

const TEST_AGENT_ID = 'exec-runtime-agent';
let sandboxRoot: string;
let tempRoot: string;

beforeEach(() => {
  sandboxRoot = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-exec-runtime-sandbox-'));
  tempRoot = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-exec-runtime-workspace-'));
  setSandboxRootForTests(sandboxRoot);
});

afterEach(() => {
  setSandboxRootForTests(null);
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('exec mount validation', () => {
  test('creates missing mounts when createIfMissing is enabled', () => {
    const mountPath = path.join(tempRoot, 'created-on-demand');

    const mounts = validateExecMounts(TEST_AGENT_ID, 'sandbox', [
      {
        alias: 'workspace',
        hostPath: mountPath,
        permissions: 'read-write',
        createIfMissing: true,
      },
    ]);

    expect(fs.existsSync(mountPath)).toBe(true);
    expect(mounts.some(mount => mount.alias === 'workspace')).toBe(true);
    expect(mounts.some(mount => mount.alias === 'sandbox')).toBe(true);
  });

  test('rejects missing mounts when createIfMissing is disabled', () => {
    const mountPath = path.join(tempRoot, 'missing');

    expect(() => validateExecMounts(TEST_AGENT_ID, 'sandbox', [
      {
        alias: 'workspace',
        hostPath: mountPath,
        permissions: 'read-write',
        createIfMissing: false,
      },
    ])).toThrow('does not exist');
  });

  test('rejects overlapping mounts and symlinked mount paths', () => {
    const workspace = path.join(tempRoot, 'workspace');
    const nested = path.join(workspace, 'nested');
    fs.mkdirSync(nested, { recursive: true });

    expect(() => validateExecMounts(TEST_AGENT_ID, 'sandbox', [
      {
        alias: 'workspace',
        hostPath: workspace,
        permissions: 'read-write',
        createIfMissing: false,
      },
      {
        alias: 'nested',
        hostPath: nested,
        permissions: 'read-only',
        createIfMissing: false,
      },
    ])).toThrow('must not overlap');

    const realDir = path.join(tempRoot, 'real');
    const symlinkDir = path.join(tempRoot, 'real-link');
    fs.mkdirSync(realDir, { recursive: true });
    fs.symlinkSync(realDir, symlinkDir, 'dir');

    expect(() => validateExecMounts(TEST_AGENT_ID, 'sandbox', [
      {
        alias: 'symlinked',
        hostPath: symlinkDir,
        permissions: 'read-only',
        createIfMissing: false,
      },
    ])).toThrow('must not traverse symlinks');
  });
});

describe('cwd resolution', () => {
  test('resolves mount-aware cwd inside configured mounts', () => {
    const workspace = path.join(tempRoot, 'workspace');
    const projectDir = path.join(workspace, 'project');
    fs.mkdirSync(projectDir, { recursive: true });

    const mounts = validateExecMounts(TEST_AGENT_ID, 'sandbox', [
      {
        alias: 'workspace',
        hostPath: workspace,
        permissions: 'read-write',
        createIfMissing: false,
      },
    ]);

    const resolved = resolveExecWorkingDirectory({
      agentId: TEST_AGENT_ID,
      tier: 'sandbox',
      cwd: 'mount:workspace/project',
      mounts,
    });

    expect(resolved.mountAlias).toBe('workspace');
    expect(resolved.hostPath).toBe(projectDir);
    expect(resolved.containerPath).toBe('/workspace/mounts/workspace/project');
  });

  test('rejects isolated cwd outside allowed mounts', () => {
    const workspace = path.join(tempRoot, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });

    const mounts = validateExecMounts(TEST_AGENT_ID, 'sandbox', [
      {
        alias: 'workspace',
        hostPath: workspace,
        permissions: 'read-write',
        createIfMissing: false,
      },
    ]);

    expect(() => resolveExecWorkingDirectory({
      agentId: TEST_AGENT_ID,
      tier: 'sandbox',
      cwd: path.join(tempRoot, 'outside'),
      mounts,
    })).toThrow('must use mount:<alias>');
  });
});

describe('container execution args', () => {
  test('builds tier-specific isolation profiles', () => {
    const workspace = path.join(tempRoot, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });

    const sandboxMounts = validateExecMounts(TEST_AGENT_ID, 'sandbox', [
      {
        alias: 'workspace',
        hostPath: workspace,
        permissions: 'read-write',
        createIfMissing: false,
      },
    ]);
    const sandboxCwd = resolveExecWorkingDirectory({ agentId: TEST_AGENT_ID, tier: 'sandbox', cwd: 'mount:workspace', mounts: sandboxMounts });
    const sandboxArgv = buildContainerCommandArgv({
      containerRuntime: 'docker',
      tier: 'sandbox',
      mounts: sandboxMounts,
      cwd: sandboxCwd,
      env: { PATH: '/usr/bin:/bin', HOME: '/tmp', TERM: 'xterm-256color' },
      commandMode: 'direct',
      command: 'echo hello',
      allowlist: ['echo'],
    });

    expect(sandboxArgv.some(arg => arg.endsWith(':/workspace/mounts/workspace:rw'))).toBe(true);
    expect(sandboxArgv).not.toContain('none');

    const lockedMounts = validateExecMounts(TEST_AGENT_ID, 'locked-down', [
      {
        alias: 'workspace',
        hostPath: workspace,
        permissions: 'read-write',
        createIfMissing: false,
      },
    ]);
    const lockedCwd = resolveExecWorkingDirectory({ agentId: TEST_AGENT_ID, tier: 'locked-down', cwd: 'mount:workspace', mounts: lockedMounts });
    const lockedArgv = buildContainerCommandArgv({
      containerRuntime: 'podman',
      tier: 'locked-down',
      mounts: lockedMounts,
      cwd: lockedCwd,
      env: { PATH: '/usr/bin:/bin', HOME: '/tmp', TERM: 'xterm-256color' },
      commandMode: 'direct',
      command: 'echo hello',
      allowlist: ['echo'],
    });

    expect(lockedArgv).toContain('--network');
    expect(lockedArgv).toContain('none');
    expect(lockedArgv.some(arg => arg.endsWith(':/workspace/mounts/workspace:ro'))).toBe(true);
  });
});

describe('surfaceExecFiles', () => {
  test('copies files from approved mounts into sandbox output before delivery', () => {
    const workspace = path.join(tempRoot, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    const generatedFile = path.join(workspace, 'report.txt');
    fs.writeFileSync(generatedFile, 'generated outside the sandbox', 'utf-8');

    const mounts = validateExecMounts(TEST_AGENT_ID, 'host', [
      {
        alias: 'workspace',
        hostPath: workspace,
        permissions: 'read-write',
        createIfMissing: false,
      },
    ]);
    const workingDirectory = resolveExecWorkingDirectory({
      agentId: TEST_AGENT_ID,
      tier: 'host',
      cwd: 'mount:workspace',
      mounts,
    });

    const surfaced = surfaceExecFiles({
      agentId: TEST_AGENT_ID,
      files: ['report.txt'],
      workingDirectory,
      mounts,
    });

    expect(surfaced).toHaveLength(1);
    expect(surfaced[0]?.sourcePath).toBe(generatedFile);
    expect(surfaced[0]?.surfacedPath).not.toBe(generatedFile);
    expect(fs.existsSync(surfaced[0]!.surfacedPath)).toBe(true);
    expect(fs.readFileSync(surfaced[0]!.surfacedPath, 'utf-8')).toBe('generated outside the sandbox');
  });
});

describe('mount alias and shell wrapping edge cases', () => {
  test('handles mount alias edge cases and rejects unknown aliases or traversal', () => {
    const workspace = path.join(tempRoot, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });

    const mounts = validateExecMounts(TEST_AGENT_ID, 'host', [
      {
        alias: 'workspace',
        hostPath: workspace,
        permissions: 'read-write',
        createIfMissing: false,
      },
    ]);

    const rootCwd = resolveExecWorkingDirectory({
      agentId: TEST_AGENT_ID,
      tier: 'host',
      cwd: 'mount:workspace',
      mounts,
    });
    const slashCwd = resolveExecWorkingDirectory({
      agentId: TEST_AGENT_ID,
      tier: 'host',
      cwd: 'mount:workspace/',
      mounts,
    });

    expect(rootCwd.hostPath).toBe(workspace);
    expect(slashCwd.hostPath).toBe(workspace);
    expect(() => resolveExecWorkingDirectory({
      agentId: TEST_AGENT_ID,
      tier: 'host',
      cwd: 'mount:missing',
      mounts,
    })).toThrow('Unknown execution mount alias');
    expect(() => resolveExecWorkingDirectory({
      agentId: TEST_AGENT_ID,
      tier: 'host',
      cwd: 'mount:workspace/../escape',
      mounts,
    })).toThrow('escapes allowed execution root');
  });

  test('wraps host shell commands for zsh with nonomatch protection', () => {
    const originalShell = process.env.SHELL;
    process.env.SHELL = '/bin/zsh';

    try {
      const prepared = buildExecLaunch({
        agentId: TEST_AGENT_ID,
        command: 'curl https://example.com?foo=bar',
        tier: 'host',
        launchMode: 'child',
        commandMode: 'shell',
        allowlist: [],
        containerRuntime: null,
        timeoutMs: 1000,
        ptyCols: 120,
        ptyRows: 30,
      });

      expect(prepared.spawn.mode).toBe('child');
      if (prepared.spawn.mode !== 'child') {
        throw new Error('Expected child spawn mode');
      }

      expect(prepared.spawn.argv[0]).toBe('/bin/zsh');
      expect(prepared.spawn.argv[2]).toContain('setopt nonomatch;');
    } finally {
      process.env.SHELL = originalShell;
    }
  });
});
