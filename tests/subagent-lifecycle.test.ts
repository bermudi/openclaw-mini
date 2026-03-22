/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

mock.module('ai', () => ({
  generateText: async () => ({ text: 'stub', steps: [] }),
  stepCountIs: () => () => true,
}));

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'subagent-lifecycle.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const SKILLS_DIR = path.join(tmpdir(), 'openclaw-mini-subagent-skills');

let db: PrismaClient;
let agentService: typeof import('../src/lib/services/agent-service').agentService;
let taskQueue: typeof import('../src/lib/services/task-queue').taskQueue;
let withSpawnSubagentContext: typeof import('../src/lib/tools').withSpawnSubagentContext;
let toolsMap: typeof import('../src/lib/tools').tools;
let skillService: typeof import('../src/lib/services/skill-service');
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

async function createParentTask(agentId: string) {
  return db.task.create({
    data: { agentId, type: 'message', status: 'processing', payload: '{}' },
  });
}

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

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-subagent-lifecycle-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;

  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();

  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
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
  const toolsModule = await import('../src/lib/tools');
  withSpawnSubagentContext = toolsModule.withSpawnSubagentContext;
  toolsMap = toolsModule.tools;
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
});

// ============================================================
// 7.1 Spawn Depth Tests
// ============================================================

test('7.1 regular task created with default spawnDepth 0', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const task = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    payload: { content: 'hello' },
  });

  expect(task.spawnDepth).toBe(0);

  const record = await db.task.findUnique({ where: { id: task.id } });
  expect(record?.spawnDepth).toBe(0);
});

test('7.1 createTask persists explicit spawnDepth in DB', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  const task = await taskQueue.createTask({
    agentId: agent.id,
    type: 'subagent',
    payload: { task: 'do something' },
    spawnDepth: 2,
  });

  expect(task.spawnDepth).toBe(2);

  const record = await db.task.findUnique({ where: { id: task.id } });
  expect(record?.spawnDepth).toBe(2);
});

test('7.1 top-level spawn creates child with depth 1', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('test-skill');

  const spawnTool = toolsMap.get('spawn_subagent');
  expect(spawnTool).toBeDefined();

  const parent = await createParentTask(agent.id);
  let childTaskId: string | undefined;
  const result = await withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parent.id, spawnDepth: 0 },
    async () => {
      const res = await spawnTool!.execute!(
        { skill: 'test-skill', task: 'do something', timeoutSeconds: 1 },
        {} as never,
      );
      // capture childTaskId from structured error (task will timeout since no worker)
      if (typeof res === 'object' && res !== null && 'data' in res) {
        const data = (res as { data?: { childTaskId?: string } }).data;
        childTaskId = data?.childTaskId;
      }
      return res;
    },
  );

  expect(childTaskId).toBeDefined();
  const child = await db.task.findUnique({ where: { id: childTaskId! } });
  expect(child?.spawnDepth).toBe(1);
});

test('7.1 nested sub-agent spawn increments depth', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('test-skill');

  const spawnTool = toolsMap.get('spawn_subagent');
  const parent = await createParentTask(agent.id);

  let childTaskId: string | undefined;
  await withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parent.id, spawnDepth: 2 },
    async () => {
      const res = await spawnTool!.execute!(
        { skill: 'test-skill', task: 'nested task', timeoutSeconds: 1 },
        {} as never,
      );
      if (typeof res === 'object' && res !== null && 'data' in res) {
        const data = (res as { data?: { childTaskId?: string } }).data;
        childTaskId = data?.childTaskId;
      }
      return res;
    },
  );

  expect(childTaskId).toBeDefined();
  const child = await db.task.findUnique({ where: { id: childTaskId! } });
  expect(child?.spawnDepth).toBe(3);
});

test('7.1 spawn at max depth is rejected without creating a task', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_MAX_SPAWN_DEPTH = '3';

  const spawnTool = toolsMap.get('spawn_subagent');
  const beforeCount = await db.task.count({ where: { type: 'subagent' } });

  const result = await withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: 'nonexistent-depth-check', spawnDepth: 3 },
    async () =>
      spawnTool!.execute!(
        { skill: 'any-skill', task: 'this should fail', timeoutSeconds: 1 },
        {} as never,
      ),
  );

  const afterCount = await db.task.count({ where: { type: 'subagent' } });
  expect(afterCount).toBe(beforeCount);

  expect(result).toMatchObject({ success: false, error: 'Maximum spawn depth of 3 exceeded' });
});

test('7.1 spawn allowed below max depth proceeds normally', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_MAX_SPAWN_DEPTH = '3';
  writeSkill('test-skill');

  const spawnTool = toolsMap.get('spawn_subagent');
  const parent = await createParentTask(agent.id);

  await withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parent.id, spawnDepth: 2 },
    async () =>
      spawnTool!.execute!(
        { skill: 'test-skill', task: 'depth-2 spawn', timeoutSeconds: 1 },
        {} as never,
      ),
  );

  const created = await db.task.findFirst({ where: { type: 'subagent', spawnDepth: 3 } });
  expect(created).not.toBeNull();
  expect(created?.spawnDepth).toBe(3);
});

// ============================================================
// 7.2 Timeout Cleanup Tests
// ============================================================

test('7.2 timeout fails child task in DB', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('test-skill');

  const spawnTool = toolsMap.get('spawn_subagent');
  const parent = await createParentTask(agent.id);
  let childTaskId: string | undefined;

  const result = await withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parent.id, spawnDepth: 0 },
    async () => {
      const res = await spawnTool!.execute!(
        { skill: 'test-skill', task: 'slow task', timeoutSeconds: 1 },
        {} as never,
      );
      if (typeof res === 'object' && res !== null && 'data' in res) {
        childTaskId = (res as { data?: { childTaskId?: string } }).data?.childTaskId;
      }
      return res;
    },
  );

  expect(result).toMatchObject({ success: false });
  expect((result as { error?: string }).error).toContain('timed out');

  expect(childTaskId).toBeDefined();
  const child = await db.task.findUnique({ where: { id: childTaskId! } });
  expect(child?.status).toBe('failed');
  expect(child?.error).toBe('Sub-agent timed out');
});

test('7.2 child that completes before timeout is not failed', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('test-skill');

  const spawnTool = toolsMap.get('spawn_subagent');

  const parent = await createParentTask(agent.id);
  // Run spawn in background
  const spawnPromise = withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parent.id, spawnDepth: 0 },
    async () =>
      spawnTool!.execute!(
        { skill: 'test-skill', task: 'quick task', timeoutSeconds: 5 },
        {} as never,
      ),
  );

  // Wait for child task to be created, then complete it
  let childTask: Awaited<ReturnType<typeof db.task.findFirst>> = null;
  for (let i = 0; i < 20; i++) {
    childTask = await db.task.findFirst({ where: { type: 'subagent' } });
    if (childTask) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  expect(childTask).not.toBeNull();

  // Mark it as processing then completed with a response
  await db.task.update({
    where: { id: childTask!.id },
    data: {
      status: 'completed',
      result: JSON.stringify({ response: 'done', taskType: 'subagent' }),
      completedAt: new Date(),
    },
  });

  const spawnResult = await spawnPromise;

  // It should succeed, not timeout
  expect(spawnResult).toMatchObject({ success: true });

  // The child task should still be completed, not failed
  const child = await db.task.findUnique({ where: { id: childTask!.id } });
  expect(child?.status).toBe('completed');
});

test('7.2 structured timeout error includes skill, depth, childTaskId', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('web-search');

  const spawnTool = toolsMap.get('spawn_subagent');
  const parent = await createParentTask(agent.id);
  let childTaskId: string | undefined;

  const result = await withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parent.id, spawnDepth: 0 },
    async () => {
      const res = await spawnTool!.execute!(
        { skill: 'web-search', task: 'find something', timeoutSeconds: 1 },
        {} as never,
      );
      if (typeof res === 'object' && res !== null && 'data' in res) {
        childTaskId = (res as { data?: { childTaskId?: string } }).data?.childTaskId;
      }
      return res;
    },
  );

  expect(result).toMatchObject({
    success: false,
    data: {
      skill: 'web-search',
      depth: 1,
      childTaskId,
    },
  });
  expect((result as { error?: string }).error).toMatch(/timed out after 1s/);
});

// ============================================================
// 7.3 Cascading Cancellation Tests
// ============================================================

test('7.3 parent fail cascades to pending children', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const parent = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });
  const child1 = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}', parentTaskId: parent.id },
  });
  const child2 = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}', parentTaskId: parent.id },
  });

  await taskQueue.failChildTasks(parent.id, 'Parent task failed');

  const updated1 = await db.task.findUnique({ where: { id: child1.id } });
  const updated2 = await db.task.findUnique({ where: { id: child2.id } });
  expect(updated1?.status).toBe('failed');
  expect(updated1?.error).toBe('Parent task failed');
  expect(updated2?.status).toBe('failed');
  expect(updated2?.error).toBe('Parent task failed');
});

test('7.3 completed children not affected by parent failure', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const parent = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });
  const completed = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'completed', payload: '{}',
      parentTaskId: parent.id, completedAt: new Date(),
    },
  });
  const pending = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}', parentTaskId: parent.id },
  });

  await taskQueue.failChildTasks(parent.id, 'Parent task failed');

  const updatedCompleted = await db.task.findUnique({ where: { id: completed.id } });
  const updatedPending = await db.task.findUnique({ where: { id: pending.id } });

  expect(updatedCompleted?.status).toBe('completed');
  expect(updatedPending?.status).toBe('failed');
});

test('7.3 nested cascade fails grandchild tasks', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const parent = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'processing', payload: '{}' },
  });
  const child = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}', parentTaskId: parent.id },
  });
  const grandchild = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}', parentTaskId: child.id },
  });

  await taskQueue.failChildTasks(parent.id, 'Parent task failed');

  const updatedChild = await db.task.findUnique({ where: { id: child.id } });
  const updatedGrandchild = await db.task.findUnique({ where: { id: grandchild.id } });

  expect(updatedChild?.status).toBe('failed');
  expect(updatedGrandchild?.status).toBe('failed');
});

test('7.3 failTask cascades to children via failChildTasks', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });

  const parent = await db.task.create({
    data: { agentId: agent.id, type: 'message', status: 'pending', payload: '{}' },
  });
  const child = await db.task.create({
    data: { agentId: agent.id, type: 'subagent', status: 'pending', payload: '{}', parentTaskId: parent.id },
  });

  await taskQueue.failTask(parent.id, 'something went wrong');

  const updatedParent = await db.task.findUnique({ where: { id: parent.id } });
  const updatedChild = await db.task.findUnique({ where: { id: child.id } });

  expect(updatedParent?.status).toBe('failed');
  expect(updatedChild?.status).toBe('failed');
  expect(updatedChild?.error).toBe('Parent task failed');
});

// ============================================================
// 7.4 Orphan Sweep Tests
// ============================================================

test('7.4 stuck sub-agent beyond threshold is failed', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_SUBAGENT_TIMEOUT = '60';

  const oldStartedAt = new Date(Date.now() - 400_000); // 400 seconds ago, threshold is 60s
  const stuck = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'processing',
      payload: '{}', startedAt: oldStartedAt,
    },
  });

  const count = await taskQueue.sweepOrphanedSubagents();

  expect(count).toBe(1);
  const updated = await db.task.findUnique({ where: { id: stuck.id } });
  expect(updated?.status).toBe('failed');
  expect(updated?.error).toBe('Orphaned sub-agent: exceeded processing timeout');
});

test('7.4 sub-agent within threshold is not affected', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_SUBAGENT_TIMEOUT = '300';

  const recentStartedAt = new Date(Date.now() - 100_000); // 100 seconds ago, threshold is 300s
  const recent = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'processing',
      payload: '{}', startedAt: recentStartedAt,
    },
  });

  const count = await taskQueue.sweepOrphanedSubagents();

  expect(count).toBe(0);
  const updated = await db.task.findUnique({ where: { id: recent.id } });
  expect(updated?.status).toBe('processing');
});

test('7.4 sweep uses default 300s threshold when env not set', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  // env not set — defaults to 300s

  const beyond = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'processing',
      payload: '{}', startedAt: new Date(Date.now() - 400_000),
    },
  });
  const within = await db.task.create({
    data: {
      agentId: agent.id, type: 'subagent', status: 'processing',
      payload: '{}', startedAt: new Date(Date.now() - 100_000),
    },
  });

  const count = await taskQueue.sweepOrphanedSubagents();

  expect(count).toBe(1);
  expect((await db.task.findUnique({ where: { id: beyond.id } }))?.status).toBe('failed');
  expect((await db.task.findUnique({ where: { id: within.id } }))?.status).toBe('processing');
});

test('7.4 sweep only targets subagent type tasks', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_SUBAGENT_TIMEOUT = '60';

  const oldStartedAt = new Date(Date.now() - 400_000);
  const messageTask = await db.task.create({
    data: {
      agentId: agent.id, type: 'message', status: 'processing',
      payload: '{}', startedAt: oldStartedAt,
    },
  });

  const count = await taskQueue.sweepOrphanedSubagents();

  expect(count).toBe(0);
  expect((await db.task.findUnique({ where: { id: messageTask.id } }))?.status).toBe('processing');
});

// ============================================================
// 7.5 Structured Error Tests
// ============================================================

test('7.5 failure returns structured data with skill, depth, childTaskId', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('web-search');

  const spawnTool = toolsMap.get('spawn_subagent');

  // Start spawn, then quickly fail the child task
  let capturedChildId: string | undefined;
  const parent = await createParentTask(agent.id);
  const spawnPromise = withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parent.id, spawnDepth: 1 },
    async () =>
      spawnTool!.execute!(
        { skill: 'web-search', task: 'search task', timeoutSeconds: 5 },
        {} as never,
      ),
  );

  // Wait for child task creation, then fail it
  let childTask: Awaited<ReturnType<typeof db.task.findFirst>> = null;
  for (let i = 0; i < 20; i++) {
    childTask = await db.task.findFirst({ where: { type: 'subagent' } });
    if (childTask) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  expect(childTask).not.toBeNull();
  capturedChildId = childTask!.id;

  await db.task.update({
    where: { id: capturedChildId },
    data: { status: 'failed', error: 'sub-agent crashed', completedAt: new Date() },
  });

  const result = await spawnPromise;

  expect(result).toMatchObject({
    success: false,
    error: 'Sub-agent failed: sub-agent crashed',
    data: {
      skill: 'web-search',
      depth: 2,
      childTaskId: capturedChildId,
    },
  });
});

test('7.5 timeout returns structured data', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  writeSkill('analyzer');

  const spawnTool = toolsMap.get('spawn_subagent');
  const parent = await createParentTask(agent.id);
  let childTaskId: string | undefined;

  const result = await withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parent.id, spawnDepth: 0 },
    async () => {
      const res = await spawnTool!.execute!(
        { skill: 'analyzer', task: 'analyze data', timeoutSeconds: 1 },
        {} as never,
      );
      if (typeof res === 'object' && res !== null && 'data' in res) {
        childTaskId = (res as { data?: { childTaskId?: string } }).data?.childTaskId;
      }
      return res;
    },
  );

  expect(childTaskId).toBeDefined();
  expect(result).toMatchObject({
    success: false,
    data: {
      skill: 'analyzer',
      depth: 1,
      childTaskId,
    },
  });
  expect((result as { error?: string }).error).toContain('timed out after 1s');
});

test('7.5 depth limit rejection returns no childTaskId (no task created)', async () => {
  const agent = await agentService.createAgent({ name: 'Agent' });
  process.env.OPENCLAW_MAX_SPAWN_DEPTH = '2';

  const spawnTool = toolsMap.get('spawn_subagent');

  const result = await withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: 'nonexistent-depth-check', spawnDepth: 2 },
    async () =>
      spawnTool!.execute!(
        { skill: 'any-skill', task: 'deep spawn', timeoutSeconds: 1 },
        {} as never,
      ),
  );

  expect(result).toMatchObject({
    success: false,
    error: 'Maximum spawn depth of 2 exceeded',
  });
  // No data field — no task was created
  expect((result as { data?: unknown }).data).toBeUndefined();
});
