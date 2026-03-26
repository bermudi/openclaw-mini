/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture, writeRuntimeConfig } from './runtime-config-fixture';

let mockResponseText = 'stub response';
let mockGenerateTextSteps: Array<Record<string, unknown>> = [];

mock.module('ai', () => ({
  generateText: async () => ({ text: mockResponseText, steps: mockGenerateTextSteps }),
  stepCountIs: () => () => true,
}));

type DeliveryServiceModule = typeof import('../src/lib/services/delivery-service');
type TelegramAdapterModule = typeof import('../src/lib/adapters/telegram-adapter');
type TaskQueueModule = typeof import('../src/lib/services/task-queue');
type AgentServiceModule = typeof import('../src/lib/services/agent-service');
type InputManagerModule = typeof import('../src/lib/services/input-manager');
type AgentExecutorModule = typeof import('../src/lib/services/agent-executor');
type TelegramWebhookRouteModule = typeof import('../src/app/api/channels/telegram/webhook/route');
type AdapterIndexModule = typeof import('../src/lib/adapters');

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'response-delivery.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = path.join(tmpdir(), 'openclaw-mini-response-delivery-memories');

let db: PrismaClient;
type DeliveryRecord = {
  id: string;
  taskId: string;
  channel: string;
  channelKey: string;
  targetJson: string;
  text: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  sentAt: Date | null;
  externalMessageId: string | null;
  dedupeKey: string;
  deliveryType?: string;
  filePath?: string | null;
};
type DeliveryModel = {
  deleteMany(): Promise<unknown>;
  findMany(): Promise<DeliveryRecord[]>;
  create(args: { data: Record<string, unknown> }): Promise<DeliveryRecord>;
  findUnique(args: { where: { id: string } }): Promise<DeliveryRecord | null>;
  findFirst(args: { where: { taskId: string } }): Promise<DeliveryRecord | null>;
  count(args: { where: { taskId: string } }): Promise<number>;
};
type DeliveryDbClient = PrismaClient & { outboundDelivery: DeliveryModel };
let deliveryService: DeliveryServiceModule;
let telegramAdapterModule: TelegramAdapterModule;
let taskQueueModule: TaskQueueModule;
let agentServiceModule: AgentServiceModule;
let inputManagerModule: InputManagerModule;
let agentExecutorModule: typeof import('../src/lib/services/agent-executor');
let telegramWebhookRoute: TelegramWebhookRouteModule;
let adapterIndexModule: AdapterIndexModule;
let initialMemoryDirs = new Set<string>();
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

const originalFetch = global.fetch;

function deliveryModel(): DeliveryModel {
  return (db as DeliveryDbClient).outboundDelivery;
}

async function resetDb() {
  await deliveryModel().deleteMany();
  await db.task.deleteMany();
  await db.session.deleteMany();
  await db.channelBinding.deleteMany();
  await db.trigger.deleteMany();
  await db.webhookLog.deleteMany();
  await db.memory.deleteMany();
  await db.auditLog.deleteMany();
  await db.agent.deleteMany();
}

async function createDefaultAgent(name: string = 'Delivery Agent') {
  const agent = await agentServiceModule.agentService.createAgent({ name });
  await agentServiceModule.agentService.setDefaultAgent(agent.id);
  return agent;
}

async function createPendingTask(agentId: string, overrides?: Partial<{ type: string; payload: Record<string, unknown>; sessionId: string }>) {
  return db.task.create({
    data: {
      agentId,
      sessionId: overrides?.sessionId,
      type: overrides?.type ?? 'message',
      priority: 3,
      status: 'pending',
      payload: JSON.stringify(overrides?.payload ?? { content: 'hello', channel: 'telegram', channelKey: 'chat-1' }),
      source: 'test',
    },
  });
}

function makeToolStep(definitions: Array<{
  toolName: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}>): Record<string, unknown> {
  return {
    toolCalls: definitions.map((definition, index) => ({
      toolCallId: `tool-call-${index}`,
      toolName: definition.toolName,
      input: definition.input ?? {},
    })),
    toolResults: definitions.map((definition, index) => ({
      toolCallId: `tool-call-${index}`,
      toolName: definition.toolName,
      output: definition.output ?? { success: true },
    })),
  };
}

function captureInitialMemoryDirs() {
  if (!fs.existsSync(MEMORY_ROOT)) {
    initialMemoryDirs = new Set();
    return;
  }

  initialMemoryDirs = new Set(fs.readdirSync(MEMORY_ROOT));
}

function cleanupMemoryDirs() {
  if (!fs.existsSync(MEMORY_ROOT)) {
    return;
  }

  for (const entry of fs.readdirSync(MEMORY_ROOT)) {
    if (!initialMemoryDirs.has(entry)) {
      fs.rmSync(path.join(MEMORY_ROOT, entry), { recursive: true, force: true });
    }
  }
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-response-delivery-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_MEMORY_DIR = MEMORY_ROOT;
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  captureInitialMemoryDirs();

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare response delivery test database: ${dbPush.stderr.toString()}`);
  }

  db = (await import('../src/lib/db')).db;
  deliveryService = await import('../src/lib/services/delivery-service');
  telegramAdapterModule = await import('../src/lib/adapters/telegram-adapter');
  taskQueueModule = await import('../src/lib/services/task-queue');
  agentServiceModule = await import('../src/lib/services/agent-service');
  inputManagerModule = await import('../src/lib/services/input-manager');
  agentExecutorModule = await import('../src/lib/services/agent-executor');
  telegramWebhookRoute = await import('../src/app/api/channels/telegram/webhook/route');
  adapterIndexModule = await import('../src/lib/adapters');

  await resetDb();
});

beforeEach(async () => {
  const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  initializeProviderRegistry();
  mockResponseText = 'stub response';
  mockGenerateTextSteps = [];
  global.fetch = originalFetch;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
  deliveryService.resetAdaptersForTests();
  adapterIndexModule.resetAdapterInitializationForTests();
  await resetDb();
});

afterAll(async () => {
  global.fetch = originalFetch;
  await resetDb();
  await db.$disconnect();
  cleanupMemoryDirs();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }
});

test('enqueueDelivery stores one row and deduplicates by dedupeKey', async () => {
  const agent = await createDefaultAgent();
  const task = await createPendingTask(agent.id);

  await deliveryService.enqueueDelivery(
    task.id,
    'telegram',
    'chat-1',
    JSON.stringify({ channel: 'telegram', channelKey: 'chat-1', metadata: { chatId: 'chat-1' } }),
    'hello',
    `task:${task.id}`,
  );
  await deliveryService.enqueueDelivery(
    task.id,
    'telegram',
    'chat-1',
    JSON.stringify({ channel: 'telegram', channelKey: 'chat-1', metadata: { chatId: 'chat-1' } }),
    'hello again',
    `task:${task.id}`,
  );

  const deliveries = await deliveryModel().findMany();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.text).toBe('hello');
});

test('dispatchDelivery marks successful sends as sent with external message id', async () => {
  const agent = await createDefaultAgent();
  const task = await createPendingTask(agent.id);

  deliveryService.registerAdapter({
    channel: 'telegram',
    sendText: async () => ({ externalMessageId: 'msg-123' }),
  });

  const delivery = await deliveryModel().create({
    data: {
      taskId: task.id,
      channel: 'telegram',
      channelKey: 'chat-1',
      targetJson: JSON.stringify({ channel: 'telegram', channelKey: 'chat-1', metadata: { chatId: 'chat-1' } }),
      text: 'hello',
      dedupeKey: `task:${task.id}`,
    },
  });

  const outcome = await deliveryService.dispatchDelivery(delivery);
  const updated = await deliveryModel().findUnique({ where: { id: delivery.id } });

  expect(outcome).toBe('sent');
  expect(updated?.status).toBe('sent');
  expect(updated?.externalMessageId).toBe('msg-123');
  expect(updated?.sentAt).toBeTruthy();
});

test('dispatchDelivery retries transient failures and respects max retries', async () => {
  const agent = await createDefaultAgent();
  const task = await createPendingTask(agent.id);

  deliveryService.registerAdapter({
    channel: 'telegram',
    sendText: async () => {
      const error = new Error('timeout talking to telegram');
      Object.assign(error, { retryable: true });
      throw error;
    },
  });

  const retryableDelivery = await deliveryModel().create({
    data: {
      taskId: task.id,
      channel: 'telegram',
      channelKey: 'chat-1',
      targetJson: JSON.stringify({ channel: 'telegram', channelKey: 'chat-1', metadata: { chatId: 'chat-1' } }),
      text: 'retry me',
      dedupeKey: `task:${task.id}:retry`,
    },
  });

  const retryOutcome = await deliveryService.dispatchDelivery(retryableDelivery);
  const retried = await deliveryModel().findUnique({ where: { id: retryableDelivery.id } });

  expect(retryOutcome).toBe('retried');
  expect(retried?.status).toBe('pending');
  expect(retried?.attempts).toBe(1);
  expect(retried?.nextAttemptAt).toBeTruthy();

  const maxRetryDelivery = await deliveryModel().create({
    data: {
      taskId: task.id,
      channel: 'telegram',
      channelKey: 'chat-1',
      targetJson: JSON.stringify({ channel: 'telegram', channelKey: 'chat-1', metadata: { chatId: 'chat-1' } }),
      text: 'final retry',
      attempts: 4,
      dedupeKey: `task:${task.id}:max`,
    },
  });

  const maxOutcome = await deliveryService.dispatchDelivery(maxRetryDelivery);
  const failed = await deliveryModel().findUnique({ where: { id: maxRetryDelivery.id } });

  expect(maxOutcome).toBe('failed');
  expect(failed?.status).toBe('failed');
  expect(failed?.attempts).toBe(5);
});

test('dispatchDelivery marks permanent failures and missing adapters as failed', async () => {
  const agent = await createDefaultAgent();
  const task = await createPendingTask(agent.id);

  deliveryService.registerAdapter({
    channel: 'telegram',
    sendText: async () => {
      const error = new Error('bot blocked');
      Object.assign(error, { retryable: false });
      throw error;
    },
  });

  const permanentDelivery = await deliveryModel().create({
    data: {
      taskId: task.id,
      channel: 'telegram',
      channelKey: 'chat-1',
      targetJson: JSON.stringify({ channel: 'telegram', channelKey: 'chat-1', metadata: { chatId: 'chat-1' } }),
      text: 'permanent fail',
      dedupeKey: `task:${task.id}:permanent`,
    },
  });

  const permanentOutcome = await deliveryService.dispatchDelivery(permanentDelivery);
  const permanentUpdated = await deliveryModel().findUnique({ where: { id: permanentDelivery.id } });

  expect(permanentOutcome).toBe('failed');
  expect(permanentUpdated?.status).toBe('failed');
  expect(permanentUpdated?.lastError).toContain('bot blocked');

  const missingAdapterDelivery = await deliveryModel().create({
    data: {
      taskId: task.id,
      channel: 'discord',
      channelKey: 'room-1',
      targetJson: JSON.stringify({ channel: 'discord', channelKey: 'room-1', metadata: {} }),
      text: 'no adapter',
      dedupeKey: `task:${task.id}:missing`,
    },
  });

  const missingOutcome = await deliveryService.dispatchDelivery(missingAdapterDelivery);
  const missingUpdated = await deliveryModel().findUnique({ where: { id: missingAdapterDelivery.id } });

  expect(missingOutcome).toBe('failed');
  expect(missingUpdated?.status).toBe('failed');
  expect(missingUpdated?.lastError).toContain('No adapter registered for channel: discord');
});

test('completeTaskTx works inside a transaction and side effects happen only when invoked after commit', async () => {
  const agent = await createDefaultAgent();
  const task = await createPendingTask(agent.id);
  const fetchCalls: Array<{ url: string; body: string }> = [];

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: input.toString(), body: String(init?.body ?? '') });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  await db.$transaction(async (tx) => {
    const updated = await taskQueueModule.taskQueue.completeTaskTx(tx, task.id, { ok: true });
    const insideTxTask = await tx.task.findUnique({ where: { id: task.id } });

    expect(updated?.status).toBe('completed');
    expect(insideTxTask?.status).toBe('completed');
    expect(fetchCalls).toHaveLength(0);
  });

  await taskQueueModule.taskQueue.completeTaskSideEffects(agent.id, task.id, 'message', { ok: true });
  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0]?.body).toContain('task:completed');
});

test('message executor creates outbound deliveries, non-message tasks do not, empty responses skip delivery, and dedupeKey stays stable', async () => {
  const agent = await createDefaultAgent();

  const messageResult = await inputManagerModule.inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: 'chat-42',
    content: 'hello',
  });

  if (!messageResult.taskId) {
    throw new Error(`Expected message task id, got: ${messageResult.error ?? 'unknown error'}`);
  }

  const execResult = await agentExecutorModule.agentExecutor.executeTask(messageResult.taskId);
  expect(execResult.success).toBe(true);

  const messageDelivery = await deliveryModel().findFirst({ where: { taskId: messageResult.taskId } });
  expect(messageDelivery?.dedupeKey).toBe(`task:${messageResult.taskId}`);
  expect(messageDelivery?.status).toBe('pending');

  await deliveryService.enqueueDelivery(
    messageResult.taskId,
    'telegram',
    'chat-42',
    JSON.stringify({ channel: 'telegram', channelKey: 'chat-42', metadata: { chatId: 'chat-42' } }),
    'duplicate',
    `task:${messageResult.taskId}`,
  );

  const dedupedCount = await deliveryModel().count({ where: { taskId: messageResult.taskId } });
  expect(dedupedCount).toBe(1);

  const heartbeatTask = await taskQueueModule.taskQueue.createTask({
    agentId: agent.id,
    type: 'heartbeat',
    priority: 7,
    payload: { triggerId: 'trigger-1', timestamp: new Date().toISOString() },
    source: 'heartbeat:test',
  });

  const heartbeatExec = await agentExecutorModule.agentExecutor.executeTask(heartbeatTask.id);
  expect(heartbeatExec.success).toBe(true);
  const heartbeatDeliveryCount = await deliveryModel().count({ where: { taskId: heartbeatTask.id } });
  expect(heartbeatDeliveryCount).toBe(0);

  mockResponseText = '   ';
  const emptyResult = await inputManagerModule.inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: 'chat-empty',
    content: 'silent',
  });

  if (!emptyResult.taskId) {
    throw new Error(`Expected empty-response task id, got: ${emptyResult.error ?? 'unknown error'}`);
  }

  const emptyExec = await agentExecutorModule.agentExecutor.executeTask(emptyResult.taskId);
  expect(emptyExec.success).toBe(true);
  const emptyDeliveryCount = await deliveryModel().count({ where: { taskId: emptyResult.taskId } });
  expect(emptyDeliveryCount).toBe(0);
});

test('message executor persists and orders surface deliveries before the response', async () => {
  const agent = await createDefaultAgent();
  mockResponseText = 'agent commentary';
  mockGenerateTextSteps = [
    makeToolStep([
      {
        toolName: 'emit_to_chat',
        output: {
          success: true,
          data: { emitted: true },
          surface: [{ type: 'text', content: 'first surfaced text' }],
        },
      },
    ]),
    makeToolStep([
      {
        toolName: 'send_file_to_chat',
        output: {
          success: true,
          data: { filePath: '/tmp/report.txt' },
          surface: [{ type: 'file', filePath: '/tmp/report.txt', caption: 'Report file' }],
        },
      },
      {
        toolName: 'exec_command',
        output: {
          success: true,
          data: { stdout: 'second surfaced text', stderr: '', exitCode: 0 },
          surface: [{ type: 'text', content: 'second surfaced text' }],
        },
      },
    ]),
  ];

  const messageResult = await inputManagerModule.inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: 'chat-surface-order',
    content: 'show me the output',
  });

  if (!messageResult.taskId) {
    throw new Error(`Expected message task id, got: ${messageResult.error ?? 'unknown error'}`);
  }

  const execResult = await agentExecutorModule.agentExecutor.executeTask(messageResult.taskId);
  expect(execResult.success).toBe(true);

  const deliveries = await deliveryModel().findMany();
  expect(deliveries).toHaveLength(4);
  expect(deliveries.map(delivery => delivery.dedupeKey)).toEqual([
    `task:${messageResult.taskId}:surface:0`,
    `task:${messageResult.taskId}:surface:1`,
    `task:${messageResult.taskId}:surface:2`,
    `task:${messageResult.taskId}`,
  ]);
  expect(deliveries.map(delivery => delivery.deliveryType ?? 'text')).toEqual(['text', 'file', 'text', 'text']);
  expect(deliveries[0]?.text).toBe('first surfaced text');
  expect(deliveries[1]?.filePath).toBe('/tmp/report.txt');
  expect(deliveries[1]?.text).toBe('Report file');
  expect(deliveries[2]?.text).toBe('second surfaced text');
  expect(deliveries[3]?.text).toBe('agent commentary');

  const completedTask = await taskQueueModule.taskQueue.getTask(messageResult.taskId);
  expect(completedTask?.result).toMatchObject({
    response: 'agent commentary',
    surfaces: [
      { type: 'text', content: 'first surfaced text' },
      { type: 'file', filePath: '/tmp/report.txt', caption: 'Report file' },
      { type: 'text', content: 'second surfaced text' },
    ],
  });
});

test('surface deliveries are skipped for non-message tasks but still stored on the task result', async () => {
  const agent = await createDefaultAgent();
  mockResponseText = 'heartbeat summary';
  mockGenerateTextSteps = [
    makeToolStep([
      {
        toolName: 'emit_to_chat',
        output: {
          success: true,
          surface: [{ type: 'text', content: 'heartbeat surface' }],
        },
      },
    ]),
  ];

  const heartbeatTask = await taskQueueModule.taskQueue.createTask({
    agentId: agent.id,
    type: 'heartbeat',
    priority: 4,
    payload: { triggerId: 'surface-heartbeat', timestamp: new Date().toISOString() },
    source: 'heartbeat:test',
  });

  const execResult = await agentExecutorModule.agentExecutor.executeTask(heartbeatTask.id);
  expect(execResult.success).toBe(true);

  const deliveryCount = await deliveryModel().count({ where: { taskId: heartbeatTask.id } });
  expect(deliveryCount).toBe(0);

  const completedTask = await taskQueueModule.taskQueue.getTask(heartbeatTask.id);
  expect(completedTask?.result).toMatchObject({
    response: 'heartbeat summary',
    surfaces: [{ type: 'text', content: 'heartbeat surface' }],
  });
});

test('send_file_to_chat returns a file surface using the current execution context', async () => {
  const agent = await createDefaultAgent();
  const sandboxService = await import('../src/lib/services/sandbox-service');
  const toolsModule = await import('../src/lib/tools');
  const sandboxRoot = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-send-file-surface-'));

  sandboxService.setSandboxRootForTests(sandboxRoot);

  try {
    const sandboxDir = sandboxService.getSandboxDir(agent.id);
    const reportPath = path.join(sandboxDir, 'report.txt');
    fs.writeFileSync(reportPath, 'surface me', 'utf-8');

    const sendFileTool = toolsModule.getTool('send_file_to_chat');
    if (!sendFileTool?.execute) {
      throw new Error('send_file_to_chat tool is not registered');
    }

    const result = await toolsModule.withToolExecutionContext(
      {
        agentId: agent.id,
        taskId: 'task-send-file-surface',
        taskType: 'message',
        deliveryTarget: { channel: 'telegram', channelKey: 'chat-file', metadata: { chatId: 'chat-file' } },
      },
      () => sendFileTool.execute?.({ agentId: agent.id, filePath: 'report.txt', caption: 'Report ready' }, { toolCallId: 'send-file', messages: [] }),
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        filePath: reportPath,
        caption: 'Report ready',
        deliveryTarget: { channel: 'telegram', channelKey: 'chat-file', metadata: { chatId: 'chat-file' } },
      },
      surface: [{ type: 'file', filePath: reportPath, caption: 'Report ready', mimeType: 'text/plain' }],
    });

    const deliveries = await deliveryModel().findMany();
    expect(deliveries).toHaveLength(0);
  } finally {
    sandboxService.setSandboxRootForTests(null);
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test('surfaces a mounted-workspace file through exec_command and delivers it end-to-end', async () => {
  if (!runtimeConfigFixture) {
    throw new Error('Runtime config fixture not initialized');
  }

  const agent = await createDefaultAgent();
  const sandboxService = await import('../src/lib/services/sandbox-service');
  const toolsModule = await import('../src/lib/tools');
  const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
  const sandboxRoot = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-exec-surface-delivery-'));
  const workspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mounted-workspace-'));
  const captured: Array<{ type: 'text' | 'file'; text?: string; filePath?: string }> = [];

  sandboxService.setSandboxRootForTests(sandboxRoot);

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
    resetProviderRegistryForTests();
    initializeProviderRegistry();

    const execTool = toolsModule.getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const execToolResult = await toolsModule.withToolExecutionContext(
      {
        agentId: agent.id,
        taskId: 'task-exec-surface-delivery',
        taskType: 'message',
        deliveryTarget: { channel: 'telegram', channelKey: 'chat-surfaced', metadata: { chatId: 'chat-surfaced' } },
      },
      () => execTool.execute?.(
        {
          agentId: agent.id,
          command: "printf 'mounted report' > report.txt",
          commandMode: 'shell',
          cwd: 'mount:workspace',
          surfaceFiles: ['report.txt'],
        },
        { toolCallId: 'exec-surface-delivery', messages: [] },
      ),
    ) as { success?: boolean; surface?: Array<{ filePath?: string }> } | undefined;

    expect(execToolResult?.success).toBe(true);
    const surfacedFilePath = (execToolResult?.surface as Array<{ filePath?: string }> | undefined)?.[0]?.filePath;
    expect(surfacedFilePath).toBeTruthy();
    expect(surfacedFilePath).not.toBe(path.join(workspaceDir, 'report.txt'));

    mockResponseText = 'report delivered';
    mockGenerateTextSteps = [
      makeToolStep([
        {
          toolName: 'exec_command',
          output: execToolResult as Record<string, unknown>,
        },
      ]),
    ];

    deliveryService.registerAdapter({
      channel: 'telegram',
      sendText: async (_target, text) => {
        captured.push({ type: 'text', text });
        return { externalMessageId: `text-${captured.length}` };
      },
      sendFile: async (_target, filePath, opts) => {
        captured.push({ type: 'file', filePath, text: opts?.caption });
        return { externalMessageId: `file-${captured.length}` };
      },
    });

    const messageResult = await inputManagerModule.inputManager.processInput({
      type: 'message',
      channel: 'telegram',
      channelKey: 'chat-surfaced',
      content: 'deliver a mounted report',
    });

    if (!messageResult.taskId) {
      throw new Error(`Expected message task id, got: ${messageResult.error ?? 'unknown error'}`);
    }

    const execResult = await agentExecutorModule.agentExecutor.executeTask(messageResult.taskId);
    expect(execResult.success).toBe(true);

    const pendingDeliveries = await deliveryModel().findMany();
    expect(pendingDeliveries.some(delivery => (delivery.deliveryType ?? 'text') === 'file')).toBe(true);

    const stats = await deliveryService.processPendingDeliveries();
    expect(stats.sent).toBeGreaterThanOrEqual(2);
    expect(captured.some(entry => entry.type === 'file' && entry.filePath === surfacedFilePath)).toBe(true);
    expect(captured.some(entry => entry.type === 'text' && entry.text === 'report delivered')).toBe(true);
    expect(fs.readFileSync(surfacedFilePath!, 'utf-8')).toBe('mounted report');
  } finally {
    sandboxService.setSandboxRootForTests(null);
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('telegram adapter sends text, splits long messages, and classifies errors', async () => {
  const adapter = new telegramAdapterModule.TelegramAdapter('test-token');
  const sendCalls: Array<{ chatId: string; text: string }> = [];

  const bot = (adapter as unknown as { bot: { api: { sendMessage: (chatId: string, text: string) => Promise<{ message_id: number }> } } }).bot;
  bot.api.sendMessage = async (chatId: string, text: string) => {
    sendCalls.push({ chatId, text });
    return { message_id: sendCalls.length };
  };

  const sendResult = await adapter.sendText(
    { channel: 'telegram', channelKey: '12345', metadata: { chatId: '12345' } },
    'hello back',
  );
  expect(sendResult.externalMessageId).toBe('1');
  expect(sendCalls).toHaveLength(1);
  expect(sendCalls[0]?.chatId).toBe('12345');

  await expect(
    adapter.sendText({ channel: 'telegram', channelKey: '', metadata: {} }, 'missing target'),
  ).rejects.toThrow('Telegram delivery target is missing chatId');

  sendCalls.length = 0;
  const longMessage = 'x'.repeat(4097);
  const splitResult = await adapter.sendText(
    { channel: 'telegram', channelKey: '12345', metadata: { chatId: '12345' } },
    longMessage,
  );
  expect(sendCalls).toHaveLength(2);
  expect(sendCalls[0]?.text.length).toBe(4096);
  expect(sendCalls[1]?.text.length).toBe(1);
  expect(splitResult.externalMessageId).toBe('2');

  expect(telegramAdapterModule.classifyTelegramError(new Error('network timeout')).retryable).toBe(true);
  expect(telegramAdapterModule.classifyTelegramError(new Error('bot blocked')).retryable).toBe(false);
});

test('telegram webhook route processes messages, ignores non-message updates, and enforces the optional secret token', async () => {
  const agent = await createDefaultAgent();
  expect(agent.id).toBeTruthy();

  process.env.TELEGRAM_WEBHOOK_SECRET = 'secret-123';

  const unauthorizedRequest = new NextRequest('http://localhost/api/channels/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: { text: 'hello', message_id: 1, chat: { id: 12345 } } }),
  });
  const unauthorizedResponse = await telegramWebhookRoute.POST(unauthorizedRequest);
  expect(unauthorizedResponse.status).toBe(401);

  const ignoredRequest = new NextRequest('http://localhost/api/channels/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'secret-123',
    },
    body: JSON.stringify({ edited_message: { text: 'ignored' } }),
  });
  const ignoredResponse = await telegramWebhookRoute.POST(ignoredRequest);
  expect(ignoredResponse.status).toBe(200);
  expect(await ignoredResponse.json()).toEqual({ success: true, ignored: true });

  const messageRequest = new NextRequest('http://localhost/api/channels/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'secret-123',
    },
    body: JSON.stringify({
      message: {
        text: 'hello from telegram',
        message_id: 99,
        message_thread_id: 7,
        chat: { id: 12345 },
        from: { id: 555, username: 'bermudi' },
      },
    }),
  });
  const messageResponse = await telegramWebhookRoute.POST(messageRequest);
  expect(messageResponse.status).toBe(200);

  const messageBody = await messageResponse.json() as { data?: { taskId?: string } };
  expect(messageBody.data?.taskId).toBeTruthy();

  const createdTask = await db.task.findUnique({ where: { id: messageBody.data?.taskId } });
  const payload = createdTask ? JSON.parse(createdTask.payload) as { deliveryTarget?: { metadata?: Record<string, string> } } : undefined;
  expect(payload?.deliveryTarget?.metadata?.chatId).toBe('12345');
  expect(payload?.deliveryTarget?.metadata?.threadId).toBe('7');
  expect(payload?.deliveryTarget?.metadata?.replyToMessageId).toBe('99');

  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const noSecretRequest = new NextRequest('http://localhost/api/channels/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        text: 'dev mode',
        message_id: 100,
        chat: { id: 999 },
      },
    }),
  });
  const noSecretResponse = await telegramWebhookRoute.POST(noSecretRequest);
  expect(noSecretResponse.status).toBe(200);
});
