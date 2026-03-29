/// <reference types="bun-types" />

import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { tool } from '@ai-sdk/provider-utils';
import { z } from 'zod';

const createdDirs = new Set<string>();

function createWorkspaceDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-offload-test-'));
  createdDirs.add(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  createdDirs.clear();
  delete process.env.OPENCLAW_WORKSPACE_DIR;
});

function makeTool(executeResult: unknown) {
  return tool({
    description: 'test tool',
    inputSchema: z.object({}),
    execute: async () => executeResult,
  });
}

test('5.1: result below threshold passes through unchanged', async () => {
  const { setCountTokensImplementationForTests } = await import('../src/lib/utils/token-counter');
  const { wrapWithOffloading } = await import('../src/lib/utils/offload-wrapper');

  setCountTokensImplementationForTests(() => 100);

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const result = { success: true, data: { value: 42 } };
  const coreTool = makeTool(result);
  const wrapped = wrapWithOffloading('test_tool', coreTool, { taskId: 'task-001', threshold: 2000 });

  const output = await wrapped.execute?.({}, { toolCallId: 'tc1', messages: [] });

  expect(output).toEqual(result);
  const offloadDir = path.join(workspaceDir, 'offload', 'task-001');
  expect(fs.existsSync(offloadDir)).toBe(false);

  setCountTokensImplementationForTests(null);
});

test('5.2: result above threshold writes file and returns compact reference', async () => {
  const { setCountTokensImplementationForTests } = await import('../src/lib/utils/token-counter');
  const { wrapWithOffloading } = await import('../src/lib/utils/offload-wrapper');

  setCountTokensImplementationForTests(() => 5000);

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  // Array of 25 items serializes to ~30 JSON lines: lines 1-10 cover { + "success" + "data": [ + items 1-7
  const result = { success: true, data: Array.from({ length: 25 }, (_, i) => `item ${i + 1}`) };
  const coreTool = makeTool(result);
  const wrapped = wrapWithOffloading('web_search', coreTool, { taskId: 'task-abc', threshold: 2000 });

  const output = await wrapped.execute?.({}, { toolCallId: 'tc1', messages: [] });

  expect(typeof output).toBe('string');
  const ref = output as string;

  const offloadDir = path.join(workspaceDir, 'offload', 'task-abc');
  const offloadFile = path.join(offloadDir, 'web_search-0.md');
  expect(fs.existsSync(offloadFile)).toBe(true);

  const writtenContent = fs.readFileSync(offloadFile, 'utf-8');
  expect(writtenContent).toContain('"item 1"');
  expect(writtenContent).toContain('"item 25"');

  expect(ref).toContain('Tool result offloaded to workspace file.');
  expect(ref).toContain(offloadFile);
  expect(ref).toContain('Lines:');
  expect(ref).toContain('Preview');
  expect(ref).toContain('Use read_workspace_file to retrieve the full content if needed.');
  expect(ref).toContain('"item 7"');
  expect(ref).not.toContain('"item 8"');
  expect(ref).toContain('more lines');

  setCountTokensImplementationForTests(null);
});

test('5.2 (callIndex): second call uses callIndex 1', async () => {
  const { setCountTokensImplementationForTests } = await import('../src/lib/utils/token-counter');
  const { wrapWithOffloading } = await import('../src/lib/utils/offload-wrapper');

  setCountTokensImplementationForTests(() => 5000);

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const coreTool = makeTool({ success: true, data: 'x' });
  const wrapped = wrapWithOffloading('my_tool', coreTool, { taskId: 'task-idx', threshold: 2000 });

  await wrapped.execute?.({}, { toolCallId: 'tc1', messages: [] });
  await wrapped.execute?.({}, { toolCallId: 'tc2', messages: [] });

  const offloadDir = path.join(workspaceDir, 'offload', 'task-idx');
  expect(fs.existsSync(path.join(offloadDir, 'my_tool-0.md'))).toBe(true);
  expect(fs.existsSync(path.join(offloadDir, 'my_tool-1.md'))).toBe(true);

  setCountTokensImplementationForTests(null);
});

test('5.2 (short content): content with fewer than 10 lines has no truncation indicator', async () => {
  const { setCountTokensImplementationForTests } = await import('../src/lib/utils/token-counter');
  const { wrapWithOffloading } = await import('../src/lib/utils/offload-wrapper');

  setCountTokensImplementationForTests(() => 5000);

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const shortContent = 'line A\nline B\nline C';
  const coreTool = makeTool({ success: true, data: { text: shortContent } });
  const wrapped = wrapWithOffloading('short_tool', coreTool, { taskId: 'task-short', threshold: 2000 });

  const output = (await wrapped.execute?.({}, { toolCallId: 'tc1', messages: [] })) as string;

  expect(output).not.toContain('more lines');
  expect(output).toContain('Use read_workspace_file to retrieve the full content if needed.');

  setCountTokensImplementationForTests(null);
});

test('5.3: noOffload tool with large result passes through unchanged via getToolsForAgent', async () => {
  const { getAvailableTools, registerTool, unregisterTool, getToolsForAgent, getToolsByNames } = await import('../src/lib/tools');
  const { setCountTokensImplementationForTests } = await import('../src/lib/utils/token-counter');

  setCountTokensImplementationForTests(() => 99999);

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const noOffloadResult = { success: true, data: { important: 'structured data' } };
  const noOffloadTool = makeTool(noOffloadResult);
  registerTool('test_no_offload', noOffloadTool, { riskLevel: 'low', noOffload: true });

  try {
    const wrapped = getToolsForAgent([], 'task-nooffload');
    const wrappedTool = wrapped['test_no_offload'];
    expect(wrappedTool).toBeDefined();

    const output = await wrappedTool.execute?.({}, { toolCallId: 'tc1', messages: [] });
    expect(output).toEqual(noOffloadResult);

    const offloadDir = path.join(workspaceDir, 'offload', 'task-nooffload');
    expect(fs.existsSync(offloadDir)).toBe(false);
  } finally {
    unregisterTool('test_no_offload');
    setCountTokensImplementationForTests(null);
  }
});

test('5.4: token counting failure falls back to char estimation', async () => {
  const { setCountTokensImplementationForTests, setCountTokensThrowOnErrorForTests } = await import('../src/lib/utils/token-counter');
  const { wrapWithOffloading } = await import('../src/lib/utils/offload-wrapper');

  setCountTokensThrowOnErrorForTests(true);
  setCountTokensImplementationForTests(() => { throw new Error('tokenizer failure'); });

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const shortResult = { success: true, data: 'short' };
  const coreTool = makeTool(shortResult);
  const wrapped = wrapWithOffloading('fail_tool', coreTool, { taskId: 'task-fail', threshold: 2000 });

  const output = await wrapped.execute?.({}, { toolCallId: 'tc1', messages: [] });

  const serialized = JSON.stringify(shortResult, null, 2);
  const charBasedCount = Math.ceil(serialized.length / 4);
  if (charBasedCount <= 2000) {
    expect(output).toEqual(shortResult);
  } else {
    expect(typeof output).toBe('string');
  }

  setCountTokensThrowOnErrorForTests(false);
  setCountTokensImplementationForTests(null);
});

test('5.4 (char fallback offloads large content): char estimate above threshold triggers offload', async () => {
  const { setCountTokensImplementationForTests, setCountTokensThrowOnErrorForTests } = await import('../src/lib/utils/token-counter');
  const { wrapWithOffloading } = await import('../src/lib/utils/offload-wrapper');

  setCountTokensThrowOnErrorForTests(true);
  setCountTokensImplementationForTests(() => { throw new Error('tokenizer failure'); });

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const bigContent = 'x'.repeat(8001 * 4);
  const coreTool = makeTool({ success: true, data: bigContent });
  const wrapped = wrapWithOffloading('big_fail_tool', coreTool, { taskId: 'task-bigfail', threshold: 2000 });

  const output = await wrapped.execute?.({}, { toolCallId: 'tc1', messages: [] });

  expect(typeof output).toBe('string');
  expect(output as string).toContain('Tool result offloaded to workspace file.');

  setCountTokensThrowOnErrorForTests(false);
  setCountTokensImplementationForTests(null);
});

test('5.5: cleanOffloadFiles removes scoped directory', () => {
  const workspaceDir = createWorkspaceDir();

  const { getOffloadDir, writeOffloadFile, cleanOffloadFiles } = require('../src/lib/services/workspace-service');

  writeOffloadFile('task-cleanup', 'some_tool', 0, 'content here', { workspaceDir });
  writeOffloadFile('task-cleanup', 'some_tool', 1, 'more content', { workspaceDir });

  const offloadDir = getOffloadDir('task-cleanup', { workspaceDir });
  expect(fs.existsSync(offloadDir)).toBe(true);
  expect(fs.readdirSync(offloadDir)).toHaveLength(2);

  cleanOffloadFiles('task-cleanup', { workspaceDir });

  expect(fs.existsSync(offloadDir)).toBe(false);
});

test('5.5: cleanOffloadFiles on non-existent dir does not throw', () => {
  const workspaceDir = createWorkspaceDir();
  const { cleanOffloadFiles } = require('../src/lib/services/workspace-service');

  expect(() => cleanOffloadFiles('task-nonexistent', { workspaceDir })).not.toThrow();
});

test('5.5: cleanOffloadFiles failure is caught and logged, does not propagate', () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

  try {
    const { cleanOffloadFiles } = require('../src/lib/services/workspace-service');

    const mockRmSync = mock(() => { throw new Error('permission denied'); });
    const originalRmSync = fs.rmSync.bind(fs);
    Object.defineProperty(fs, 'rmSync', { value: mockRmSync, configurable: true, writable: true });

    try {
      expect(() => cleanOffloadFiles('task-perm-err', { workspaceDir: '/some/dir' })).not.toThrow();
      expect(warnings.some(w => w.includes('task-perm-err'))).toBe(true);
    } finally {
      Object.defineProperty(fs, 'rmSync', { value: originalRmSync, configurable: true, writable: true });
    }
  } finally {
    console.warn = originalWarn;
  }
});

test('5.6: getToolsForAgent wraps tools; getToolsByNames does not', async () => {
  const { registerTool, unregisterTool, getToolsForAgent, getToolsByNames } = await import('../src/lib/tools');
  const { setCountTokensImplementationForTests } = await import('../src/lib/utils/token-counter');

  setCountTokensImplementationForTests(() => 9999);

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const largeResult = { success: true, data: 'large result data' };
  const baseTool = makeTool(largeResult);
  registerTool('test_integration_tool', baseTool, { riskLevel: 'low' });

  try {
    const agentTools = getToolsForAgent([], 'task-integration');
    const wrapped = agentTools['test_integration_tool'];
    expect(wrapped).toBeDefined();

    const agentOutput = await wrapped.execute?.({}, { toolCallId: 'tc1', messages: [] });
    const offloadDir = path.join(workspaceDir, 'offload', 'task-integration');
    expect(fs.existsSync(offloadDir)).toBe(true);
    expect(typeof agentOutput).toBe('string');
    expect(agentOutput as string).toContain('Tool result offloaded to workspace file.');

    const subagentTools = getToolsByNames(['test_integration_tool']);
    const unwrapped = subagentTools['test_integration_tool'];
    expect(unwrapped).toBeDefined();

    const subagentOutput = await unwrapped.execute?.({}, { toolCallId: 'tc2', messages: [] });
    expect(subagentOutput).toEqual(largeResult);
  } finally {
    unregisterTool('test_integration_tool');
    setCountTokensImplementationForTests(null);
  }
});

test('5.6: getToolsForAgent without taskId returns unwrapped tools', async () => {
  const { registerTool, unregisterTool, getToolsForAgent } = await import('../src/lib/tools');
  const { setCountTokensImplementationForTests } = await import('../src/lib/utils/token-counter');

  setCountTokensImplementationForTests(() => 9999);

  const workspaceDir = createWorkspaceDir();
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const result = { success: true, data: 'no taskId path' };
  const baseTool = makeTool(result);
  registerTool('test_no_taskid', baseTool, { riskLevel: 'low' });

  try {
    const tools = getToolsForAgent([]);
    const direct = tools['test_no_taskid'];
    expect(direct).toBeDefined();

    const output = await direct.execute?.({}, { toolCallId: 'tc1', messages: [] });
    expect(output).toEqual(result);
  } finally {
    unregisterTool('test_no_taskid');
    setCountTokensImplementationForTests(null);
  }
});
