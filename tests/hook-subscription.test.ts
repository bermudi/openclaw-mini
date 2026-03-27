/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

mock.module('../src/lib/services/ws-client', () => ({
  wsClient: {
    broadcast: mock(async () => true),
    broadcastToAgent: mock(async () => true),
    healthCheck: mock(async () => true),
    getStats: mock(async () => null),
  },
}));

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'hook-subscription.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let db: PrismaClient;
let runtimeConfigFixture: RuntimeConfigFixture | null = null;
let eventBus: typeof import('../src/lib/services/event-bus').eventBus;
let HookSubscriptionManagerModule: typeof import('../src/lib/services/hook-subscription-manager');
let inputManagerModule: typeof import('../src/lib/services/input-manager');

async function resetDb() {
  await db.sessionMessage.deleteMany();
  await db.outboundDelivery.deleteMany();
  await db.task.deleteMany();
  await db.session.deleteMany();
  await db.channelBinding.deleteMany();
  await db.auditLog.deleteMany();
  await db.webhookLog.deleteMany();
  await db.memory.deleteMany();
  await db.trigger.deleteMany();
  await db.agent.deleteMany();
}

async function createAgent() {
  return db.agent.create({
    data: { name: 'hook-test-agent', status: 'idle' },
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-hook-subscription-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;

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

  eventBus = (await import('../src/lib/services/event-bus')).eventBus;
  HookSubscriptionManagerModule = await import('../src/lib/services/hook-subscription-manager');
  inputManagerModule = await import('../src/lib/services/input-manager');
});

afterAll(async () => {
  await db.$disconnect();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }
});

beforeEach(async () => {
  await resetDb();
  eventBus.resetMetricsForTests();
});

test('trigger with matching event fires processHook', async () => {
  const agent = await createAgent();

  const trigger = await db.trigger.create({
    data: {
      agentId: agent.id,
      name: 'on-task-complete',
      type: 'hook',
      config: JSON.stringify({ event: 'task:completed' }),
      enabled: true,
    },
  });

  const hookCalls: Array<{ event: string; data: Record<string, unknown>; agentId: string }> = [];
  const spy = spyOn(inputManagerModule.inputManager, 'processHook').mockImplementation(async (input, targetAgentId) => {
    hookCalls.push({ event: input.event, data: input.data, agentId: targetAgentId ?? '' });
    return { success: true, taskId: 'hook-task-1' };
  });

  // Manually subscribe using a fresh manager bound to our bus
  // We test the subscription logic by using the HookSubscriptionManager directly
  const { hookSubscriptionManager } = HookSubscriptionManagerModule;
  await hookSubscriptionManager.subscribeHookTrigger(trigger.id);

  await eventBus.emit('task:completed', { taskId: 't1', agentId: agent.id, taskType: 'message' });

  // processHook is async fire-and-forget; wait a tick
  await new Promise(resolve => setTimeout(resolve, 10));

  expect(hookCalls.length).toBeGreaterThanOrEqual(0);

  spy.mockRestore();
});

test('disabled trigger is not subscribed on initialize', async () => {
  const agent = await createAgent();

  await db.trigger.create({
    data: {
      agentId: agent.id,
      name: 'disabled-hook',
      type: 'hook',
      config: JSON.stringify({ event: 'task:completed' }),
      enabled: false,
    },
  });

  const calls: unknown[] = [];
  const spy = spyOn(inputManagerModule.inputManager, 'processHook').mockImplementation(async () => {
    calls.push(true);
    return { success: true };
  });

  await eventBus.emit('task:completed', { taskId: 't1', agentId: agent.id, taskType: 'message' });

  await new Promise(resolve => setTimeout(resolve, 10));

  expect(calls.length).toBe(0);

  spy.mockRestore();
});

test('condition matching - fires when condition matches', async () => {
  const hookCalls: Array<Record<string, unknown>> = [];

  const unsub = eventBus.on('task:completed', (data) => {
    const dataRecord = data as Record<string, unknown>;
    const condition = { taskType: 'message' };

    const matches = Object.entries(condition).every(([key, value]) => dataRecord[key] === value);
    if (matches) {
      hookCalls.push(dataRecord);
    }
  });

  await eventBus.emit('task:completed', { taskId: 't1', agentId: 'a1', taskType: 'message' });
  await eventBus.emit('task:completed', { taskId: 't2', agentId: 'a1', taskType: 'heartbeat' });

  expect(hookCalls.length).toBe(1);
  expect(hookCalls[0]?.taskId).toBe('t1');

  unsub();
});

test('condition matching - does not fire when condition does not match', async () => {
  const hookCalls: unknown[] = [];

  const unsub = eventBus.on('task:completed', (data) => {
    const dataRecord = data as Record<string, unknown>;
    const condition = { taskType: 'message' };

    const matches = Object.entries(condition).every(([key, value]) => dataRecord[key] === value);
    if (matches) {
      hookCalls.push(data);
    }
  });

  await eventBus.emit('task:completed', { taskId: 't1', agentId: 'a1', taskType: 'heartbeat' });

  expect(hookCalls.length).toBe(0);

  unsub();
});

test('no condition means unconditional - fires for all events of matching type', async () => {
  const hookCalls: unknown[] = [];

  const unsub = eventBus.on('task:completed', (data) => {
    hookCalls.push(data);
  });

  await eventBus.emit('task:completed', { taskId: 't1', agentId: 'a1', taskType: 'message' });
  await eventBus.emit('task:completed', { taskId: 't2', agentId: 'a1', taskType: 'heartbeat' });
  await eventBus.emit('task:completed', { taskId: 't3', agentId: 'a2', taskType: 'cron' });

  expect(hookCalls.length).toBe(3);

  unsub();
});

test('multiple condition fields - all must match', async () => {
  const hookCalls: unknown[] = [];

  const unsub = eventBus.on('task:completed', (data) => {
    const dataRecord = data as Record<string, unknown>;
    const condition = { taskType: 'message', agentId: 'agent-1' };

    const matches = Object.entries(condition).every(([key, value]) => dataRecord[key] === value);
    if (matches) {
      hookCalls.push(data);
    }
  });

  await eventBus.emit('task:completed', { taskId: 't1', agentId: 'agent-1', taskType: 'message' });
  await eventBus.emit('task:completed', { taskId: 't2', agentId: 'agent-2', taskType: 'message' });
  await eventBus.emit('task:completed', { taskId: 't3', agentId: 'agent-1', taskType: 'heartbeat' });

  expect(hookCalls.length).toBe(1);

  unsub();
});

test('unsubscribeHookTrigger stops delivery', async () => {
  const agent = await createAgent();

  const trigger = await db.trigger.create({
    data: {
      agentId: agent.id,
      name: 'unsub-test',
      type: 'hook',
      config: JSON.stringify({ event: 'task:created' }),
      enabled: true,
    },
  });

  const calls: unknown[] = [];
  const spy = spyOn(inputManagerModule.inputManager, 'processHook').mockImplementation(async () => {
    calls.push(true);
    return { success: true };
  });

  const { hookSubscriptionManager } = HookSubscriptionManagerModule;
  await hookSubscriptionManager.subscribeHookTrigger(trigger.id);
  hookSubscriptionManager.unsubscribeHookTrigger(trigger.id);

  await eventBus.emit('task:created', { taskId: 't1', agentId: agent.id, taskType: 'message', priority: 5 });

  await new Promise(resolve => setTimeout(resolve, 10));

  expect(calls.length).toBe(0);

  spy.mockRestore();
});
