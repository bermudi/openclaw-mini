/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';

let lastSystemPrompt = '';

type SpawnResult = {
  success?: boolean;
  error?: string;
  data?: { response?: string };
};

mock.module('ai', () => ({
  generateText: async ({ system }: { system?: string }) => {
    lastSystemPrompt = system ?? '';
    return { text: 'stub response', steps: [] };
  },
  stepCountIs: () => () => true,
}));

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const SKILLS_DIR = path.join(process.cwd(), 'skills');

let db: PrismaClient;
let agentService: typeof import('../src/lib/services/agent-service').agentService;
let inputManager: typeof import('../src/lib/services/input-manager').inputManager;
let taskQueue: typeof import('../src/lib/services/task-queue').taskQueue;
let agentExecutor: typeof import('../src/lib/services/agent-executor').agentExecutor;
let skillService: typeof import('../src/lib/services/skill-service');
let toolsModule: typeof import('../src/lib/tools');
let channelBindingByIdRoute: typeof import('../src/app/api/channels/bindings/[id]/route');

async function resetDb() {
  await db.task.deleteMany();
  await db.session.deleteMany();
  await db.channelBinding.deleteMany();
  await db.trigger.deleteMany();
  await db.webhookLog.deleteMany();
  await db.memory.deleteMany();
  await db.auditLog.deleteMany();
  await db.agent.deleteMany();
}

function resetSkillsDir() {
  if (fs.existsSync(SKILLS_DIR)) {
    fs.rmSync(SKILLS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

function writeSkill(name: string, frontmatter: string, body: string) {
  const dir = path.join(SKILLS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\n${frontmatter}\n---\n\n${body}\n`,
    'utf-8',
  );
}

async function waitForSubagentTask(parentTaskId: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tasks = await db.task.findMany({
      where: { type: 'subagent' },
      orderBy: { createdAt: 'desc' },
    });
    const task = tasks.find(candidate => candidate.parentTaskId === parentTaskId);
    if (task) return task;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Sub-agent task was not created');
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
    throw new Error(`Failed to prepare test database: ${dbPush.stderr.toString()}`);
  }

  const dbModule = await import('../src/lib/db');
  db = dbModule.db;

  agentService = (await import('../src/lib/services/agent-service')).agentService;
  inputManager = (await import('../src/lib/services/input-manager')).inputManager;
  taskQueue = (await import('../src/lib/services/task-queue')).taskQueue;
  agentExecutor = (await import('../src/lib/services/agent-executor')).agentExecutor;
  skillService = await import('../src/lib/services/skill-service');
  toolsModule = await import('../src/lib/tools');
  channelBindingByIdRoute = await import('../src/app/api/channels/bindings/[id]/route');

  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  skillService.clearSkillCache();
  resetSkillsDir();
  lastSystemPrompt = '';
});

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
  if (fs.existsSync(SKILLS_DIR)) {
    fs.rmSync(SKILLS_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }
});

test('routing resolution covers exact, wildcard, default, missing default, and explicit override', async () => {
  const agentA = await agentService.createAgent({ name: 'Default Agent' });
  const agentB = await agentService.createAgent({ name: 'Bound Agent' });
  await agentService.setDefaultAgent(agentA.id);

  await db.channelBinding.create({
    data: { channel: 'telegram', channelKey: 'chat-1', agentId: agentB.id },
  });
  await db.channelBinding.create({
    data: { channel: 'slack', channelKey: '*', agentId: agentB.id },
  });

  const exactResult = await inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: 'chat-1',
    content: 'hello',
  });
  expect(exactResult.success).toBe(true);
  expect(exactResult.taskId).toBeDefined();
  const exactTask = await taskQueue.getTask(exactResult.taskId!);
  expect(exactTask?.agentId).toBe(agentB.id);

  const wildcardResult = await inputManager.processInput({
    type: 'message',
    channel: 'slack',
    channelKey: 'server-9',
    content: 'ping',
  });
  expect(wildcardResult.success).toBe(true);
  expect(wildcardResult.taskId).toBeDefined();
  const wildcardTask = await taskQueue.getTask(wildcardResult.taskId!);
  expect(wildcardTask?.agentId).toBe(agentB.id);

  const defaultResult = await inputManager.processInput({
    type: 'message',
    channel: 'whatsapp',
    channelKey: 'user-1',
    content: 'fallback',
  });
  expect(defaultResult.success).toBe(true);
  expect(defaultResult.taskId).toBeDefined();
  const defaultTask = await taskQueue.getTask(defaultResult.taskId!);
  expect(defaultTask?.agentId).toBe(agentA.id);

  const overrideResult = await inputManager.processInput(
    {
      type: 'message',
      channel: 'slack',
      channelKey: 'channel-2',
      content: 'override',
    },
    agentB.id,
  );
  expect(overrideResult.success).toBe(true);
  expect(overrideResult.taskId).toBeDefined();
  const overrideTask = await taskQueue.getTask(overrideResult.taskId!);
  expect(overrideTask?.agentId).toBe(agentB.id);

  await db.agent.deleteMany();
  const missingDefaultResult = await inputManager.processInput({
    type: 'message',
    channel: 'imessage',
    channelKey: 'chat-99',
    content: 'no default',
  });
  expect(missingDefaultResult.success).toBe(false);
  expect(missingDefaultResult.error).toContain('No default agent');
});

test('sessions unify per agent and split across agents', async () => {
  const agentA = await agentService.createAgent({ name: 'Main Agent' });
  await agentService.setDefaultAgent(agentA.id);

  const first = await inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: 'chat-10',
    content: 'first',
  });
  const second = await inputManager.processInput({
    type: 'message',
    channel: 'whatsapp',
    channelKey: 'chat-11',
    content: 'second',
  });

  expect(first.sessionId).toBeDefined();
  expect(first.sessionId).toBe(second.sessionId);

  const agentB = await agentService.createAgent({ name: 'Secondary Agent' });
  await db.channelBinding.create({
    data: { channel: 'discord', channelKey: '*', agentId: agentB.id },
  });

  const third = await inputManager.processInput({
    type: 'message',
    channel: 'discord',
    channelKey: 'server-1',
    content: 'third',
  });

  expect(third.sessionId).toBeDefined();
  expect(third.sessionId).not.toBe(first.sessionId);
});

test('skill loading parses frontmatter, gating, and cache TTL', async () => {
  writeSkill(
    'web-search',
    'name: web-search\ndescription: Search the web\ntools:\n  - web_search',
    'Use web search tools.',
  );
  writeSkill(
    'needs-env',
    'name: needs-env\ndescription: Needs env\nrequires:\n  env:\n    - MISSING_ENV',
    'Requires env.',
  );
  writeSkill(
    'needs-binary',
    'name: needs-binary\ndescription: Needs binary\nrequires:\n  binaries:\n    - definitely-missing-binary',
    'Requires binary.',
  );
  writeSkill(
    'needs-platform',
    'name: needs-platform\ndescription: Needs unsupported platform\nrequires:\n  platform:\n    - no-such-platform',
    'Requires darwin.',
  );
  writeSkill('invalid', 'description: Missing name', 'Missing name.');

  const skills = await skillService.loadAllSkills();
  const names = skills.map(skill => skill.name).sort();
  expect(names).toContain('web-search');
  expect(names).toContain('needs-env');
  expect(names).toContain('needs-binary');
  expect(names).toContain('needs-platform');
  expect(names).not.toContain('invalid');

  const needsEnv = skills.find(skill => skill.name === 'needs-env');
  expect(needsEnv?.enabled).toBe(false);
  expect(needsEnv?.gatingReason).toContain('missing env: MISSING_ENV');

  const needsBinary = skills.find(skill => skill.name === 'needs-binary');
  expect(needsBinary?.enabled).toBe(false);
  expect(needsBinary?.gatingReason).toContain('missing binary');

  const needsPlatform = skills.find(skill => skill.name === 'needs-platform');
  expect(needsPlatform?.enabled).toBe(false);
  expect(needsPlatform?.gatingReason).toContain('unsupported platform');

  writeSkill(
    'web-search',
    'name: web-search\ndescription: Updated description',
    'Updated body.',
  );
  const cachedSkills = await skillService.loadAllSkills();
  const cachedWebSearch = cachedSkills.find(skill => skill.name === 'web-search');
  expect(cachedWebSearch?.description).toBe('Search the web');

  const originalNow = Date.now;
  const ttlMs = skillService.SKILL_CACHE_TTL_MS;
  // Advance past the cache TTL to force a refresh.
  Date.now = () => originalNow() + ttlMs + 1_000;
  const refreshedSkills = await skillService.loadAllSkills();
  const refreshedWebSearch = refreshedSkills.find(skill => skill.name === 'web-search');
  expect(refreshedWebSearch?.description).toBe('Updated description');
  Date.now = originalNow;
});

test('spawn_subagent tool handles success, missing skill, and timeout', async () => {
  writeSkill(
    'helper',
    'name: helper\ndescription: Helper skill',
    'Respond with a concise answer.',
  );
  skillService.clearSkillCache();

  const agent = await agentService.createAgent({ name: 'Parent Agent' });
  const parentTask = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    priority: 3,
    payload: { content: 'parent' },
    source: 'test',
  });

  const spawnTool = toolsModule.getTool('spawn_subagent');
  if (!spawnTool || !spawnTool.execute) {
    throw new Error('spawn_subagent tool not registered');
  }

  const successPromise = toolsModule.withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parentTask.id },
    () => spawnTool.execute?.({ skill: 'helper', task: 'do the thing' }, { toolCallId: 'test', messages: [] }),
  );

  const subTask = await waitForSubagentTask(parentTask.id);
  await taskQueue.completeTask(subTask.id, { response: 'done' });

  const successResult = (await successPromise) as SpawnResult | undefined;
  expect(successResult?.success).toBe(true);
  expect((successResult?.data as { response?: string } | undefined)?.response).toBe('done');

  const missingResult = (await toolsModule.withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parentTask.id },
    () => spawnTool.execute?.({ skill: 'unknown', task: 'fail' }, { toolCallId: 'test', messages: [] }),
  )) as SpawnResult | undefined;
  expect(missingResult?.success).toBe(false);
  expect(missingResult?.error).toContain('not found');

  const timeoutPromise = toolsModule.withSpawnSubagentContext(
    { agentId: agent.id, parentTaskId: parentTask.id },
    () => spawnTool.execute?.({ skill: 'helper', task: 'timeout', timeoutSeconds: 3 }, { toolCallId: 'test', messages: [] }),
  );
  const timeoutResult = (await timeoutPromise) as SpawnResult | undefined;
  expect(timeoutResult?.success).toBe(false);
  expect(timeoutResult?.error).toContain('timed out');
});

test('channel binding delete requires API key auth', async () => {
  process.env.OPENCLAW_API_KEY = 'super-secret-key';

  const agent = await agentService.createAgent({ name: 'Bound Agent' });
  const binding = await db.channelBinding.create({
    data: { channel: 'slack', channelKey: 'room-1', agentId: agent.id },
  });

  const unauthorizedRequest = new NextRequest(`http://localhost/api/channels/bindings/${binding.id}`, {
    method: 'DELETE',
  });
  const unauthorizedResponse = await channelBindingByIdRoute.DELETE(
    unauthorizedRequest,
    { params: Promise.resolve({ id: binding.id }) },
  );
  expect(unauthorizedResponse.status).toBe(401);

  const forbiddenRequest = new NextRequest(`http://localhost/api/channels/bindings/${binding.id}`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer wrong-key' },
  });
  const forbiddenResponse = await channelBindingByIdRoute.DELETE(
    forbiddenRequest,
    { params: Promise.resolve({ id: binding.id }) },
  );
  expect(forbiddenResponse.status).toBe(403);

  const authorizedRequest = new NextRequest(`http://localhost/api/channels/bindings/${binding.id}`, {
    method: 'DELETE',
    headers: { 'x-api-key': 'super-secret-key' },
  });
  const authorizedResponse = await channelBindingByIdRoute.DELETE(
    authorizedRequest,
    { params: Promise.resolve({ id: binding.id }) },
  );
  expect(authorizedResponse.status).toBe(200);

  const deletedBinding = await db.channelBinding.findUnique({ where: { id: binding.id } });
  expect(deletedBinding).toBeNull();
});

test('end-to-end input routes without agentId and prompt includes skill summaries', async () => {
  writeSkill(
    'web-search',
    'name: web-search\ndescription: Search the web',
    'Use web tools to gather information.',
  );
  skillService.clearSkillCache();

  const agent = await agentService.createAgent({ name: 'Main Agent' });
  await agentService.setDefaultAgent(agent.id);

  const result = await inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: 'chat-500',
    content: 'Find info',
  });
  expect(result.success).toBe(true);

  const execResult = await agentExecutor.executeTask(result.taskId ?? '');
  if (!execResult.success) {
    throw new Error(`Executor failed: ${execResult.error ?? 'unknown error'}`);
  }
  expect(execResult.response).toBe('stub response');
  expect(lastSystemPrompt).toContain('Available skills');
  expect(lastSystemPrompt).toContain('web-search');
});
