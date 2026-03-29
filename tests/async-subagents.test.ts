/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

mock.module('ai', () => ({
  generateText: async () => ({ text: 'stub', steps: [] }),
  stepCountIs: () => () => true,
}));

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'async-subagents.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const SKILLS_DIR = path.join(tmpdir(), 'openclaw-mini-async-subagent-skills');

type TestDbClient = typeof import('../src/lib/db').db;

let db: TestDbClient;
let agentService: typeof import('../src/lib/services/agent-service').agentService;
let taskQueue: typeof import('../src/lib/services/task-queue').taskQueue;
let sessionService: typeof import('../src/lib/services/session-service').sessionService;
let toolsMap: typeof import('../src/lib/tools').tools;
let withToolExecutionContext: typeof import('../src/lib/tools').withToolExecutionContext;
let skillService: typeof import('../src/lib/services/skill-service');
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

function writeSkill(name: string, body = 'You are a focused sub-agent.') {
  const dir = path.join(SKILLS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill\nenabled: true\ntools:\n  - get_datetime\n---\n\n${body}\n`,
    'utf-8',
  );
}

async function resetDb() {
  await db.sessionMessage.deleteMany();
  await db.outboundDelivery.deleteMany();
  await db.task.deleteMany();
  await db.session.deleteMany();
  await db.channelBinding.deleteMany();
  await db.auditLog.deleteMany();
  await db.memory.deleteMany();
  await db.agent.deleteMany();
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-async-subagents-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_SKILLS_DIR = SKILLS_DIR;

  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();

  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, NO_ENV_FILE: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare test database: ${dbPush.stderr.toString()}`);
  }

  const dbModule = await import('../src/lib/db');
  db = dbModule.db;

  agentService = (await import('../src/lib/services/agent-service')).agentService;
  taskQueue = (await import('../src/lib/services/task-queue')).taskQueue;
  sessionService = (await import('../src/lib/services/session-service')).sessionService;
  const toolsModule = await import('../src/lib/tools');
  toolsMap = toolsModule.tools;
  withToolExecutionContext = toolsModule.withToolExecutionContext;
  skillService = await import('../src/lib/services/skill-service');

  fs.mkdirSync(SKILLS_DIR, { recursive: true });
});

beforeEach(async () => {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  await resetDb();
  skillService.clearSkillCache();
  if (fs.existsSync(SKILLS_DIR)) {
    fs.rmSync(SKILLS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  delete process.env.OPENCLAW_MAX_SPAWN_DEPTH;
  delete process.env.OPENCLAW_SUBAGENT_TIMEOUT;
});

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }
  if (fs.existsSync(SKILLS_DIR)) {
    fs.rmSync(SKILLS_DIR, { recursive: true, force: true });
  }
  delete process.env.OPENCLAW_SKILLS_DIR;
});

// ============================================================
// Helper: build a minimal ToolExecutionContext with registry
// ============================================================

type RegistryMap = import('../src/lib/types').AsyncTaskRecord;

function buildAsyncContext(
  agentId: string,
  taskId: string,
  registry: Map<string, RegistryMap>,
  flushFn?: () => Promise<void>,
): import('../src/lib/tools').ToolExecutionContext {
  return {
    agentId,
    taskId,
    taskType: 'message',
    sessionId: undefined,
    spawnDepth: 0,
    asyncTaskRegistry: registry,
    flushAsyncRegistry: flushFn ?? (() => Promise.resolve()),
  };
}

// ============================================================
// 7.1 cancelTask unit tests
// ============================================================

test('7.1 cancelTask returns false for non-existent task', async () => {
  const result = await taskQueue.cancelTask('nonexistent-task-id');
  expect(result).toBe(false);
});

test('7.1 cancelTask returns false for completed task', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const task = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'completed', payload: '{}', completedAt: new Date() },
  });

  const result = await taskQueue.cancelTask(task.id);
  expect(result).toBe(false);

  const updated = await db.task.findUnique({ where: { id: task.id } });
  expect(updated?.status).toBe('completed');
});

test('7.1 cancelTask returns false for already-failed task', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const task = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'failed', payload: '{}', error: 'some error', completedAt: new Date() },
  });

  const result = await taskQueue.cancelTask(task.id);
  expect(result).toBe(false);

  const updated = await db.task.findUnique({ where: { id: task.id } });
  expect(updated?.status).toBe('failed');
  expect(updated?.error).toBe('some error');
});

test('7.1 cancelTask transitions pending task to failed with reason', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const task = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}' },
  });

  const result = await taskQueue.cancelTask(task.id, 'Cancelled by supervisor');
  expect(result).toBe(true);

  const updated = await db.task.findUnique({ where: { id: task.id } });
  expect(updated?.status).toBe('failed');
  expect(updated?.error).toBe('Cancelled by supervisor');
});

test('7.1 cancelTask transitions processing task to failed', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const task = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'processing', payload: '{}', startedAt: new Date() },
  });

  const result = await taskQueue.cancelTask(task.id);
  expect(result).toBe(true);

  const updated = await db.task.findUnique({ where: { id: task.id } });
  expect(updated?.status).toBe('failed');
  expect(updated?.error).toBe('Cancelled by supervisor');
});

test('7.1 cancelTask uses default reason when none provided', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const task = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}' },
  });

  await taskQueue.cancelTask(task.id);

  const updated = await db.task.findUnique({ where: { id: task.id } });
  expect(updated?.error).toBe('Cancelled by supervisor');
});

// ============================================================
// 7.2 getTasksByIds unit tests
// ============================================================

test('7.2 getTasksByIds returns empty array for empty input', async () => {
  const result = await taskQueue.getTasksByIds([]);
  expect(result).toEqual([]);
});

test('7.2 getTasksByIds fetches all matching tasks in a single batch', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const t1 = await db.task.create({ data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}' } });
  const t2 = await db.task.create({ data: { agentId: agent.id, type: 'subagent', status: 'processing', payload: '{}', startedAt: new Date() } });
  const t3 = await db.task.create({ data: { agentId: agent.id, type: 'subagent', status: 'completed', payload: '{}', completedAt: new Date() } });

  const result = await taskQueue.getTasksByIds([t1.id, t2.id, t3.id]);
  expect(result).toHaveLength(3);
  const ids = result.map(t => t.id);
  expect(ids).toContain(t1.id);
  expect(ids).toContain(t2.id);
  expect(ids).toContain(t3.id);
});

test('7.2 getTasksByIds ignores IDs that do not exist', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const t1 = await db.task.create({ data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}' } });

  const result = await taskQueue.getTasksByIds([t1.id, 'nonexistent-id']);
  expect(result).toHaveLength(1);
  expect(result[0]!.id).toBe(t1.id);
});

// ============================================================
// 7.3 getAsyncTaskRegistry / setAsyncTaskRegistry unit tests
// ============================================================

test('7.3 getAsyncTaskRegistry returns empty map for session without registry', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const session = await sessionService.getOrCreateSession(agent.id, 'test-scope', 'internal', 'test');

  const registry = await sessionService.getAsyncTaskRegistry(session.id);
  expect(registry.size).toBe(0);
});

test('7.3 setAsyncTaskRegistry persists registry to DB', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const session = await sessionService.getOrCreateSession(agent.id, 'test-scope-2', 'internal', 'test');

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    ['task-1', { taskId: 'task-1', skill: 'my-skill', status: 'pending', createdAt: '2025-01-01T00:00:00.000Z' }],
  ]);

  await sessionService.setAsyncTaskRegistry(session.id, registry);

  const row = await db.session.findUnique({ where: { id: session.id }, select: { asyncTaskRegistry: true } });
  expect(row?.asyncTaskRegistry).not.toBeNull();
  const parsed = JSON.parse(row!.asyncTaskRegistry!) as Record<string, unknown>;
  expect(parsed['task-1']).toBeDefined();
});

test('7.3 getAsyncTaskRegistry round-trips registry through DB', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const session = await sessionService.getOrCreateSession(agent.id, 'test-scope-3', 'internal', 'test');

  const original = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    ['t-a', { taskId: 't-a', skill: 'skill-a', status: 'completed', createdAt: '2025-01-01T00:00:00.000Z', lastCheckedAt: '2025-01-02T00:00:00.000Z' }],
    ['t-b', { taskId: 't-b', skill: 'skill-b', status: 'pending', createdAt: '2025-01-03T00:00:00.000Z' }],
  ]);

  await sessionService.setAsyncTaskRegistry(session.id, original);
  const restored = await sessionService.getAsyncTaskRegistry(session.id);

  expect(restored.size).toBe(2);
  expect(restored.get('t-a')?.skill).toBe('skill-a');
  expect(restored.get('t-a')?.status).toBe('completed');
  expect(restored.get('t-a')?.lastCheckedAt).toBe('2025-01-02T00:00:00.000Z');
  expect(restored.get('t-b')?.skill).toBe('skill-b');
  expect(restored.get('t-b')?.status).toBe('pending');
});

test('7.3 getAsyncTaskRegistry returns empty map on corrupt JSON', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const session = await sessionService.getOrCreateSession(agent.id, 'corrupt-scope', 'internal', 'test');

  await db.session.update({ where: { id: session.id }, data: { asyncTaskRegistry: 'not-valid-json' } });

  const registry = await sessionService.getAsyncTaskRegistry(session.id);
  expect(registry.size).toBe(0);
});

// ============================================================
// 7.4 spawn_subagent_async tool tests
// ============================================================

test('7.4 spawn_subagent_async creates child task and adds registry entry', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('test-skill');

  const parentTask = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });

  const spawnAsyncTool = toolsMap.get('spawn_subagent_async');
  expect(spawnAsyncTool).toBeDefined();

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();
  let flushed = false;

  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, parentTask.id, registry, async () => { flushed = true; }),
    () => spawnAsyncTool!.execute!({ skill: 'test-skill', task: 'do something async' }, {} as never),
  );

  expect(result).toMatchObject({ success: true });
  const data = (result as { data?: { taskId?: string; skill?: string } }).data;
  expect(data?.taskId).toBeDefined();
  expect(data?.skill).toBe('test-skill');

  const childTask = await db.task.findUnique({ where: { id: data!.taskId! } });
  expect(childTask).not.toBeNull();
  expect(childTask?.type).toBe('subagent');

  expect(registry.has(data!.taskId!)).toBe(true);
  expect(registry.get(data!.taskId!)?.status).toBe('pending');
  expect(registry.get(data!.taskId!)?.skill).toBe('test-skill');

  expect(flushed).toBe(true);
});

test('7.4 spawn_subagent_async respects max spawn depth', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_MAX_SPAWN_DEPTH = '2';
  writeSkill('test-skill');

  const spawnAsyncTool = toolsMap.get('spawn_subagent_async');
  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();

  const context = buildAsyncContext(agent.id, 'parent-task-id', registry);
  context.spawnDepth = 2;

  const result = await withToolExecutionContext(
    context,
    () => spawnAsyncTool!.execute!({ skill: 'test-skill', task: 'too deep' }, {} as never),
  );

  expect(result).toMatchObject({ success: false });
  expect((result as { error?: string }).error).toContain('Maximum spawn depth of 2 exceeded');
  expect(registry.size).toBe(0);
});

test('7.4 spawn_subagent_async prunes oldest terminal entry when at capacity', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('test-skill');

  const parentTask = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });

  const spawnAsyncTool = toolsMap.get('spawn_subagent_async');
  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();

  const oldestTerminalId = 'old-terminal-task';
  const newerTerminalId = 'newer-terminal-task';

  for (let i = 0; i < 48; i++) {
    registry.set(`task-${i}`, {
      taskId: `task-${i}`,
      skill: 'test-skill',
      status: 'pending',
      createdAt: new Date(Date.now() - (49 - i) * 1000).toISOString(),
    });
  }
  registry.set(oldestTerminalId, {
    taskId: oldestTerminalId,
    skill: 'test-skill',
    status: 'completed',
    createdAt: new Date(Date.now() - 100_000).toISOString(),
  });
  registry.set(newerTerminalId, {
    taskId: newerTerminalId,
    skill: 'test-skill',
    status: 'failed',
    createdAt: new Date(Date.now() - 50_000).toISOString(),
  });

  expect(registry.size).toBe(50);

  await withToolExecutionContext(
    buildAsyncContext(agent.id, parentTask.id, registry),
    () => spawnAsyncTool!.execute!({ skill: 'test-skill', task: 'overflow task' }, {} as never),
  );

  expect(registry.size).toBe(50);
  expect(registry.has(oldestTerminalId)).toBe(false);
  expect(registry.has(newerTerminalId)).toBe(true);
});

test('7.4 spawn_subagent_async assigns correct spawnDepth to child', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('test-skill');

  const parentTask = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });

  const spawnAsyncTool = toolsMap.get('spawn_subagent_async');
  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();
  const context = buildAsyncContext(agent.id, parentTask.id, registry);
  context.spawnDepth = 2;

  const result = await withToolExecutionContext(
    context,
    () => spawnAsyncTool!.execute!({ skill: 'test-skill', task: 'deep async' }, {} as never),
  );

  const data = (result as { data?: { taskId?: string } }).data;
  const child = await db.task.findUnique({ where: { id: data!.taskId! } });
  expect(child?.spawnDepth).toBe(3);
});

// ============================================================
// 7.5 check_subagent tests
// ============================================================

test('7.5 check_subagent returns error for task not in registry', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();

  const checkTool = toolsMap.get('check_subagent');
  expect(checkTool).toBeDefined();

  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-task-id', registry),
    () => checkTool!.execute!({ taskId: 'nonexistent' }, {} as never),
  );

  expect(result).toMatchObject({ success: false });
  expect((result as { error?: string }).error).toContain('not found in async registry');
});

test('7.5 check_subagent returns pending status for in-flight task', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const task = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}' },
  });

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    [task.id, { taskId: task.id, skill: 'my-skill', status: 'pending', createdAt: new Date().toISOString() }],
  ]);

  let flushed = false;
  const checkTool = toolsMap.get('check_subagent');
  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry, async () => { flushed = true; }),
    () => checkTool!.execute!({ taskId: task.id }, {} as never),
  );

  expect(result).toMatchObject({ success: true });
  const data = (result as { data?: { status?: string } }).data;
  expect(data?.status).toBe('pending');
  expect(flushed).toBe(true);
  expect(registry.get(task.id)?.lastCheckedAt).toBeDefined();
});

test('7.5 check_subagent returns completed result when task is done', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const task = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'completed',
      payload: '{}', completedAt: new Date(),
      result: JSON.stringify({ response: 'Analysis complete', taskType: 'subagent' }),
    },
  });

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    [task.id, { taskId: task.id, skill: 'analyzer', status: 'pending', createdAt: new Date().toISOString() }],
  ]);

  const checkTool = toolsMap.get('check_subagent');
  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry),
    () => checkTool!.execute!({ taskId: task.id }, {} as never),
  );

  expect(result).toMatchObject({ success: true });
  const data = (result as { data?: { status?: string; response?: string } }).data;
  expect(data?.status).toBe('completed');
  expect(data?.response).toBe('Analysis complete');
  expect(registry.get(task.id)?.status).toBe('completed');
});

test('7.5 check_subagent preserves cancelled status even when DB task is failed', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const task = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'failed',
      payload: '{}', completedAt: new Date(), error: 'Cancelled by supervisor',
    },
  });

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    [task.id, { taskId: task.id, skill: 'my-skill', status: 'cancelled', createdAt: new Date().toISOString() }],
  ]);

  const checkTool = toolsMap.get('check_subagent');
  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry),
    () => checkTool!.execute!({ taskId: task.id }, {} as never),
  );

  const data = (result as { data?: { status?: string } }).data;
  expect(data?.status).toBe('cancelled');
});

// ============================================================
// 7.5 cancel_subagent tests
// ============================================================

test('7.5 cancel_subagent cancels pending task and updates registry', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const task = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}' },
  });

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    [task.id, { taskId: task.id, skill: 'my-skill', status: 'pending', createdAt: new Date().toISOString() }],
  ]);

  let flushed = false;
  const cancelTool = toolsMap.get('cancel_subagent');
  expect(cancelTool).toBeDefined();

  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry, async () => { flushed = true; }),
    () => cancelTool!.execute!({ taskId: task.id }, {} as never),
  );

  expect(result).toMatchObject({ success: true });
  expect((result as { data?: { status?: string } }).data?.status).toBe('cancelled');
  expect(flushed).toBe(true);

  const dbTask = await db.task.findUnique({ where: { id: task.id } });
  expect(dbTask?.status).toBe('failed');
  expect(dbTask?.error).toBe('Cancelled by supervisor');

  expect(registry.get(task.id)?.status).toBe('cancelled');
});

test('7.5 cancel_subagent returns error when task is already completed', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const task = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'completed',
      payload: '{}', completedAt: new Date(),
      result: JSON.stringify({ response: 'done', taskType: 'subagent' }),
    },
  });

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    [task.id, { taskId: task.id, skill: 'my-skill', status: 'pending', createdAt: new Date().toISOString() }],
  ]);

  const cancelTool = toolsMap.get('cancel_subagent');
  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry),
    () => cancelTool!.execute!({ taskId: task.id }, {} as never),
  );

  expect(result).toMatchObject({ success: false });
  expect((result as { error?: string }).error).toContain('already completed');
  expect(registry.get(task.id)?.status).toBe('completed');
});

test('7.5 cancel_subagent returns error for task not in registry', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();

  const cancelTool = toolsMap.get('cancel_subagent');
  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry),
    () => cancelTool!.execute!({ taskId: 'ghost-task' }, {} as never),
  );

  expect(result).toMatchObject({ success: false });
  expect((result as { error?: string }).error).toContain('not found in async registry');
});

// ============================================================
// 7.5 list_subagents tests
// ============================================================

test('7.5 list_subagents returns empty list for empty registry', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();

  const listTool = toolsMap.get('list_subagents');
  expect(listTool).toBeDefined();

  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry),
    () => listTool!.execute!({}, {} as never),
  );

  expect(result).toMatchObject({ success: true });
  const data = (result as { data?: { tasks?: unknown[] } }).data;
  expect(data?.tasks).toHaveLength(0);
});

test('7.5 list_subagents batch-fetches live status for non-terminal entries', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const pendingTask = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'processing', payload: '{}', startedAt: new Date() },
  });
  const completedTask = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'completed', payload: '{}', completedAt: new Date() },
  });

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    [pendingTask.id, { taskId: pendingTask.id, skill: 'skill-a', status: 'pending', createdAt: new Date().toISOString() }],
    [completedTask.id, { taskId: completedTask.id, skill: 'skill-b', status: 'completed', createdAt: new Date().toISOString() }],
  ]);

  let flushed = false;
  const listTool = toolsMap.get('list_subagents');
  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry, async () => { flushed = true; }),
    () => listTool!.execute!({}, {} as never),
  );

  expect(result).toMatchObject({ success: true });
  const data = (result as { data?: { tasks?: Array<{ taskId: string; status: string }> } }).data;
  expect(data?.tasks).toHaveLength(2);

  const pendingEntry = data?.tasks?.find(t => t.taskId === pendingTask.id);
  expect(pendingEntry?.status).toBe('processing');
  expect(registry.get(pendingTask.id)?.status).toBe('processing');

  expect(flushed).toBe(true);
});

test('7.5 list_subagents skips DB fetch when registry is all terminal', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>([
    ['done-1', { taskId: 'done-1', skill: 'skill-a', status: 'completed', createdAt: new Date().toISOString() }],
    ['done-2', { taskId: 'done-2', skill: 'skill-b', status: 'cancelled', createdAt: new Date().toISOString() }],
  ]);

  let flushed = false;
  const listTool = toolsMap.get('list_subagents');
  const result = await withToolExecutionContext(
    buildAsyncContext(agent.id, 'parent-id', registry, async () => { flushed = true; }),
    () => listTool!.execute!({}, {} as never),
  );

  expect(result).toMatchObject({ success: true });
  const data = (result as { data?: { tasks?: unknown[] } }).data;
  expect(data?.tasks).toHaveLength(2);
  expect(flushed).toBe(false);
});

// ============================================================
// 7.6 Lifecycle: cascadeFailToChildren skips already-failed children
// ============================================================

test('7.6 failChildTasks does not update already-failed children', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const parent = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });
  const alreadyFailed = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'failed', payload: '{}',
      parentTaskId: parent.id, error: 'Cancelled by supervisor', completedAt: new Date(),
    },
  });
  const pending = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}', parentTaskId: parent.id },
  });

  await taskQueue.failChildTasks(parent.id, 'Parent task failed');

  const updatedAlreadyFailed = await db.task.findUnique({ where: { id: alreadyFailed.id } });
  const updatedPending = await db.task.findUnique({ where: { id: pending.id } });

  expect(updatedAlreadyFailed?.error).toBe('Cancelled by supervisor');
  expect(updatedAlreadyFailed?.status).toBe('failed');
  expect(updatedPending?.status).toBe('failed');
  expect(updatedPending?.error).toBe('Parent task failed');
});

// ============================================================
// 7.6 Lifecycle: orphaned-sweep ignores terminal tasks (incl. cancelled)
// ============================================================

test('7.6 orphaned-sweep does not re-fail a cancelled (failed) subagent', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_SUBAGENT_TIMEOUT = '60';

  const oldStartedAt = new Date(Date.now() - 400_000);
  const cancelled = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'failed',
      payload: '{}', startedAt: oldStartedAt,
      error: 'Cancelled by supervisor', completedAt: new Date(),
    },
  });

  const count = await taskQueue.sweepOrphanedSubagents();

  expect(count).toBe(0);
  const updated = await db.task.findUnique({ where: { id: cancelled.id } });
  expect(updated?.status).toBe('failed');
  expect(updated?.error).toBe('Cancelled by supervisor');
});

test('7.6 orphaned-sweep does not re-fail a completed subagent', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_SUBAGENT_TIMEOUT = '60';

  const oldStartedAt = new Date(Date.now() - 400_000);
  const completed = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'completed',
      payload: '{}', startedAt: oldStartedAt, completedAt: new Date(),
    },
  });

  const count = await taskQueue.sweepOrphanedSubagents();

  expect(count).toBe(0);
  const updated = await db.task.findUnique({ where: { id: completed.id } });
  expect(updated?.status).toBe('completed');
});

// ============================================================
// 7.7 Integration: dispatch → check → result retrieval
// ============================================================

test('7.7 integration: spawn_subagent_async dispatch → check pending → check completed', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('researcher');

  const spawnAsyncTool = toolsMap.get('spawn_subagent_async');
  const checkTool = toolsMap.get('check_subagent');

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();

  const parentTask = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });

  const spawnResult = await withToolExecutionContext(
    buildAsyncContext(agent.id, parentTask.id, registry),
    () => spawnAsyncTool!.execute!({ skill: 'researcher', task: 'research topic X' }, {} as never),
  );

  expect(spawnResult).toMatchObject({ success: true });
  const childTaskId = (spawnResult as { data?: { taskId?: string } }).data?.taskId!;
  expect(childTaskId).toBeDefined();
  expect(registry.get(childTaskId)?.status).toBe('pending');

  const checkPendingResult = await withToolExecutionContext(
    buildAsyncContext(agent.id, parentTask.id, registry),
    () => checkTool!.execute!({ taskId: childTaskId }, {} as never),
  );

  expect(checkPendingResult).toMatchObject({ success: true });
  expect((checkPendingResult as { data?: { status?: string } }).data?.status).toBe('pending');

  await db.task.update({
    where: { id: childTaskId },
    data: {
      status: 'completed',
      result: JSON.stringify({ response: 'Research complete: findings here', taskType: 'subagent' }),
      completedAt: new Date(),
    },
  });

  const checkCompletedResult = await withToolExecutionContext(
    buildAsyncContext(agent.id, parentTask.id, registry),
    () => checkTool!.execute!({ taskId: childTaskId }, {} as never),
  );

  expect(checkCompletedResult).toMatchObject({ success: true });
  const completedData = (checkCompletedResult as { data?: { status?: string; response?: string } }).data;
  expect(completedData?.status).toBe('completed');
  expect(completedData?.response).toBe('Research complete: findings here');
  expect(registry.get(childTaskId)?.status).toBe('completed');
});

test('7.7 integration: dispatch → cancel → check returns cancelled status', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('slow-skill');

  const spawnAsyncTool = toolsMap.get('spawn_subagent_async');
  const cancelTool = toolsMap.get('cancel_subagent');
  const checkTool = toolsMap.get('check_subagent');

  const registry = new Map<string, import('../src/lib/types').AsyncTaskRecord>();
  const parentTask = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });

  const spawnResult = await withToolExecutionContext(
    buildAsyncContext(agent.id, parentTask.id, registry),
    () => spawnAsyncTool!.execute!({ skill: 'slow-skill', task: 'long running work' }, {} as never),
  );

  const childTaskId = (spawnResult as { data?: { taskId?: string } }).data?.taskId!;

  const cancelResult = await withToolExecutionContext(
    buildAsyncContext(agent.id, parentTask.id, registry),
    () => cancelTool!.execute!({ taskId: childTaskId }, {} as never),
  );

  expect(cancelResult).toMatchObject({ success: true });
  expect((cancelResult as { data?: { status?: string } }).data?.status).toBe('cancelled');

  const checkResult = await withToolExecutionContext(
    buildAsyncContext(agent.id, parentTask.id, registry),
    () => checkTool!.execute!({ taskId: childTaskId }, {} as never),
  );

  expect(checkResult).toMatchObject({ success: true });
  expect((checkResult as { data?: { status?: string } }).data?.status).toBe('cancelled');

  const dbTask = await db.task.findUnique({ where: { id: childTaskId } });
  expect(dbTask?.status).toBe('failed');
  expect(dbTask?.error).toBe('Cancelled by supervisor');
});

test('7.7 integration: registry persists across simulated context reconstructions', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('persist-skill');

  const session = await sessionService.getOrCreateSession(agent.id, 'main', 'internal', 'main');

  const spawnAsyncTool = toolsMap.get('spawn_subagent_async');
  const parentTask = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}', sessionId: session.id },
  });

  const registry1 = await sessionService.getAsyncTaskRegistry(session.id);
  const flush1 = () => sessionService.setAsyncTaskRegistry(session.id, registry1);

  const spawnResult = await withToolExecutionContext(
    { ...buildAsyncContext(agent.id, parentTask.id, registry1, flush1), sessionId: session.id },
    () => spawnAsyncTool!.execute!({ skill: 'persist-skill', task: 'background work' }, {} as never),
  );

  const childTaskId = (spawnResult as { data?: { taskId?: string } }).data?.taskId!;
  expect(childTaskId).toBeDefined();

  const registry2 = await sessionService.getAsyncTaskRegistry(session.id);

  expect(registry2.has(childTaskId)).toBe(true);
  expect(registry2.get(childTaskId)?.skill).toBe('persist-skill');
  expect(registry2.get(childTaskId)?.status).toBe('pending');
});
