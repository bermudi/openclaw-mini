/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

let db: PrismaClient;
let sessionService: typeof import('../src/lib/services/session-service').sessionService;
let memoryService: typeof import('../src/lib/services/memory-service').memoryService;
let agentService: typeof import('../src/lib/services/agent-service').agentService;
let agentExecutor: typeof import('../src/lib/services/agent-executor').agentExecutor;
let agentByIdRoute: typeof import('../src/app/api/agents/[id]/route');
let compactSessionRoute: typeof import('../src/app/api/sessions/[id]/compact/route');
let migrateSessionContextToMessages: typeof import('../src/lib/services/session-context-migration').migrateSessionContextToMessages;
let setCountTokensImplementationForTests: typeof import('../src/lib/utils/token-counter').setCountTokensImplementationForTests;
let setCountTokensThrowOnErrorForTests: typeof import('../src/lib/utils/token-counter').setCountTokensThrowOnErrorForTests;

async function ensureSessionMessageTable(): Promise<void> {
  const tables = await db.$queryRaw<Array<{ name: string }>>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_messages'`;
  if (tables.length > 0) {
    return;
  }

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push', '--accept-data-loss'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare harden-core test database: ${dbPush.stderr.toString()}`);
  }
}

async function runTestDbPush(): Promise<void> {
  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare harden-core test database: ${dbPush.stderr.toString()}`);
  }
}

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'harden-core.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = path.join(tmpdir(), 'openclaw-mini-harden-memories');
const createdAgentIds = new Set<string>();
const originalEnv = {
  threshold: process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD,
  retain: process.env.OPENCLAW_SESSION_RETAIN_COUNT,
  historyCap: process.env.OPENCLAW_HISTORY_CAP_BYTES,
  historyRetention: process.env.OPENCLAW_HISTORY_RETENTION_DAYS,
};
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

mock.module('ai', () => ({
  generateText: async ({ system }: { system?: string }) => ({
    text: system?.includes('Summarize the earlier conversation faithfully.')
      ? 'older conversation summary'
      : 'assistant reply',
    steps: [],
  }),
  stepCountIs: () => () => true,
}));

async function resetDb() {
  await db.sessionMessage.deleteMany();
  await db.task.deleteMany();
  await db.session.deleteMany();
  await db.channelBinding.deleteMany();
  await db.trigger.deleteMany();
  await db.webhookLog.deleteMany();
  await db.memory.deleteMany();
  await db.auditLog.deleteMany();
  await db.agent.deleteMany();
}

async function createAgent(name: string) {
  const agent = await agentService.createAgent({ name });
  createdAgentIds.add(agent.id);
  return agent;
}

function cleanupAgentMemoryDirs() {
  for (const agentId of createdAgentIds) {
    fs.rmSync(path.join(MEMORY_ROOT, agentId), { recursive: true, force: true });
  }
  createdAgentIds.clear();
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';
  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-harden-core-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_MEMORY_DIR = MEMORY_ROOT;
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  await runTestDbPush();

  db = (await import('../src/lib/db')).db;
  sessionService = (await import('../src/lib/services/session-service')).sessionService;
  memoryService = (await import('../src/lib/services/memory-service')).memoryService;
  agentService = (await import('../src/lib/services/agent-service')).agentService;
  agentExecutor = (await import('../src/lib/services/agent-executor')).agentExecutor;
  agentByIdRoute = await import('../src/app/api/agents/[id]/route');
  compactSessionRoute = await import('../src/app/api/sessions/[id]/compact/route');
  migrateSessionContextToMessages = (await import('../src/lib/services/session-context-migration')).migrateSessionContextToMessages;
  const tokenCounterModule = await import('../src/lib/utils/token-counter');
  setCountTokensImplementationForTests = tokenCounterModule.setCountTokensImplementationForTests;
  setCountTokensThrowOnErrorForTests = tokenCounterModule.setCountTokensThrowOnErrorForTests;
  await ensureSessionMessageTable();

  await resetDb();
});

beforeEach(async () => {
  const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  initializeProviderRegistry();
  await resetDb();
  cleanupAgentMemoryDirs();
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = '40';
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = '10';
  process.env.OPENCLAW_HISTORY_CAP_BYTES = '51200';
  process.env.OPENCLAW_HISTORY_RETENTION_DAYS = '30';
  setCountTokensImplementationForTests(null);
  setCountTokensThrowOnErrorForTests(false);
});

afterEach(() => {
  setCountTokensImplementationForTests(null);
  setCountTokensThrowOnErrorForTests(false);
});

afterAll(async () => {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = originalEnv.threshold;
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = originalEnv.retain;
  process.env.OPENCLAW_HISTORY_CAP_BYTES = originalEnv.historyCap;
  process.env.OPENCLAW_HISTORY_RETENTION_DAYS = originalEnv.historyRetention;
  cleanupAgentMemoryDirs();
  await resetDb();
  await db.$disconnect();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }
});

test('appendToContext stores SessionMessage rows, getSessionContext formats them in order, and concurrent appends do not lose messages', async () => {
  const agent = await createAgent('Session Append Agent');
  const session = await sessionService.getOrCreateSession(agent.id, 'main', 'telegram', 'append-1');

  await sessionService.appendToContext(session.id, {
    role: 'user',
    content: 'first message',
    sender: 'bermudi',
    channel: 'telegram',
    channelKey: 'append-1',
  });

  let rows = await db.sessionMessage.findMany({
    where: { sessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.content).toBe('first message');

  const firstCreatedAt = rows[0]?.createdAt;
  if (!firstCreatedAt) {
    throw new Error('Expected first session message row to exist');
  }

  await db.sessionMessage.createMany({
    data: [
      {
        sessionId: session.id,
        role: 'assistant',
        content: 'second message',
        createdAt: new Date(firstCreatedAt.getTime() + 1_000),
      },
      {
        sessionId: session.id,
        role: 'user',
        content: 'third message',
        sender: 'bermudi',
        channel: 'telegram',
        channelKey: 'append-1',
        createdAt: new Date(firstCreatedAt.getTime() + 2_000),
      },
    ],
  });

  const formatted = await sessionService.getSessionContext(session.id);
  expect(formatted).toContain('user (bermudi) [telegram:append-1]: first message');
  expect(formatted).toContain('assistant: second message');
  expect(formatted).toContain('user (bermudi) [telegram:append-1]: third message');
  expect(formatted.indexOf('first message')).toBeLessThan(formatted.indexOf('second message'));
  expect(formatted.indexOf('second message')).toBeLessThan(formatted.indexOf('third message'));

  await Promise.all([
    sessionService.appendToContext(session.id, { role: 'assistant', content: 'parallel-1' }),
    sessionService.appendToContext(session.id, { role: 'assistant', content: 'parallel-2' }),
  ]);

  rows = await db.sessionMessage.findMany({ where: { sessionId: session.id } });
  expect(rows.some(row => row.content === 'parallel-1')).toBe(true);
  expect(rows.some(row => row.content === 'parallel-2')).toBe(true);
});

test('updateMetadata no longer writes legacy Session.context storage', async () => {
  const agent = await createAgent('Session Metadata Agent');
  const session = await sessionService.getOrCreateSession(agent.id, 'main', 'telegram', 'metadata-1');

  const before = await db.session.findUnique({
    where: { id: session.id },
    select: { context: true },
  });

  await expect(
    sessionService.updateMetadata(session.id, { replyToMessageId: 42 }),
  ).rejects.toThrow('Session metadata updates are no longer supported');

  const after = await db.session.findUnique({
    where: { id: session.id },
    select: { context: true },
  });

  expect(after?.context).toBe(before?.context);
});

test('appendToContext auto-compacts above threshold and manual compact endpoint no-ops below retention', async () => {
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = '4';
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = '2';

  const agent = await createAgent('Compaction Agent');
  const session = await sessionService.getOrCreateSession(agent.id, 'main', 'telegram', 'compact-1');

  for (const content of ['m1', 'm2', 'm3', 'm4', 'm5']) {
    await sessionService.appendToContext(session.id, {
      role: 'user',
      content,
      sender: 'bermudi',
      channel: 'telegram',
      channelKey: 'compact-1',
    });
  }

  const compactedRows = await db.sessionMessage.findMany({
    where: { sessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(compactedRows).toHaveLength(3);
  expect(compactedRows[0]?.role).toBe('system');
  expect(compactedRows[0]?.content.startsWith('[Session Summary]')).toBe(true);
  expect(compactedRows.slice(1).map(row => row.content)).toEqual(['m4', 'm5']);

  const history = await memoryService.getMemory(agent.id, 'system/history');
  expect(history?.value).toContain('m1');
  expect(history?.value).toContain('m2');
  expect(history?.value).toContain('m3');

  const smallSession = await sessionService.getOrCreateSession(agent.id, 'secondary', 'telegram', 'compact-2');
  await sessionService.appendToContext(smallSession.id, { role: 'user', content: 'only-1' });
  await sessionService.appendToContext(smallSession.id, { role: 'assistant', content: 'only-2' });

  const response = await compactSessionRoute.POST(
    new NextRequest(`http://localhost/api/sessions/${smallSession.id}/compact`, { method: 'POST' }),
    { params: Promise.resolve({ id: smallSession.id }) },
  );
  const body = await response.json() as { summarized: number; remaining: number };

  expect(response.status).toBe(200);
  expect(body.summarized).toBe(0);
  expect(body.remaining).toBe(2);
});

test('agent update API validates compactionThreshold and contextWindowOverride bounds', async () => {
  const agent = await createAgent('Validation Agent');

  const badThresholdResponse = await agentByIdRoute.PUT(
    new NextRequest(`http://localhost/api/agents/${agent.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ compactionThreshold: 0.05 }),
    }),
    { params: Promise.resolve({ id: agent.id }) },
  );
  const badThresholdBody = await badThresholdResponse.json() as { error?: string };
  expect(badThresholdResponse.status).toBe(400);
  expect(badThresholdBody.error).toContain('between 0.1 and 0.9');

  const badContextWindowResponse = await agentByIdRoute.PUT(
    new NextRequest(`http://localhost/api/agents/${agent.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextWindowOverride: 999 }),
    }),
    { params: Promise.resolve({ id: agent.id }) },
  );
  const badContextWindowBody = await badContextWindowResponse.json() as { error?: string };
  expect(badContextWindowResponse.status).toBe(400);
  expect(badContextWindowBody.error).toContain('at least 1000');

  const validResponse = await agentByIdRoute.PUT(
    new NextRequest(`http://localhost/api/agents/${agent.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ compactionThreshold: 0.6, contextWindowOverride: 1000 }),
    }),
    { params: Promise.resolve({ id: agent.id }) },
  );
  expect(validResponse.status).toBe(200);
});

test('token-based compaction triggers when session tokens exceed threshold and does not trigger below threshold', async () => {
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = '999';
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = '2';

  setCountTokensImplementationForTests((text) => text.length);

  const agent = await createAgent('Token Threshold Agent');
  await agentService.updateAgent(agent.id, {
    contextWindowOverride: 1000,
    compactionThreshold: 0.2,
  });

  const highSession = await sessionService.getOrCreateSession(agent.id, 'token-high', 'telegram', 'token-high');
  await sessionService.appendToContext(highSession.id, { role: 'user', content: 'a'.repeat(120) });
  await sessionService.appendToContext(highSession.id, { role: 'user', content: 'b'.repeat(120) });
  await sessionService.appendToContext(highSession.id, { role: 'user', content: 'c'.repeat(120) });

  const highRows = await db.sessionMessage.findMany({
    where: { sessionId: highSession.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(highRows[0]?.role).toBe('system');
  expect(highRows[0]?.content.startsWith('[Session Summary]')).toBe(true);

  const lowSession = await sessionService.getOrCreateSession(agent.id, 'token-low', 'telegram', 'token-low');
  await sessionService.appendToContext(lowSession.id, { role: 'user', content: 'x'.repeat(30) });
  await sessionService.appendToContext(lowSession.id, { role: 'user', content: 'y'.repeat(30) });
  await sessionService.appendToContext(lowSession.id, { role: 'user', content: 'z'.repeat(30) });

  const lowRows = await db.sessionMessage.findMany({
    where: { sessionId: lowSession.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(lowRows.some(row => row.role === 'system' && row.content.startsWith('[Session Summary]'))).toBe(false);
});

test('message-count threshold remains a secondary compaction trigger when token usage is low', async () => {
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = '40';
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = '10';
  process.env.OPENCLAW_SESSION_TOKEN_THRESHOLD = '0.9';

  setCountTokensImplementationForTests((text) => Math.ceil(text.length / 100));

  const agent = await createAgent('Message Fallback Agent');
  await agentService.updateAgent(agent.id, {
    contextWindowOverride: 200000,
    compactionThreshold: 0.9,
  });

  const session = await sessionService.getOrCreateSession(agent.id, 'message-fallback', 'telegram', 'message-fallback');
  for (let i = 0; i < 41; i += 1) {
    await sessionService.appendToContext(session.id, {
      role: 'user',
      content: `m-${i}`,
    });
  }

  const rows = await db.sessionMessage.findMany({
    where: { sessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(rows[0]?.role).toBe('system');
  expect(rows[0]?.content.startsWith('[Session Summary]')).toBe(true);
});

test('compaction is deferred on assistant turn and triggers on next user turn', async () => {
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = '999';
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = '2';

  setCountTokensImplementationForTests((text) => text.length);

  const agent = await createAgent('User Turn Boundary Agent');
  await agentService.updateAgent(agent.id, {
    contextWindowOverride: 200,
    compactionThreshold: 0.4,
  });

  const session = await sessionService.getOrCreateSession(agent.id, 'user-boundary', 'telegram', 'user-boundary');
  await sessionService.appendToContext(session.id, { role: 'user', content: 'u'.repeat(20) });
  await sessionService.appendToContext(session.id, { role: 'assistant', content: 'a'.repeat(100) });

  const rowsAfterAssistant = await db.sessionMessage.findMany({
    where: { sessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(rowsAfterAssistant.some(row => row.role === 'system' && row.content.startsWith('[Session Summary]'))).toBe(false);

  await sessionService.appendToContext(session.id, { role: 'user', content: 'follow-up' });

  const rowsAfterUser = await db.sessionMessage.findMany({
    where: { sessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(rowsAfterUser.some(row => row.role === 'system' && row.content.startsWith('[Session Summary]'))).toBe(true);
});

test('tokenizer failure falls back to message-count compaction check', async () => {
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = '4';
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = '2';

  setCountTokensImplementationForTests(() => {
    throw new Error('tokenizer failure');
  });
  setCountTokensThrowOnErrorForTests(true);

  const agent = await createAgent('Tokenizer Failure Agent');
  const session = await sessionService.getOrCreateSession(agent.id, 'tokenizer-fail', 'telegram', 'tokenizer-fail');

  for (const content of ['m1', 'm2', 'm3', 'm4', 'm5']) {
    await sessionService.appendToContext(session.id, { role: 'user', content });
  }

  const rows = await db.sessionMessage.findMany({
    where: { sessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(rows[0]?.role).toBe('system');
  expect(rows[0]?.content.startsWith('[Session Summary]')).toBe(true);
});

test('agents with different compaction thresholds compact at different points', async () => {
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = '999';
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = '2';

  setCountTokensImplementationForTests((text) => text.length);

  const lowThresholdAgent = await createAgent('Low Threshold Agent');
  await agentService.updateAgent(lowThresholdAgent.id, {
    contextWindowOverride: 200,
    compactionThreshold: 0.2,
  });

  const highThresholdAgent = await createAgent('High Threshold Agent');
  await agentService.updateAgent(highThresholdAgent.id, {
    contextWindowOverride: 200,
    compactionThreshold: 0.8,
  });

  const lowSession = await sessionService.getOrCreateSession(lowThresholdAgent.id, 'threshold-low', 'telegram', 'threshold-low');
  const highSession = await sessionService.getOrCreateSession(highThresholdAgent.id, 'threshold-high', 'telegram', 'threshold-high');

  for (const content of ['x'.repeat(50), 'y'.repeat(50), 'z'.repeat(50)]) {
    await sessionService.appendToContext(lowSession.id, { role: 'user', content });
    await sessionService.appendToContext(highSession.id, { role: 'user', content });
  }

  const lowRowsAfterThree = await db.sessionMessage.findMany({
    where: { sessionId: lowSession.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const highRowsAfterThree = await db.sessionMessage.findMany({
    where: { sessionId: highSession.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  expect(lowRowsAfterThree.some(row => row.role === 'system' && row.content.startsWith('[Session Summary]'))).toBe(true);
  expect(highRowsAfterThree.some(row => row.role === 'system' && row.content.startsWith('[Session Summary]'))).toBe(false);

  await sessionService.appendToContext(highSession.id, { role: 'user', content: 'w'.repeat(30) });

  const highRowsAfterFour = await db.sessionMessage.findMany({
    where: { sessionId: highSession.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  expect(highRowsAfterFour.some(row => row.role === 'system' && row.content.startsWith('[Session Summary]'))).toBe(true);
});

test('appendHistory rotates oversized history into dated archives and cleanup removes expired files', async () => {
  process.env.OPENCLAW_HISTORY_CAP_BYTES = '120';
  process.env.OPENCLAW_HISTORY_RETENTION_DAYS = '30';

  const agent = await createAgent('Memory Rotation Agent');
  await memoryService.setMemory({
    agentId: agent.id,
    key: 'system/history',
    value: '# History\n\n' + 'A'.repeat(110),
    category: 'history',
  });

  await memoryService.appendHistory(agent.id, 'B'.repeat(40));

  const archivePath = path.join(MEMORY_ROOT, agent.id, 'history', `${new Date().toISOString().slice(0, 10)}.md`);
  expect(fs.existsSync(archivePath)).toBe(true);
  const archiveContent = fs.readFileSync(archivePath, 'utf-8');
  expect(archiveContent).toContain('A'.repeat(110));

  const activeHistory = await memoryService.getMemory(agent.id, 'system/history');
  expect(activeHistory?.value).toContain('B'.repeat(40));
  expect(activeHistory?.value).not.toContain('A'.repeat(110));

  const oldArchivePath = path.join(MEMORY_ROOT, agent.id, 'history', '2025-01-01.md');
  fs.mkdirSync(path.dirname(oldArchivePath), { recursive: true });
  fs.writeFileSync(oldArchivePath, 'old archive', 'utf-8');

  const deleted = await memoryService.cleanupHistoryArchives(agent.id, 30);
  expect(deleted).toBeGreaterThanOrEqual(1);
  expect(fs.existsSync(oldArchivePath)).toBe(false);
});

test('token budgeting preserves summaries, drops oldest regular messages first, excludes memory when budget is exhausted, and falls back when tokenizer throws', async () => {
  const executor = agentExecutor as unknown as {
    buildPrompt: (
      task: {
        type: 'message';
        payload: { channel: string; sender: string; content: string };
      },
      input: {
        recallQuery: string;
        sessionMessages: Array<{
          role: 'user' | 'assistant' | 'system';
          content: string;
          sender?: string;
          channel?: 'telegram';
          channelKey?: string;
          timestamp: string;
        }>;
        systemPrompt: string;
        agent: {
          model: string | null;
          contextWindowOverride: number | null;
        };
      },
    ) => Promise<string>;
  };

  setCountTokensImplementationForTests((text) => text.length);

  const prompt = await executor.buildPrompt(
    {
      type: 'message',
      payload: { channel: 'telegram', sender: 'bermudi', content: 'hello' },
    },
    {
      systemPrompt: 'S'.repeat(100),
      agent: {
        model: 'gpt-4',
        contextWindowOverride: null,
      },
      recallQuery: 'memory query',
      sessionMessages: [
        {
          role: 'system',
          content: '[Session Summary] summary context',
          timestamp: '2026-03-19T10:00:00.000Z',
        },
        ...Array.from({ length: 12 }, (_, index) => ({
          role: 'user' as const,
          content: `message-${index}-${'x'.repeat(1_200)}`,
          sender: 'bermudi',
          channel: 'telegram' as const,
          channelKey: 'budget-1',
          timestamp: `2026-03-19T10:00:${String(index).padStart(2, '0')}.000Z`,
        })),
      ],
    },
  );

  expect(prompt).toContain('[Session Summary] summary context');
  expect(prompt).toContain('message-11-');
  expect(prompt).toContain('CURRENT SESSION CONTEXT');
  if (prompt.includes('PINNED MEMORY') || prompt.includes('PINNED AND RECALLED MEMORY')) {
    const memoryIndex = prompt.includes('PINNED MEMORY')
      ? prompt.indexOf('PINNED MEMORY')
      : prompt.indexOf('PINNED AND RECALLED MEMORY');
    expect(prompt.indexOf('CURRENT SESSION CONTEXT')).toBeLessThan(memoryIndex);
  }

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(arg => String(arg)).join(' '));
  };

  setCountTokensImplementationForTests(() => {
    throw new Error('tokenizer boom');
  });

  const fallbackTokens = (await import('../src/lib/utils/token-counter')).countTokens('abcdefgh');

  console.warn = originalWarn;
  setCountTokensImplementationForTests(null);

  expect(fallbackTokens).toBe(2);
  expect(warnings.some(message => message.includes('Falling back to character-based token estimate'))).toBe(true);
});

test('session context migration backfills valid JSON blobs, preserves timestamps, and warns on malformed JSON', async () => {
  const agent = await createAgent('Migration Agent');
  const validSession = await db.session.create({
    data: {
      agentId: agent.id,
      channel: 'telegram',
      channelKey: 'migration-valid',
      sessionScope: 'migration-valid',
      context: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'legacy one',
            sender: 'bermudi',
            channel: 'telegram',
            channelKey: 'migration-valid',
            timestamp: '2026-03-19T09:00:00.000Z',
          },
          {
            role: 'assistant',
            content: 'legacy two',
            timestamp: '2026-03-19T09:01:00.000Z',
          },
        ],
      }),
    },
  });
  const malformedSession = await db.session.create({
    data: {
      agentId: agent.id,
      channel: 'telegram',
      channelKey: 'migration-bad',
      sessionScope: 'migration-bad',
      context: '{invalid-json',
    },
  });

  const warnings: string[] = [];
  const result = await migrateSessionContextToMessages(db, {
    warn: (...args: unknown[]) => {
      warnings.push(args.map(arg => String(arg)).join(' '));
    },
  });

  const validRows = await db.sessionMessage.findMany({
    where: { sessionId: validSession.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const malformedRows = await db.sessionMessage.findMany({
    where: { sessionId: malformedSession.id },
  });

  expect(result.messagesInserted).toBe(2);
  expect(result.malformedSessions).toEqual([malformedSession.id]);
  expect(validRows).toHaveLength(2);
  expect(validRows[0]?.createdAt.toISOString()).toBe('2026-03-19T09:00:00.000Z');
  expect(validRows[1]?.createdAt.toISOString()).toBe('2026-03-19T09:01:00.000Z');
  expect(malformedRows).toHaveLength(0);
  expect(warnings.some(message => message.includes(malformedSession.id))).toBe(true);
});
