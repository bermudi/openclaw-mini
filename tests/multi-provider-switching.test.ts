/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

let lastModelOverrides: { provider?: string; model?: string } = {};

mock.module('ai', () => ({
  generateText: async ({}: { system?: string; tools?: Record<string, unknown> }) => {
    return { text: 'stub response', steps: [] };
  },
  stepCountIs: () => () => true,
}));

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'multi-provider-switching.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = path.join(tmpdir(), 'openclaw-mini-multi-provider-memories');

let db: PrismaClient;
let agentService: typeof import('../src/lib/services/agent-service').agentService;
let taskQueue: typeof import('../src/lib/services/task-queue').taskQueue;
let agentExecutor: typeof import('../src/lib/services/agent-executor').agentExecutor;
let sessionProviderState: typeof import('../src/lib/services/session-provider-state').sessionProviderState;
let commandParser: typeof import('../src/lib/services/command-parser');
let runtimeConfigFixture: RuntimeConfigFixture | null = null;
const createdAgentIds = new Set<string>();

async function resetDb() {
  await db.sessionMessage.deleteMany();
  await db.task.deleteMany();
  await db.session.deleteMany();
  await db.memory.deleteMany();
  await db.auditLog.deleteMany();
  await db.agent.deleteMany();
}

async function createAgent(name: string) {
  const agent = await agentService.createAgent({ name });
  createdAgentIds.add(agent.id);
  return agent;
}

async function createMessageTask(agentId: string, sessionId: string, content: string) {
  return taskQueue.createTask({
    agentId,
    sessionId,
    type: 'message',
    priority: 3,
    payload: {
      content,
      channel: 'internal',
      channelKey: 'test',
    },
    source: 'test',
  });
}

async function createSession(agentId: string, sessionScope = 'test') {
  return db.session.create({
    data: { agentId, channel: 'internal', channelKey: 'test', sessionScope },
  });
}

function cleanupAgentMemoryDirs() {
  for (const agentId of createdAgentIds) {
    const dir = path.join(MEMORY_ROOT, agentId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  createdAgentIds.clear();
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-multi-provider-switching-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_MEMORY_DIR = MEMORY_ROOT;

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
  agentExecutor = (await import('../src/lib/services/agent-executor')).agentExecutor;
  sessionProviderState = (await import('../src/lib/services/session-provider-state')).sessionProviderState;
  commandParser = await import('../src/lib/services/command-parser');

  await resetDb();
});

beforeEach(async () => {
  const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  initializeProviderRegistry();
  sessionProviderState.resetForTests();
  lastModelOverrides = {};
  await resetDb();
  createdAgentIds.clear();
});

afterAll(async () => {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  sessionProviderState.resetForTests();
  await resetDb();
  await db.$disconnect();
  cleanupAgentMemoryDirs();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }
});

test('6.1 /provider with valid provider switches active provider and returns confirmation', async () => {
  const agent = await createAgent('Test Agent');
  const session = await createSession(agent.id, 'test-6-1');
  const task = await createMessageTask(agent.id, session.id, '/provider anthropic');

  const result = await agentExecutor.executeTask(task.id);
  expect(result.success).toBe(true);
  expect(result.response).toContain('Switched to provider: anthropic');

  const state = sessionProviderState.getOrInit(session.id);
  expect(state.activeProvider).toBe('anthropic');
});

test('6.2 /provider with invalid provider returns error listing available providers', async () => {
  const agent = await createAgent('Test Agent');
  const session = await createSession(agent.id, 'test-6-2');
  const task = await createMessageTask(agent.id, session.id, '/provider nonexistent-provider');

  const result = await agentExecutor.executeTask(task.id);
  expect(result.success).toBe(true);
  expect(result.response).toContain("Unknown provider 'nonexistent-provider'");
  expect(result.response).toContain('Available providers:');
  expect(result.response).toContain('openai');
  expect(result.response).toContain('anthropic');

  const state = sessionProviderState.getOrInit(session.id);
  expect(state.activeProvider).toBe('openai');
});

test('6.3 /model accepts any model name without pre-validation', async () => {
  const agent = await createAgent('Test Agent');
  const session = await createSession(agent.id, 'test-6-3');

  const standardTask = await createMessageTask(agent.id, session.id, '/model claude-3-5-sonnet-20241022');
  const standardResult = await agentExecutor.executeTask(standardTask.id);
  expect(standardResult.success).toBe(true);
  expect(standardResult.response).toContain('Switched to model: claude-3-5-sonnet-20241022');
  expect(sessionProviderState.getOrInit(session.id).activeModel).toBe('claude-3-5-sonnet-20241022');

  const arbitraryTask = await createMessageTask(agent.id, session.id, '/model any-string-here');
  const arbitraryResult = await agentExecutor.executeTask(arbitraryTask.id);
  expect(arbitraryResult.success).toBe(true);
  expect(arbitraryResult.response).toContain('Switched to model: any-string-here');
  expect(sessionProviderState.getOrInit(session.id).activeModel).toBe('any-string-here');
});

test('6.4 /providers lists all configured providers', async () => {
  const agent = await createAgent('Test Agent');
  const session = await createSession(agent.id, 'test-6-4');
  const task = await createMessageTask(agent.id, session.id, '/providers');

  const result = await agentExecutor.executeTask(task.id);
  expect(result.success).toBe(true);
  expect(result.response).toContain('Available providers:');
  expect(result.response).toContain('openai');
  expect(result.response).toContain('anthropic');
  expect(result.response).toContain('openrouter');
});

test('6.4b /help is handled as a deterministic slash command', async () => {
  const agent = await createAgent('Test Agent');
  const session = await createSession(agent.id, 'test-6-4b');
  const task = await createMessageTask(agent.id, session.id, '/help');

  const result = await agentExecutor.executeTask(task.id);
  expect(result.success).toBe(true);
  expect(result.response).toContain('**Help**');
  expect(result.response).toContain('You can talk to me in plain English');
  expect(result.response).toContain('For greetings or status checks, I should just reply directly without testing tools.');
});

test('6.5 session isolation: multiple sessions maintain independent provider state', async () => {
  const agent = await createAgent('Test Agent');
  const sessionA = await createSession(agent.id, 'test-6-5-a');
  const sessionB = await createSession(agent.id, 'test-6-5-b');

  const taskA = await createMessageTask(agent.id, sessionA.id, '/provider anthropic');
  await agentExecutor.executeTask(taskA.id);

  const taskB = await createMessageTask(agent.id, sessionB.id, '/provider openrouter');
  await agentExecutor.executeTask(taskB.id);

  const stateA = sessionProviderState.getOrInit(sessionA.id);
  const stateB = sessionProviderState.getOrInit(sessionB.id);

  expect(stateA.activeProvider).toBe('anthropic');
  expect(stateB.activeProvider).toBe('openrouter');
  expect(stateA.activeProvider).not.toBe(stateB.activeProvider);
});

test('6.6 new session uses config defaults, not previous session switches', async () => {
  const agent = await createAgent('Test Agent');
  const sessionOld = await createSession(agent.id, 'test-6-6-old');

  const switchTask = await createMessageTask(agent.id, sessionOld.id, '/provider anthropic');
  await agentExecutor.executeTask(switchTask.id);
  expect(sessionProviderState.getOrInit(sessionOld.id).activeProvider).toBe('anthropic');

  const sessionNew = await createSession(agent.id, 'test-6-6-new');
  const newState = sessionProviderState.getOrInit(sessionNew.id);
  expect(newState.activeProvider).toBe('openai');
  expect(newState.activeModel).toBe('gpt-4.1-mini');
});

test('command-parser correctly parses all command types', () => {
  expect(commandParser.parseCommand('/help')).toEqual({ type: 'help' });
  expect(commandParser.parseCommand('/providers')).toEqual({ type: 'list-providers' });
  expect(commandParser.parseCommand('/provider anthropic')).toEqual({ type: 'switch-provider', providerName: 'anthropic' });
  expect(commandParser.parseCommand('/model gpt-4.1-mini')).toEqual({ type: 'switch-model', modelName: 'gpt-4.1-mini' });
  expect(commandParser.parseCommand('/provider')).toEqual({ type: 'invalid-command', error: 'Usage: /provider <name>' });
  expect(commandParser.parseCommand('/model')).toEqual({ type: 'invalid-command', error: 'Usage: /model <name>' });
  expect(commandParser.parseCommand('/new')).toEqual({ type: 'clear-session' });
  expect(commandParser.parseCommand('/clear')).toEqual({ type: 'clear-session' });
  expect(commandParser.parseCommand('hello world')).toEqual({ type: 'not-command' });
  expect(commandParser.parseCommand('tell me something')).toEqual({ type: 'not-command' });
  expect(commandParser.parseCommand('  /provider  anthropic  ')).toMatchObject({ type: 'switch-provider', providerName: 'anthropic' });
});

test('command-parser handles /provider and /model with extra whitespace', () => {
  const providerResult = commandParser.parseCommand('  /provider  openai  ');
  expect(providerResult).toMatchObject({ type: 'switch-provider', providerName: 'openai' });

  const modelResult = commandParser.parseCommand('  /model  gpt-4  ');
  expect(modelResult).toMatchObject({ type: 'switch-model', modelName: 'gpt-4' });
});

test('session state initializes from config defaults on first access', () => {
  const state = sessionProviderState.getOrInit('brand-new-session-id');
  expect(state.activeProvider).toBe('openai');
  expect(state.activeModel).toBe('gpt-4.1-mini');
});

test('6.7 /new clears session context and returns confirmation', async () => {
  const agent = await createAgent('Test Agent');
  const session = await createSession(agent.id, 'test-6-7');

  // Add some messages to the session
  await db.sessionMessage.createMany({
    data: [
      { sessionId: session.id, role: 'user', content: 'Hello', sender: 'test' },
      { sessionId: session.id, role: 'assistant', content: 'Hi there!', sender: 'assistant' },
      { sessionId: session.id, role: 'user', content: 'How are you?', sender: 'test' },
    ],
  });

  // Verify messages exist
  const messagesBefore = await db.sessionMessage.count({ where: { sessionId: session.id } });
  expect(messagesBefore).toBe(3);

  // Execute /new command
  const task = await createMessageTask(agent.id, session.id, '/new');
  const result = await agentExecutor.executeTask(task.id);

  expect(result.success).toBe(true);
  expect(result.response).toContain('Session context cleared');

  // Verify old messages are cleared, but command and response are recorded (2 messages)
  const messagesAfter = await db.sessionMessage.count({ where: { sessionId: session.id } });
  expect(messagesAfter).toBe(2);
});

test('6.8 /clear (alias) also clears session context', async () => {
  const agent = await createAgent('Test Agent');
  const session = await createSession(agent.id, 'test-6-8');

  // Add some messages
  await db.sessionMessage.createMany({
    data: [
      { sessionId: session.id, role: 'user', content: 'Test message 1', sender: 'test' },
      { sessionId: session.id, role: 'assistant', content: 'Response 1', sender: 'assistant' },
      { sessionId: session.id, role: 'user', content: 'Test message 2', sender: 'test' },
      { sessionId: session.id, role: 'assistant', content: 'Response 2', sender: 'assistant' },
    ],
  });

  // Execute /clear command
  const task = await createMessageTask(agent.id, session.id, '/clear');
  const result = await agentExecutor.executeTask(task.id);

  expect(result.success).toBe(true);
  expect(result.response).toContain('Session context cleared');

  // Verify old messages are cleared, but command and response are recorded (2 messages)
  const messagesAfter = await db.sessionMessage.count({ where: { sessionId: session.id } });
  expect(messagesAfter).toBe(2);
});
