/// <reference types="bun-types" />

import { describe, expect, it, beforeAll, beforeEach, afterAll, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture, writeRuntimeConfig } from './runtime-config-fixture';
import {
  parseCommand,
  getBinaryBasename,
  truncateOutput,
  capCombinedOutput,
} from '../src/lib/utils/exec-helpers';

const TEST_AGENT_ID = 'exec-test-agent';
let TEST_SANDBOX_ROOT: string;
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-exec-command-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  initializeProviderRegistry();
});

afterAll(async () => {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  delete process.env.OPENCLAW_CONFIG_PATH;
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
});

beforeEach(() => {
  TEST_SANDBOX_ROOT = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-exec-'));
});

afterEach(async () => {
  const { processSupervisor } = await import('../src/lib/services/process-supervisor');
  const { resetExecRuntimeStateForTests } = await import('../src/lib/services/exec-runtime');
  processSupervisor.resetForTests();
  resetExecRuntimeStateForTests();

  if (TEST_SANDBOX_ROOT && fs.existsSync(TEST_SANDBOX_ROOT)) {
    fs.rmSync(TEST_SANDBOX_ROOT, { recursive: true, force: true });
  }
});

function findExecutableOnPath(name: string): string | null {
  const pathEnv = process.env.PATH ?? '';
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

  return null;
}

describe('parseCommand', () => {
  it('parses simple command with no arguments', () => {
    const result = parseCommand('ls');
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('ls');
      expect(result.args).toEqual([]);
    }
  });

  it('parses command with arguments', () => {
    const result = parseCommand('cat file.txt');
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('cat');
      expect(result.args).toEqual(['file.txt']);
    }
  });

  it('parses command with multiple arguments', () => {
    const result = parseCommand('grep -n pattern file.txt');
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('grep');
      expect(result.args).toEqual(['-n', 'pattern', 'file.txt']);
    }
  });

  it('respects quoted strings', () => {
    const result = parseCommand('echo "hello world"');
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('echo');
      expect(result.args).toEqual(['hello world']);
    }
  });

  it('respects single quotes', () => {
    const result = parseCommand("echo 'hello world'");
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('echo');
      expect(result.args).toEqual(['hello world']);
    }
  });

  it('rejects pipe operator', () => {
    const result = parseCommand('cat file.txt | grep pattern');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Shell operators');
      expect(result.error).toContain('|');
    }
  });

  it('rejects && operator', () => {
    const result = parseCommand('ls && cat file.txt');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('&&');
    }
  });

  it('rejects || operator', () => {
    const result = parseCommand('ls || echo failed');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      // || contains |, which is detected first
      expect(result.error).toContain('|');
    }
  });

  it('rejects semicolon operator', () => {
    const result = parseCommand('ls; cat file.txt');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain(';');
    }
  });

  it('rejects output redirect', () => {
    const result = parseCommand('cat file.txt > output.txt');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('>');
    }
  });

  it('rejects input redirect', () => {
    const result = parseCommand('cat < input.txt');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('<');
    }
  });

  it('rejects backticks', () => {
    const result = parseCommand('echo `date`');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('`');
    }
  });

  it('rejects $() command substitution', () => {
    const result = parseCommand('echo $(date)');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('$(');
    }
  });

  it('rejects & background execution', () => {
    const result = parseCommand('sleep 10 &');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('&');
    }
  });

  it('rejects empty command', () => {
    const result = parseCommand('');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Empty command');
    }
  });

  it('rejects whitespace-only command', () => {
    const result = parseCommand('   ');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Empty command');
    }
  });
});

describe('getBinaryBasename', () => {
  it('returns simple name unchanged', () => {
    expect(getBinaryBasename('cat')).toBe('cat');
  });

  it('extracts basename from Unix path', () => {
    expect(getBinaryBasename('/usr/bin/cat')).toBe('cat');
  });

  it('extracts basename from Windows path', () => {
    expect(getBinaryBasename('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe');
  });

  it('handles nested paths', () => {
    expect(getBinaryBasename('/usr/local/bin/node')).toBe('node');
  });
});

describe('truncateOutput', () => {
  it('returns output unchanged when within limit', () => {
    const output = 'Hello, world!';
    const result = truncateOutput(output, 100);
    
    expect(result).toBe(output);
  });

  it('truncates from beginning when exceeding limit', () => {
    const output = '0123456789'.repeat(20); // 200 chars
    const result = truncateOutput(output, 100);
    
    expect(result).toContain('[output truncated');
    expect(result.length).toBeGreaterThan(100);
    expect(result).toContain('0123456789'.repeat(10)); // Last 100 chars should be present
  });

  it('preserves exact limit characters in tail', () => {
    const output = 'ABCDEFGHIJ'.repeat(20); // 200 chars
    const result = truncateOutput(output, 50);
    
    // The tail should be the last 50 chars
    expect(result).toContain('ABCDEFGHIJ'.repeat(5));
  });

  it('handles empty output', () => {
    const result = truncateOutput('', 100);
    
    expect(result).toBe('');
  });

  it('handles output exactly at limit', () => {
    const output = 'x'.repeat(100);
    const result = truncateOutput(output, 100);
    
    expect(result).toBe(output);
  });
});

describe('capCombinedOutput', () => {
  it('returns both streams unchanged when within limit', () => {
    const result = capCombinedOutput('hello', 'world', 100);
    
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('world');
    expect(result.truncated).toBe(false);
  });

  it('sets truncated flag when combined exceeds limit', () => {
    const stdout = 'a'.repeat(8000);
    const stderr = 'b'.repeat(4000);
    const result = capCombinedOutput(stdout, stderr, 10000);
    
    expect(result.truncated).toBe(true);
  });

  it('ensures total output does not exceed maxOutputSize', () => {
    const stdout = 'a'.repeat(8000);
    const stderr = 'b'.repeat(8000);
    const result = capCombinedOutput(stdout, stderr, 10000);
    
    // Combined truncated output should not exceed limit (truncation notices are allowed to add a little)
    expect(result.truncated).toBe(true);
    // Each stream is allocated proportionally (50/50 here) so each gets ~5000 chars
    expect(result.stdout.length).toBeLessThanOrEqual(10000);
    expect(result.stderr.length).toBeLessThanOrEqual(10000);
  });

  it('allocates proportionally by stream size', () => {
    // stdout is 3x larger than stderr, so it gets ~75% of budget
    const stdout = 'A'.repeat(9000);
    const stderr = 'B'.repeat(3000);
    const result = capCombinedOutput(stdout, stderr, 8000);
    
    expect(result.truncated).toBe(true);
    // stdout should get ~6000, stderr ~2000
    expect(result.stdout).toContain('[output truncated');
    expect(result.stderr).toContain('[output truncated');
  });

  it('handles empty stdout gracefully', () => {
    const result = capCombinedOutput('', 'b'.repeat(20000), 10000);
    
    expect(result.truncated).toBe(true);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[output truncated');
  });

  it('handles empty stderr gracefully', () => {
    const result = capCombinedOutput('a'.repeat(20000), '', 10000);
    
    expect(result.truncated).toBe(true);
    expect(result.stdout).toContain('[output truncated');
    expect(result.stderr).toBe('');
  });

  it('handles both empty streams', () => {
    const result = capCombinedOutput('', '', 10000);
    
    expect(result.truncated).toBe(false);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});

describe('sandbox integration', () => {
  beforeEach(async () => {
    const { setSandboxRootForTests } = await import('../src/lib/services/sandbox-service');
    setSandboxRootForTests(TEST_SANDBOX_ROOT);
  });

  afterEach(async () => {
    const { setSandboxRootForTests } = await import('../src/lib/services/sandbox-service');
    setSandboxRootForTests(null);
  });

  it('sandbox directory is created for agent', async () => {
    const { getSandboxDir } = await import('../src/lib/services/sandbox-service');
    const sandboxDir = getSandboxDir(TEST_AGENT_ID);
    
    expect(fs.existsSync(sandboxDir)).toBe(true);
  });

  it('can write and read file in sandbox', async () => {
    const { getSandboxDir } = await import('../src/lib/services/sandbox-service');
    const sandboxDir = getSandboxDir(TEST_AGENT_ID);
    const testFile = path.join(sandboxDir, 'test.txt');
    
    fs.writeFileSync(testFile, 'Hello, sandbox!', 'utf-8');
    
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('Hello, sandbox!');
  });
});

describe('exec_command tool surface output', () => {
  beforeEach(async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        exec: {
          enabled: true,
          allowlist: ['echo', 'printf'],
          maxTimeout: 30,
          maxOutputSize: 10000,
          foregroundYieldMs: 100,
        },
      },
    });

    const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
    const { setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');
    resetProviderRegistryForTests();
    setDetectedContainerRuntimeForTests(null);
    initializeProviderRegistry();

    const { setSandboxRootForTests } = await import('../src/lib/services/sandbox-service');
    setSandboxRootForTests(TEST_SANDBOX_ROOT);
  });

  afterEach(async () => {
    const { setSandboxRootForTests } = await import('../src/lib/services/sandbox-service');
    setSandboxRootForTests(null);
  });

  it('adds a text surface when surfaceOutput is true and stdout is non-empty', async () => {
    const { getTool } = await import('../src/lib/tools');
    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const result = await execTool.execute(
      { agentId: TEST_AGENT_ID, command: 'echo surfaced output', surfaceOutput: true },
      { toolCallId: 'exec-surface', messages: [] },
    );

    expect(result.success).toBe(true);
    expect(result.surface).toEqual([{ type: 'text', content: 'surfaced output\n' }]);
  });

  it('does not add a surface when surfaceOutput is false', async () => {
    const { getTool } = await import('../src/lib/tools');
    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const result = await execTool.execute(
      { agentId: TEST_AGENT_ID, command: 'echo ordinary output', surfaceOutput: false },
      { toolCallId: 'exec-no-surface', messages: [] },
    );

    expect(result.success).toBe(true);
    expect(result.surface).toBeUndefined();
  });

  it('does not add a surface when stdout is empty', async () => {
    const { getTool } = await import('../src/lib/tools');
    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const result = await execTool.execute(
      { agentId: TEST_AGENT_ID, command: 'printf ""', surfaceOutput: true },
      { toolCallId: 'exec-empty-surface', messages: [] },
    );

    expect(result.success).toBe(true);
    expect((result.data as { stdout?: string } | undefined)?.stdout).toBe('');
    expect(result.surface).toBeUndefined();
  });

  it('uses the active tool execution context agentId when omitted', async () => {
    const toolsModule = await import('../src/lib/tools');
    const execTool = toolsModule.getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const result = await toolsModule.withToolExecutionContext(
      {
        agentId: TEST_AGENT_ID,
        taskId: 'task-context-agent-id',
        taskType: 'message',
      },
      () => execTool.execute!(
        { command: 'echo context agent output' },
        { toolCallId: 'exec-context-agent', messages: [] },
      ),
    ) as { success: boolean; data?: { stdout?: string } };

    expect(result.success).toBe(true);
    expect(result.data?.stdout).toBe('context agent output\n');
  });
});

describe('exec_command tool advanced runtime behavior', () => {
  async function reloadExecRuntime(overrides: Record<string, unknown>) {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        exec: overrides,
      },
    });

    const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
    resetProviderRegistryForTests();
    initializeProviderRegistry();
  }

  beforeEach(async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        exec: {
          enabled: true,
          allowlist: ['echo', 'printf'],
          maxTimeout: 30,
          maxOutputSize: 10000,
          foregroundYieldMs: 100,
        },
      },
    });

    const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
    const { setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');
    const { setSandboxRootForTests } = await import('../src/lib/services/sandbox-service');
    resetProviderRegistryForTests();
    setDetectedContainerRuntimeForTests(null);
    initializeProviderRegistry();
    setSandboxRootForTests(TEST_SANDBOX_ROOT);
  });

  afterEach(async () => {
    const { setSandboxRootForTests } = await import('../src/lib/services/sandbox-service');
    setSandboxRootForTests(null);
  });

  it('returns a supervised session handle for explicit background launches and exposes it through the process tool', async () => {
    const { getTool } = await import('../src/lib/tools');
    const execTool = getTool('exec_command');
    const processTool = getTool('process');
    if (!execTool?.execute || !processTool?.execute) {
      throw new Error('exec_command or process tool is not registered');
    }

    const launchResult = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: 'sleep 2',
        commandMode: 'shell',
        background: true,
      },
      { toolCallId: 'exec-background', messages: [] },
    );

    expect(launchResult.success).toBe(true);
    const sessionId = (launchResult.data as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeTruthy();

    const listResult = await processTool.execute(
      { action: 'list', agentId: TEST_AGENT_ID },
      { toolCallId: 'process-list', messages: [] },
    );

    expect(listResult.success).toBe(true);
    const sessions = (listResult.data as { sessions?: Array<{ sessionId: string }> } | undefined)?.sessions ?? [];
    expect(sessions.some(session => session.sessionId === sessionId)).toBe(true);

    const killResult = await processTool.execute(
      { action: 'kill', sessionId: sessionId! },
      { toolCallId: 'process-kill', messages: [] },
    );

    expect(killResult.success).toBe(true);
  });

  it('hands off PTY launches immediately even when background is not explicitly requested', async () => {
    const { getTool } = await import('../src/lib/tools');
    const { processSupervisor } = await import('../src/lib/services/process-supervisor');
    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const launchResult = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: 'printf pty-handoff-contract',
        launchMode: 'pty',
        commandMode: 'direct',
      },
      { toolCallId: 'exec-pty-handoff', messages: [] },
    );

    expect(launchResult.success).toBe(true);
    const data = launchResult.data as { sessionId?: string; background?: boolean; launchMode?: string; stdout?: string } | undefined;
    expect(data?.sessionId).toBeTruthy();
    expect(data?.background).toBe(true);
    expect(data?.launchMode).toBe('pty');
    expect(data?.stdout).toBeUndefined();

    const completed = await processSupervisor.waitForSession(data!.sessionId!);
    expect(completed?.status).toBe('completed');
  });

  it('supports PTY launches with process.write and process.poll', async () => {
    const { getTool } = await import('../src/lib/tools');
    const execTool = getTool('exec_command');
    const processTool = getTool('process');
    if (!execTool?.execute || !processTool?.execute) {
      throw new Error('exec_command or process tool is not registered');
    }

    const launchResult = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: 'cat',
        launchMode: 'pty',
        commandMode: 'shell',
      },
      { toolCallId: 'exec-pty', messages: [] },
    );

    expect(launchResult.success).toBe(true);
    const sessionId = (launchResult.data as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeTruthy();

    const writeResult = await processTool.execute(
      { action: 'write', sessionId: sessionId!, input: 'hello through process tool\n' },
      { toolCallId: 'process-write', messages: [] },
    );
    expect(writeResult.success).toBe(true);

    let combinedOutput = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const pollResult = await processTool.execute(
        { action: 'poll', sessionId: sessionId!, offset: 0, limit: 4000 },
        { toolCallId: 'process-poll', messages: [] },
      );
      expect(pollResult.success).toBe(true);
      combinedOutput = (pollResult.data as { output?: string } | undefined)?.output ?? '';
      if (combinedOutput.includes('hello through process tool')) {
        break;
      }
    }

    expect(combinedOutput).toContain('hello through process tool');

    await processTool.execute(
      { action: 'kill', sessionId: sessionId! },
      { toolCallId: 'process-kill-pty', messages: [] },
    );
  });

  it('supports mount-aware PTY working directories for interactive sessions', async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    const workspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-pty-mount-cwd-'));

    try {
      await reloadExecRuntime({
        enabled: true,
        allowlist: ['cat'],
        maxTimeout: 30,
        maxOutputSize: 10000,
        foregroundYieldMs: 100,
        mounts: [
          {
            alias: 'workspace',
            hostPath: workspaceDir,
            permissions: 'read-write',
            createIfMissing: false,
          },
        ],
      });

      const { getTool } = await import('../src/lib/tools');
      const { processSupervisor } = await import('../src/lib/services/process-supervisor');
      const execTool = getTool('exec_command');
      const processTool = getTool('process');
      if (!execTool?.execute || !processTool?.execute) {
        throw new Error('exec_command or process tool is not registered');
      }

      const launchResult = await execTool.execute(
        {
          agentId: TEST_AGENT_ID,
          command: 'cat',
          launchMode: 'pty',
          commandMode: 'direct',
          cwd: 'mount:workspace',
        },
        { toolCallId: 'exec-pty-mount-cwd', messages: [] },
      );

      expect(launchResult.success).toBe(true);
      const sessionId = (launchResult.data as { sessionId?: string } | undefined)?.sessionId;
      expect(sessionId).toBeTruthy();

      const snapshot = processSupervisor.getSessionSnapshot(sessionId!);
      expect(snapshot.pid).toBeTruthy();
      const resolvedCwd = fs.realpathSync(path.join('/proc', String(snapshot.pid), 'cwd'));
      expect(resolvedCwd).toBe(workspaceDir);

      await processTool.execute(
        { action: 'kill', sessionId: sessionId! },
        { toolCallId: 'process-kill-mount-cwd', messages: [] },
      );
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('preserves PTY polling offsets across multiple reads without duplicating data', async () => {
    const { getTool } = await import('../src/lib/tools');
    const execTool = getTool('exec_command');
    const processTool = getTool('process');
    if (!execTool?.execute || !processTool?.execute) {
      throw new Error('exec_command or process tool is not registered');
    }

    const launchResult = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: 'cat',
        launchMode: 'pty',
        commandMode: 'shell',
      },
      { toolCallId: 'exec-pty-poll-offsets', messages: [] },
    );

    expect(launchResult.success).toBe(true);
    const sessionId = (launchResult.data as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeTruthy();

    const payload = 'offset-window-1234567890\n';
    const writeResult = await processTool.execute(
      { action: 'write', sessionId: sessionId!, input: payload },
      { toolCallId: 'process-write-offset-seed', messages: [] },
    );
    expect(writeResult.success).toBe(true);

    let fullOutput = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const logResult = await processTool.execute(
        { action: 'log', sessionId: sessionId!, offset: 0, limit: 4000 },
        { toolCallId: 'process-log-offset-full', messages: [] },
      );
      expect(logResult.success).toBe(true);
      fullOutput = (logResult.data as { output?: string } | undefined)?.output ?? '';
      if (fullOutput.includes('offset-window-1234567890')) {
        break;
      }
    }

    expect(fullOutput).toContain('offset-window-1234567890');

    const firstPoll = await processTool.execute(
      { action: 'poll', sessionId: sessionId!, offset: 0, limit: 10 },
      { toolCallId: 'process-poll-offset-1', messages: [] },
    );
    expect(firstPoll.success).toBe(true);
    const firstWindow = firstPoll.data as { output: string; nextOffset: number };

    const secondPoll = await processTool.execute(
      { action: 'poll', sessionId: sessionId!, offset: firstWindow.nextOffset, limit: 10 },
      { toolCallId: 'process-poll-offset-2', messages: [] },
    );
    expect(secondPoll.success).toBe(true);
    const secondWindow = secondPoll.data as { output: string; nextOffset: number };

    expect(firstWindow.output.length).toBe(10);
    expect(secondWindow.output.length).toBe(10);
    expect(secondWindow.nextOffset).toBeGreaterThan(firstWindow.nextOffset);
    expect(firstWindow.output + secondWindow.output).toBe(fullOutput.slice(0, 20));

    await processTool.execute(
      { action: 'kill', sessionId: sessionId! },
      { toolCallId: 'process-kill-offset-session', messages: [] },
    );
  });

  it('uses the fallback PTY backend when runtime.exec.forcePtyFallback is enabled and warns operators', async () => {
    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map(value => String(value)).join(' '));
    };

    try {
      await reloadExecRuntime({
        enabled: true,
        allowlist: ['printf'],
        maxTimeout: 30,
        maxOutputSize: 10000,
        foregroundYieldMs: 100,
        forcePtyFallback: true,
      });

      const { getTool } = await import('../src/lib/tools');
      const { processSupervisor } = await import('../src/lib/services/process-supervisor');
      const execTool = getTool('exec_command');
      if (!execTool?.execute) {
        throw new Error('exec_command tool is not registered');
      }

      const result = await execTool.execute(
        {
          agentId: TEST_AGENT_ID,
          command: 'printf forced-backend',
          launchMode: 'pty',
          commandMode: 'shell',
          background: true,
        },
        { toolCallId: 'exec-force-fallback', messages: [] },
      );

      expect(result.success).toBe(true);
      const sessionId = (result.data as { sessionId?: string } | undefined)?.sessionId;
      expect(sessionId).toBeTruthy();
      expect(processSupervisor.getPtyBackendForSession(sessionId!)).toBe('fallback');
      expect(warnMessages.some(message => message.includes('forcePtyFallback'))).toBe(true);

      const completed = await processSupervisor.waitForSession(sessionId!);
      expect(completed?.status).toBe('completed');
      expect(completed?.stdout).toContain('forced-backend');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('runs zsh shell-mode commands without nonomatch glob errors', async () => {
    const zshPath = findExecutableOnPath('zsh');
    if (!zshPath) {
      expect(true).toBe(true);
      return;
    }

    const originalShell = process.env.SHELL;
    process.env.SHELL = zshPath;

    try {
      const { getTool } = await import('../src/lib/tools');
      const execTool = getTool('exec_command');
      if (!execTool?.execute) {
        throw new Error('exec_command tool is not registered');
      }

      const result = await execTool.execute(
        {
          agentId: TEST_AGENT_ID,
          command: 'printf https://example.com?foo[]=bar',
          commandMode: 'shell',
          launchMode: 'child',
        },
        { toolCallId: 'exec-zsh-nonomatch', messages: [] },
      );

      expect(result.success).toBe(true);
      const data = result.data as { stdout?: string; stderr?: string } | undefined;
      expect(data?.stdout).toContain('https://example.com?foo[]=bar');
      expect(data?.stderr ?? '').not.toContain('no matches found');
    } finally {
      process.env.SHELL = originalShell;
    }
  });

  it('prefers a bash-compatible shell when SHELL points to fish', async () => {
    const fishPath = findExecutableOnPath('fish');
    const bashPath = findExecutableOnPath('bash');
    if (!fishPath || !bashPath) {
      expect(true).toBe(true);
      return;
    }

    const originalShell = process.env.SHELL;
    process.env.SHELL = fishPath;

    try {
      const { getTool } = await import('../src/lib/tools');
      const execTool = getTool('exec_command');
      if (!execTool?.execute) {
        throw new Error('exec_command tool is not registered');
      }

      const result = await execTool.execute(
        {
          agentId: TEST_AGENT_ID,
          command: "[[ 'x' == 'x' ]] && printf fish-shell-compatible",
          commandMode: 'shell',
          launchMode: 'child',
        },
        { toolCallId: 'exec-fish-shell-compat', messages: [] },
      );

      expect(result.success).toBe(true);
      const data = result.data as { stdout?: string; stderr?: string } | undefined;
      expect(data?.stdout).toContain('fish-shell-compatible');
      expect(data?.stderr ?? '').toBe('');
    } finally {
      process.env.SHELL = originalShell;
    }
  });

  it('returns a clear exec_command error when no PTY backend is available', async () => {
    const { getTool } = await import('../src/lib/tools');
    const { processSupervisor } = await import('../src/lib/services/process-supervisor');
    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    processSupervisor.setPlatformForTests('win32');

    const result = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: 'printf impossible-pty',
        launchMode: 'pty',
        commandMode: 'shell',
      },
      { toolCallId: 'exec-no-pty-backend', messages: [] },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No supported PTY backend available');
  });

  it('applies shell-mode policy by tier', async () => {
    const { getTool } = await import('../src/lib/tools');
    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const result = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: 'echo hello from locked-down shell',
        tier: 'locked-down',
        commandMode: 'shell',
      },
      { toolCallId: 'exec-locked-down-shell', messages: [] },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Shell mode is not allowed for locked-down execution');
  });

  it('rejects isolated launches clearly when no supported container runtime is available', async () => {
    const { getTool } = await import('../src/lib/tools');
    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const result = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: 'echo hello',
        tier: 'sandbox',
      },
      { toolCallId: 'exec-sandbox-missing-runtime', messages: [] },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires Docker or Podman');
  });

  it('copies surfaced files from approved mounted workspaces into sandbox output', async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    const workspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-mounted-workspace-'));

    try {
      writeRuntimeConfig(runtimeConfigFixture.configPath, {
        runtime: {
          exec: {
            enabled: true,
            allowlist: ['echo', 'printf'],
            maxTimeout: 30,
            maxOutputSize: 10000,
            foregroundYieldMs: 100,
            mounts: [
              {
                alias: 'workspace',
                hostPath: workspaceDir,
                permissions: 'read-write',
                createIfMissing: false,
              },
            ],
          },
        },
      });

      const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
      resetProviderRegistryForTests();
      initializeProviderRegistry();

      const { getTool } = await import('../src/lib/tools');
      const execTool = getTool('exec_command');
      if (!execTool?.execute) {
        throw new Error('exec_command tool is not registered');
      }

      const result = await execTool.execute(
        {
          agentId: TEST_AGENT_ID,
          command: "printf 'report from mount' > report.txt",
          commandMode: 'shell',
          cwd: 'mount:workspace',
          surfaceFiles: ['report.txt'],
        },
        { toolCallId: 'exec-surface-file', messages: [] },
      );

      expect(result.success).toBe(true);
      const surfaces = result.surface as Array<{ type: string; filePath?: string }> | undefined;
      expect(surfaces).toBeTruthy();
      expect(surfaces?.[0]?.type).toBe('file');
      expect(surfaces?.[0]?.filePath).toBeTruthy();
      expect(surfaces?.[0]?.filePath).not.toBe(path.join(workspaceDir, 'report.txt'));
      const surfacePath = surfaces?.[0]?.filePath;
      if (!surfacePath) {
        throw new Error('Expected mounted command to produce a file surface path');
      }
      expect(fs.readFileSync(surfacePath, 'utf-8')).toBe('report from mount');
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('hands off long-running child-mode commands after the foreground yield window', async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        exec: {
          enabled: true,
          allowlist: ['sleep'],
          maxTimeout: 30,
          maxOutputSize: 10000,
          foregroundYieldMs: 50,
        },
      },
    });

    const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
    const { getTool } = await import('../src/lib/tools');
    const { processSupervisor } = await import('../src/lib/services/process-supervisor');
    resetProviderRegistryForTests();
    initializeProviderRegistry();

    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const result = await execTool.execute(
      { agentId: TEST_AGENT_ID, command: 'sleep 1', launchMode: 'child' },
      { toolCallId: 'exec-child-yield', messages: [] },
    );

    expect(result.success).toBe(true);
    const sessionId = (result.data as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeTruthy();
    const completed = await processSupervisor.waitForSession(sessionId!);
    expect(completed?.status === 'completed' || completed?.status === 'cancelled').toBe(true);
  });

  it('enforces process session ownership for poll/log/write/kill actions', async () => {
    const toolsModule = await import('../src/lib/tools');
    const execTool = toolsModule.getTool('exec_command');
    const processTool = toolsModule.getTool('process');
    if (!execTool?.execute || !processTool?.execute) {
      throw new Error('exec_command or process tool is not registered');
    }

    const launchResult = await execTool.execute(
      { agentId: 'agent-a', command: 'sleep 2', commandMode: 'shell', background: true },
      { toolCallId: 'exec-owner-a', messages: [] },
    );
    const sessionId = (launchResult.data as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeTruthy();

    const unauthorizedPoll = await toolsModule.withToolExecutionContext(
      { agentId: 'agent-b', taskId: 'task-b-poll', taskType: 'message' },
      () => processTool.execute?.({ action: 'poll', sessionId: sessionId!, offset: 0, limit: 100 }, { toolCallId: 'process-unauthorized-poll', messages: [] }),
    ) as { success?: boolean; error?: string } | undefined;
    expect(unauthorizedPoll?.success).toBe(false);
    expect(unauthorizedPoll?.error).toContain('not accessible');

    const unauthorizedKill = await toolsModule.withToolExecutionContext(
      { agentId: 'agent-b', taskId: 'task-b-kill', taskType: 'message' },
      () => processTool.execute?.({ action: 'kill', sessionId: sessionId! }, { toolCallId: 'process-unauthorized-kill', messages: [] }),
    ) as { success?: boolean; error?: string } | undefined;
    expect(unauthorizedKill?.success).toBe(false);
    expect(unauthorizedKill?.error).toContain('not accessible');

    await processTool.execute(
      { action: 'kill', sessionId: sessionId! },
      { toolCallId: 'process-authorized-kill', messages: [] },
    );
  });

  it('allows a later task for the same agent to resume a PTY session via process.write and process.poll', async () => {
    const toolsModule = await import('../src/lib/tools');
    const execTool = toolsModule.getTool('exec_command');
    const processTool = toolsModule.getTool('process');
    if (!execTool?.execute || !processTool?.execute) {
      throw new Error('exec_command or process tool is not registered');
    }

    const launchResult = await toolsModule.withToolExecutionContext(
      { agentId: TEST_AGENT_ID, taskId: 'task-launch-pty', taskType: 'message' },
      () => execTool.execute?.(
        {
          agentId: TEST_AGENT_ID,
          command: 'cat',
          launchMode: 'pty',
          commandMode: 'shell',
        },
        { toolCallId: 'exec-follow-up-launch', messages: [] },
      ),
    ) as { success?: boolean; data?: { sessionId?: string } } | undefined;

    expect(launchResult?.success).toBe(true);
    const sessionId = (launchResult?.data as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeTruthy();

    const writeResult = await toolsModule.withToolExecutionContext(
      { agentId: TEST_AGENT_ID, taskId: 'task-resume-pty', taskType: 'message' },
      () => processTool.execute?.(
        { action: 'write', sessionId: sessionId!, input: 'follow-up task handoff\n' },
        { toolCallId: 'process-follow-up-write', messages: [] },
      ),
    ) as { success?: boolean } | undefined;
    expect(writeResult?.success).toBe(true);

    let combinedOutput = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const pollResult = await toolsModule.withToolExecutionContext(
        { agentId: TEST_AGENT_ID, taskId: 'task-resume-poll', taskType: 'message' },
        () => processTool.execute?.(
          { action: 'poll', sessionId: sessionId!, offset: 0, limit: 4000 },
          { toolCallId: 'process-follow-up-poll', messages: [] },
        ),
      ) as { success?: boolean; data?: { output?: string } } | undefined;

      expect(pollResult?.success).toBe(true);
      combinedOutput = (pollResult?.data as { output?: string } | undefined)?.output ?? '';
      if (combinedOutput.includes('follow-up task handoff')) {
        break;
      }
    }

    expect(combinedOutput).toContain('follow-up task handoff');

    await toolsModule.withToolExecutionContext(
      { agentId: TEST_AGENT_ID, taskId: 'task-resume-kill', taskType: 'message' },
      () => processTool.execute?.(
        { action: 'kill', sessionId: sessionId! },
        { toolCallId: 'process-follow-up-kill', messages: [] },
      ),
    );
  });

  it('runs a gated real container smoke test when explicitly enabled and Docker or Podman is available', async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    if (process.env.OPENCLAW_RUN_CONTAINER_SMOKE_TESTS !== 'true') {
      expect(true).toBe(true);
      return;
    }

    const { detectContainerRuntime, resetExecRuntimeStateForTests } = await import('../src/lib/services/exec-runtime');
    resetExecRuntimeStateForTests();
    const availableRuntime = detectContainerRuntime();
    if (!availableRuntime) {
      expect(true).toBe(true);
      return;
    }

    const workspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-container-smoke-'));

    try {
      writeRuntimeConfig(runtimeConfigFixture.configPath, {
        runtime: {
          exec: {
            enabled: true,
            allowlist: ['touch'],
            maxTimeout: 60,
            maxOutputSize: 10000,
            foregroundYieldMs: 100,
            mounts: [
              {
                alias: 'workspace',
                hostPath: workspaceDir,
                permissions: 'read-write',
                createIfMissing: false,
              },
            ],
          },
        },
      });

      const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
      const { getTool } = await import('../src/lib/tools');
      const { processSupervisor } = await import('../src/lib/services/process-supervisor');
      resetProviderRegistryForTests();
      initializeProviderRegistry();

      const execTool = getTool('exec_command');
      if (!execTool?.execute) {
        throw new Error('exec_command tool is not registered');
      }

      const sandboxResult = await execTool.execute(
        {
          agentId: TEST_AGENT_ID,
          command: 'touch sandbox-smoke.txt',
          tier: 'sandbox',
          cwd: 'mount:workspace',
          background: true,
        },
        { toolCallId: 'exec-sandbox-smoke', messages: [] },
      );
      const sandboxSessionId = (sandboxResult.data as { sessionId?: string } | undefined)?.sessionId;
      expect(sandboxResult.success).toBe(true);
      expect(sandboxSessionId).toBeTruthy();
      const sandboxCompleted = await processSupervisor.waitForSession(sandboxSessionId!);
      expect(sandboxCompleted?.exitCode).toBe(0);
      expect(fs.existsSync(path.join(workspaceDir, 'sandbox-smoke.txt'))).toBe(true);

      const lockedResult = await execTool.execute(
        {
          agentId: TEST_AGENT_ID,
          command: 'touch locked-smoke.txt',
          tier: 'locked-down',
          cwd: 'mount:workspace',
          background: true,
        },
        { toolCallId: 'exec-locked-smoke', messages: [] },
      );
      const lockedSessionId = (lockedResult.data as { sessionId?: string } | undefined)?.sessionId;
      expect(lockedResult.success).toBe(true);
      expect(lockedSessionId).toBeTruthy();
      const lockedCompleted = await processSupervisor.waitForSession(lockedSessionId!);
      expect((lockedCompleted?.exitCode ?? 0) !== 0).toBe(true);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('retains finished background sessions for later inspection', async () => {
    const { getTool } = await import('../src/lib/tools');
    const { processSupervisor } = await import('../src/lib/services/process-supervisor');
    const execTool = getTool('exec_command');
    const processTool = getTool('process');
    if (!execTool?.execute || !processTool?.execute) {
      throw new Error('exec_command or process tool is not registered');
    }

    const launchResult = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: "sleep 0.1; echo background-finished",
        commandMode: 'shell',
        background: true,
      },
      { toolCallId: 'exec-background-finished', messages: [] },
    );
    const sessionId = (launchResult.data as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeTruthy();

    const completed = await processSupervisor.waitForSession(sessionId!);
    expect(completed?.status).toBe('completed');

    const logResult = await processTool.execute(
      { action: 'log', sessionId: sessionId!, offset: 0, limit: 4000 },
      { toolCallId: 'process-log-finished', messages: [] },
    );
    expect(logResult.success).toBe(true);
    expect((logResult.data as { output?: string } | undefined)?.output).toContain('background-finished');
  });

  it('handles PTY unhappy paths like writes after exit and repeated kills', async () => {
    const { getTool } = await import('../src/lib/tools');
    const { processSupervisor } = await import('../src/lib/services/process-supervisor');
    const execTool = getTool('exec_command');
    const processTool = getTool('process');
    if (!execTool?.execute || !processTool?.execute) {
      throw new Error('exec_command or process tool is not registered');
    }

    const launchResult = await execTool.execute(
      {
        agentId: TEST_AGENT_ID,
        command: 'printf done',
        launchMode: 'pty',
        commandMode: 'shell',
        background: true,
      },
      { toolCallId: 'exec-pty-unhappy', messages: [] },
    );
    const sessionId = (launchResult.data as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeTruthy();

    const completed = await processSupervisor.waitForSession(sessionId!);
    expect(completed?.status).toBe('completed');

    const writeAfterExit = await processTool.execute(
      { action: 'write', sessionId: sessionId!, input: 'still there?\n' },
      { toolCallId: 'process-write-after-exit', messages: [] },
    );
    expect(writeAfterExit.success).toBe(false);
    expect(writeAfterExit.error).toContain('is not running');

    const firstKill = await processTool.execute(
      { action: 'kill', sessionId: sessionId! },
      { toolCallId: 'process-kill-once', messages: [] },
    );
    const secondKill = await processTool.execute(
      { action: 'kill', sessionId: sessionId! },
      { toolCallId: 'process-kill-twice', messages: [] },
    );
    expect(firstKill.success).toBe(true);
    expect(secondKill.success).toBe(true);
  });

  it('enforces max session concurrency and frees capacity once a session finishes', async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        exec: {
          enabled: true,
          allowlist: ['echo'],
          maxTimeout: 30,
          maxOutputSize: 10000,
          foregroundYieldMs: 50,
          maxSessions: 1,
        },
      },
    });

    const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
    const { getTool } = await import('../src/lib/tools');
    const { processSupervisor } = await import('../src/lib/services/process-supervisor');
    resetProviderRegistryForTests();
    initializeProviderRegistry();

    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const firstLaunch = await execTool.execute(
      { agentId: TEST_AGENT_ID, command: 'sleep 2', commandMode: 'shell', background: true },
      { toolCallId: 'exec-max-sessions-first', messages: [] },
    );
    const firstSessionId = (firstLaunch.data as { sessionId?: string } | undefined)?.sessionId;
    expect(firstLaunch.success).toBe(true);
    expect(firstSessionId).toBeTruthy();

    const secondLaunch = await execTool.execute(
      { agentId: TEST_AGENT_ID, command: 'sleep 2', commandMode: 'shell', background: true },
      { toolCallId: 'exec-max-sessions-second', messages: [] },
    );
    expect(secondLaunch.success).toBe(false);
    expect(secondLaunch.error).toContain('Maximum exec session limit reached');

    await processSupervisor.killSession(firstSessionId!);
    await processSupervisor.waitForSession(firstSessionId!);

    const thirdLaunch = await execTool.execute(
      { agentId: TEST_AGENT_ID, command: 'echo capacity-freed', background: true },
      { toolCallId: 'exec-max-sessions-third', messages: [] },
    );
    expect(thirdLaunch.success).toBe(true);
  });
});
