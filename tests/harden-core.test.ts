/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';

let db: PrismaClient;
let sessionService: typeof import('../src/lib/services/session-service').sessionService;
let memoryService: typeof import('../src/lib/services/memory-service').memoryService;
let agentService: typeof import('../src/lib/services/agent-service').agentService;
let agentExecutor: typeof import('../src/lib/services/agent-executor').agentExecutor;
let compactSessionRoute: typeof import('../src/app/api/sessions/[id]/compact/route');
let migrateSessionContextToMessages: typeof import('../src/lib/services/session-context-migration').migrateSessionContextToMessages;
let setCountTokensImplementationForTests: typeof import('../src/lib/utils/token-counter').setCountTokensImplementationForTests;

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'harden-core.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = path.join(process.cwd(), 'data', 'memories');
const createdAgentIds = new Set<string>();
const originalEnv = {
  threshold: process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD,
  retain: process.env.OPENCLAW_SESSION_RETAIN_COUNT,
  historyCap: process.env.OPENCLAW_HISTORY_CAP_BYTES,
  historyRetention: process.env.OPENCLAW_HISTORY_RETENTION_DAYS,
};

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
  process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? 'openai';
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare harden-core test database: ${dbPush.stderr.toString()}`);
  }

  db = (await import('../src/lib/db')).db;
  sessionService = (await import('../src/lib/services/session-service')).sessionService;
  memoryService = (await import('../src/lib/services/memory-service')).memoryService;
  agentService = (await import('../src/lib/services/agent-service')).agentService;
  agentExecutor = (await import('../src/lib/services/agent-executor')).agentExecutor;
  compactSessionRoute = await import('../src/app/api/sessions/[id]/compact/route');
  migrateSessionContextToMessages = (await import('../src/lib/services/session-context-migration')).migrateSessionContextToMessages;
  setCountTokensImplementationForTests = (await import('../src/lib/utils/token-counter')).setCountTokensImplementationForTests;

  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  cleanupAgentMemoryDirs();
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = '40';
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = '10';
  process.env.OPENCLAW_HISTORY_CAP_BYTES = '51200';
  process.env.OPENCLAW_HISTORY_RETENTION_DAYS = '30';
  setCountTokensImplementationForTests(null);
});

afterEach(() => {
  setCountTokensImplementationForTests(null);
});

afterAll(async () => {
  process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD = originalEnv.threshold;
  process.env.OPENCLAW_SESSION_RETAIN_COUNT = originalEnv.retain;
  process.env.OPENCLAW_HISTORY_CAP_BYTES = originalEnv.historyCap;
  process.env.OPENCLAW_HISTORY_RETENTION_DAYS = originalEnv.historyRetention;
  cleanupAgentMemoryDirs();
  await resetDb();
  await db.$disconnect();
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

  const history = await memoryService.getMemory(agent.id, 'history');
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

test('appendHistory rotates oversized history into dated archives and cleanup removes expired files', async () => {
  process.env.OPENCLAW_HISTORY_CAP_BYTES = '120';
  process.env.OPENCLAW_HISTORY_RETENTION_DAYS = '30';

  const agent = await createAgent('Memory Rotation Agent');
  await memoryService.setMemory({
    agentId: agent.id,
    key: 'history',
    value: '# History\n\n' + 'A'.repeat(110),
    category: 'history',
  });

  await memoryService.appendHistory(agent.id, 'B'.repeat(40));

  const archivePath = path.join(MEMORY_ROOT, agent.id, 'history', `${new Date().toISOString().slice(0, 10)}.md`);
  expect(fs.existsSync(archivePath)).toBe(true);
  const archiveContent = fs.readFileSync(archivePath, 'utf-8');
  expect(archiveContent).toContain('A'.repeat(110));

  const activeHistory = await memoryService.getMemory(agent.id, 'history');
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
        context: string;
        sessionMessages: Array<{
          role: 'user' | 'assistant' | 'system';
          content: string;
          sender?: string;
          channel?: 'telegram';
          channelKey?: string;
          timestamp: string;
        }>;
        systemPrompt: string;
        model: string;
      },
    ) => string;
  };

  setCountTokensImplementationForTests((text) => text.length);

  const prompt = executor.buildPrompt(
    {
      type: 'message',
      payload: { channel: 'telegram', sender: 'bermudi', content: 'hello' },
    },
    {
      systemPrompt: 'S'.repeat(100),
      model: 'gpt-4',
      context: 'MEMORY'.repeat(600),
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
  expect(prompt).not.toContain('message-0-');
  expect(prompt).toContain('CURRENT SESSION CONTEXT');
  if (prompt.includes('RUNTIME MEMORY SNAPSHOT')) {
    expect(prompt.indexOf('CURRENT SESSION CONTEXT')).toBeLessThan(prompt.indexOf('RUNTIME MEMORY SNAPSHOT'));
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
