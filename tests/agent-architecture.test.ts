/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

let lastSystemPrompt = '';
let lastToolNames: string[] = [];
let lastStepCount = 0;
let lastPrompt = '';
let lastMessages: unknown = undefined;
let mockResponseText = 'stub response';
let mockGenerateTextSteps: Array<Record<string, unknown>> = [];

type SpawnResult = {
  success?: boolean;
  error?: string;
  data?: { response?: string; skill?: string; surfaces?: unknown[] };
};

type InputRouteResponse = {
  success?: boolean;
  data?: {
    taskId?: string;
    sessionId?: string;
  };
  error?: string;
  message?: string;
};

mock.module('ai', () => ({
  generateText: async ({
    system,
    tools,
    prompt,
    messages,
  }: {
    system?: string;
    tools?: Record<string, unknown>;
    prompt?: string;
    messages?: unknown;
  }) => {
    lastSystemPrompt = system ?? '';
    lastToolNames = Object.keys(tools ?? {});
    lastPrompt = prompt ?? '';
    lastMessages = messages;
    return { text: mockResponseText, steps: mockGenerateTextSteps };
  },
  stepCountIs: (count: number) => {
    lastStepCount = count;
    return () => true;
  },
}));

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const SKILLS_DIR = path.join(tmpdir(), 'openclaw-mini-agent-skills');
const BUILT_IN_SKILLS_DIR = path.join(process.cwd(), 'skills');
const MEMORY_ROOT = path.join(tmpdir(), 'openclaw-mini-agent-memories');

let db: PrismaClient;
let workspaceService: typeof import('../src/lib/services/workspace-service');
let agentService: typeof import('../src/lib/services/agent-service').agentService;
let inputManager: typeof import('../src/lib/services/input-manager').inputManager;
let taskQueue: typeof import('../src/lib/services/task-queue').taskQueue;
let agentExecutor: typeof import('../src/lib/services/agent-executor').agentExecutor;
let skillService: typeof import('../src/lib/services/skill-service');
let toolsModule: typeof import('../src/lib/tools');
let channelBindingByIdRoute: typeof import('../src/app/api/channels/bindings/[id]/route');
let inputRoute: typeof import('../src/app/api/input/route');
let testWorkspaceDir = '';
let initialMemoryDirs = new Set<string>();
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

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

function writeSkillFile(rootDir: string, name: string, frontmatter: string, body: string) {
  const dir = path.join(rootDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\n${frontmatter}\n---\n\n${body}\n`,
    'utf-8',
  );
}

function writeSkill(name: string, frontmatter: string, body: string) {
  writeSkillFile(SKILLS_DIR, name, frontmatter, body);
}

function resetWorkspaceDir() {
  if (testWorkspaceDir) {
    fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
  }

  testWorkspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-agent-workspace-'));
  process.env.OPENCLAW_WORKSPACE_DIR = testWorkspaceDir;
  workspaceService.initializeWorkspace({ workspaceDir: testWorkspaceDir });
}

function writeWorkspaceBootstrapFile(fileName: string, content: string) {
  fs.writeFileSync(path.join(testWorkspaceDir, fileName), content, 'utf-8');
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

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-agent-architecture-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_SKILLS_DIR = SKILLS_DIR;
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
    throw new Error(`Failed to prepare test database: ${dbPush.stderr.toString()}`);
  }

  const dbModule = await import('../src/lib/db');
  db = dbModule.db;

  workspaceService = await import('../src/lib/services/workspace-service');
  agentService = (await import('../src/lib/services/agent-service')).agentService;
  inputManager = (await import('../src/lib/services/input-manager')).inputManager;
  taskQueue = (await import('../src/lib/services/task-queue')).taskQueue;
  agentExecutor = (await import('../src/lib/services/agent-executor')).agentExecutor;
  skillService = await import('../src/lib/services/skill-service');
  toolsModule = await import('../src/lib/tools');
  channelBindingByIdRoute = await import('../src/app/api/channels/bindings/[id]/route');
  inputRoute = await import('../src/app/api/input/route');

  await resetDb();
});

beforeEach(async () => {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  await resetDb();
  resetWorkspaceDir();
  skillService.clearSkillCache();
  resetSkillsDir();
  lastSystemPrompt = '';
  lastToolNames = [];
  lastStepCount = 0;
  lastPrompt = '';
  lastMessages = undefined;
  mockResponseText = 'stub response';
  mockGenerateTextSteps = [];
});

afterAll(async () => {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  await resetDb();
  await db.$disconnect();
  cleanupMemoryDirs();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  if (fs.existsSync(SKILLS_DIR)) {
    fs.rmSync(SKILLS_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }
  if (testWorkspaceDir) {
    fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
  }
  delete process.env.OPENCLAW_WORKSPACE_DIR;
  delete process.env.OPENCLAW_SKILLS_DIR;
  delete process.env.OPENCLAW_MEMORY_DIR;
  if (fs.existsSync(MEMORY_ROOT)) {
    fs.rmSync(MEMORY_ROOT, { recursive: true, force: true });
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

test('message tasks preserve attachment and vision payloads from inbound input', async () => {
  const agent = await agentService.createAgent({ name: 'Attachment Agent' });
  await agentService.setDefaultAgent(agent.id);

  const result = await inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: 'chat-attachments',
    content: 'review these files',
    attachments: [{
      channelFileId: 'doc-1',
      localPath: '/tmp/contract.pdf',
      filename: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    }],
    visionInputs: [{
      channelFileId: 'img-1',
      localPath: '/tmp/photo.png',
      mimeType: 'image/png',
    }],
  });

  expect(result.success).toBe(true);
  expect(result.taskId).toBeDefined();

  const task = await taskQueue.getTask(result.taskId!);
  expect(task?.payload).toMatchObject({
    attachments: [{
      channelFileId: 'doc-1',
      localPath: '/tmp/contract.pdf',
      filename: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    }],
    visionInputs: [{
      channelFileId: 'img-1',
      localPath: '/tmp/photo.png',
      mimeType: 'image/png',
    }],
  });
});

test('message attachments flow from input manager into executor prompt context', async () => {
  const agent = await agentService.createAgent({ name: 'Attachment Prompt Agent' });
  await agentService.setDefaultAgent(agent.id);

  const result = await inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: 'chat-attachment-prompt',
    content: 'please review the attached contract',
    attachments: [{
      channelFileId: 'doc-2',
      localPath: '/tmp/contract-v2.pdf',
      filename: 'contract-v2.pdf',
      mimeType: 'application/pdf',
      size: 4096,
    }],
  });

  expect(result.success).toBe(true);
  expect(result.taskId).toBeDefined();

  const execResult = await agentExecutor.executeTask(result.taskId!);
  expect(execResult.success).toBe(true);
  expect(lastPrompt).toContain('ATTACHED FILES:');
  expect(lastPrompt).toContain('/tmp/contract-v2.pdf (contract-v2.pdf, application/pdf, 4096 bytes)');
  expect(lastPrompt).toContain('please review the attached contract');
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
  expect(needsEnv && 'sourcePath' in needsEnv).toBe(false);

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

test('built-in skills win when managed skills use the same logical name', async () => {
  const originalCwd = process.cwd();
  const managedWorkspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-managed-skills-'));
  const managedSkillsRoot = path.join(managedWorkspaceDir, 'data', 'skills');

  try {
    process.chdir(managedWorkspaceDir);
    writeSkill('planner', 'name: planner\ndescription: Built-in planner', 'Built-in instructions.');
    writeSkillFile(
      managedSkillsRoot,
      'planner',
      'name: planner\ndescription: Managed planner',
      'Managed instructions.',
    );

    skillService.clearSkillCache();
    const skills = await skillService.loadAllSkills();
    const planners = skills.filter(skill => skill.name.toLowerCase() === 'planner');

    expect(planners).toHaveLength(1);
    expect(planners[0]?.description).toBe('Built-in planner');
    expect(planners[0]?.instructions).toBe('Built-in instructions.');
    expect(planners[0]?.source).toBe('built-in');
  } finally {
    process.chdir(originalCwd);
    skillService.clearSkillCache();
    fs.rmSync(managedWorkspaceDir, { recursive: true, force: true });
  }
});

test('skill collisions are detected case-insensitively', async () => {
  const originalCwd = process.cwd();
  const managedWorkspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-managed-skills-case-'));
  const managedSkillsRoot = path.join(managedWorkspaceDir, 'data', 'skills');

  try {
    process.chdir(managedWorkspaceDir);
    writeSkill('Planner', 'name: Planner\ndescription: Built-in planner', 'Built-in instructions.');
    writeSkillFile(
      managedSkillsRoot,
      'planner',
      'name: planner\ndescription: Managed planner',
      'Managed instructions.',
    );

    skillService.clearSkillCache();
    const skills = await skillService.loadAllSkills();
    const planners = skills.filter(skill => skill.name.toLowerCase() === 'planner');

    expect(planners).toHaveLength(1);
    expect(planners[0]?.name).toBe('Planner');
    expect(planners[0]?.source).toBe('built-in');
  } finally {
    process.chdir(originalCwd);
    skillService.clearSkillCache();
    fs.rmSync(managedWorkspaceDir, { recursive: true, force: true });
  }
});

test('missing managed skills directory is treated as an empty managed set', async () => {
  const originalCwd = process.cwd();
  const managedWorkspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-managed-empty-'));

  try {
    process.chdir(managedWorkspaceDir);
    writeSkill('solo-skill', 'name: solo-skill\ndescription: Built-in only skill', 'Built-in instructions.');

    skillService.clearSkillCache();
    const skills = await skillService.loadAllSkills();

    expect(skills.find(skill => skill.name === 'solo-skill')?.source).toBe('built-in');
    expect(skills.some(skill => skill.source === 'managed')).toBe(false);
  } finally {
    process.chdir(originalCwd);
    skillService.clearSkillCache();
    fs.rmSync(managedWorkspaceDir, { recursive: true, force: true });
  }
});

test('filesystem skill loader parses frontmatter and instructions', async () => {
  const loaderRoot = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-loader-unit-'));

  try {
    const {
      createFilesystemSkillLoader,
      parseSkillFile,
      SKILL_PRECEDENCE_MANAGED,
    } = await import('../src/lib/services/skill-loaders');

    writeSkillFile(
      loaderRoot,
      'parser-test',
      'name: parser-test\ndescription: Parser test\ntools:\n  - get_datetime\nrequires:\n  env:\n    - OPENAI_API_KEY',
      'Use the parser helper.',
    );
    writeSkillFile(
      loaderRoot,
      'malformed-requires',
      'name: malformed-requires\ndescription: Bad requires\nrequires:\n  - not-an-object',
      'Ignore malformed requires.',
    );

    const loader = createFilesystemSkillLoader({
      name: 'unit-test-loader',
      dirPath: loaderRoot,
      source: 'managed',
      precedence: SKILL_PRECEDENCE_MANAGED,
    });

    const skills = await loader.load();

    expect(skills).toHaveLength(2);
    expect(skills.find(skill => skill.name === 'parser-test')).toMatchObject({
      name: 'parser-test',
      description: 'Parser test',
      tools: ['get_datetime'],
      requires: { env: ['OPENAI_API_KEY'] },
      source: 'managed',
      precedence: SKILL_PRECEDENCE_MANAGED,
    });
    expect(skills.find(skill => skill.name === 'parser-test')?.instructions).toBe('Use the parser helper.');
    expect(skills.find(skill => skill.name === 'parser-test')?.sourcePath).toBe(path.join(loaderRoot, 'parser-test', 'SKILL.md'));

    const malformed = await parseSkillFile(path.join(loaderRoot, 'malformed-requires', 'SKILL.md'));
    expect(malformed?.requires).toBeUndefined();
  } finally {
    fs.rmSync(loaderRoot, { recursive: true, force: true });
  }
});

test('GET /api/skills returns built-in and managed provenance', async () => {
  const originalCwd = process.cwd();
  const managedWorkspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-managed-api-'));
  const managedSkillsRoot = path.join(managedWorkspaceDir, 'data', 'skills');

  try {
    process.chdir(managedWorkspaceDir);
    writeSkill('planner', 'name: planner\ndescription: Built-in planner', 'Built-in instructions.');
    writeSkillFile(
      managedSkillsRoot,
      'custom-tool',
      'name: custom-tool\ndescription: Managed tool',
      'Managed instructions.',
    );

    skillService.clearSkillCache();
    const skillsRoute = await import('../src/app/api/skills/route');
    const response = await skillsRoute.GET();
    const body = await response.json() as {
      success: boolean;
      data: Array<{ name: string; source: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const sources = new Map(body.data.map(skill => [skill.name, skill.source]));
    expect(sources.get('planner')).toBe('built-in');
    expect(sources.get('custom-tool')).toBe('managed');
  } finally {
    process.chdir(originalCwd);
    skillService.clearSkillCache();
    fs.rmSync(managedWorkspaceDir, { recursive: true, force: true });
  }
});

test('SIGHUP clears loaded skills and binary gating caches for the next lookup', async () => {
  const { registerSkillCacheSignalHandler, resetSkillCacheSignalHandlerForTests } = await import('../src/instrumentation');
  const binaryName = `openclaw-mini-dynamic-bin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const binDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-skill-bin-'));
  const originalPath = process.env.PATH ?? '';
  const listenersBefore = process.listenerCount('SIGHUP');

  try {
    registerSkillCacheSignalHandler();
    registerSkillCacheSignalHandler();
    expect(process.listenerCount('SIGHUP')).toBe(listenersBefore + 1);

    process.env.PATH = originalPath;
    writeSkill(
      'dynamic-binary',
      `name: dynamic-binary\ndescription: Needs a dynamic binary\nrequires:\n  binaries:\n    - ${binaryName}`,
      'Binary-gated skill.',
    );

    skillService.clearSkillCache();
    const firstLoad = await skillService.loadAllSkills();
    expect(firstLoad.find(skill => skill.name === 'dynamic-binary')?.enabled).toBe(false);

    const binaryPath = path.join(binDir, binaryName);
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n', 'utf-8');
    fs.chmodSync(binaryPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;

    process.emit('SIGHUP');

    const secondLoad = await skillService.loadAllSkills();
    expect(secondLoad.find(skill => skill.name === 'dynamic-binary')?.enabled).toBe(true);
  } finally {
    process.env.PATH = originalPath;
    skillService.clearSkillCache();
    resetSkillCacheSignalHandlerForTests();
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('sub-agent overrides are validated and surfaced as skill diagnostics', async () => {
  writeSkill(
    'invalid-overrides',
    'name: invalid-overrides\ndescription: Invalid overrides\noverrides:\n  provider: made-up\n  systemPrompt: Forbidden prompt\n  allowedTools:\n    - no_such_tool',
    'This skill should be disabled.',
  );

  skillService.clearSkillCache();
  const skills = await skillService.loadAllSkills();
  const invalidSkill = skills.find(skill => skill.name === 'invalid-overrides');

  expect(invalidSkill?.enabled).toBe(false);
  expect(invalidSkill?.gatingReason).toContain('invalid overrides');
  expect(invalidSkill?.overrideErrors?.join(' | ')).toContain('provider');
  expect(invalidSkill?.overrideErrors?.join(' | ')).toContain('unknown tool');
  expect(invalidSkill?.overrideErrors?.join(' | ')).toContain('systemPrompt');
});

test('sub-agent config resolution merges base runtime and overrides deterministically', async () => {
  const { initializeProviderRegistry, resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  initializeProviderRegistry();

  const { resolveSubAgentConfig } = await import('../src/lib/subagent-config');

  const resolved = resolveSubAgentConfig({
    baseConfig: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      agentSkills: ['planner', 'executor'],
      defaultSystemPrompt: 'Base prompt',
      defaultToolNames: ['get_datetime', 'random'],
      defaultMaxIterations: 5,
    },
    overrides: {
      model: 'openrouter/gpt-4',
      maxIterations: 8,
      allowedTools: ['get_datetime'],
    },
  });

  expect(resolved.provider).toBe('openai');
  expect(resolved.model).toBe('openrouter/gpt-4');
  expect(resolved.systemPrompt).toBe('Base prompt');
  expect(resolved.maxIterations).toBe(8);
  expect(resolved.allowedSkills).toEqual(['planner', 'executor']);
  expect(resolved.allowedTools).toEqual(['get_datetime']);
  expect(resolved.overrideFieldsApplied).toEqual(['model', 'maxIterations', 'allowedTools']);
});

test('model provider resolves credentialRef from environment at instantiation time', async () => {
  process.env.OPENCLAW_CREDENTIAL_PROVIDERS_OPENROUTER_PLANNER = 'planner-secret';

  const { initializeProviderRegistry, resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  initializeProviderRegistry();

  const { resolveModelConfig } = await import('../src/lib/services/model-provider');
  const resolved = resolveModelConfig({
    provider: 'openrouter',
    model: 'openrouter/gpt-4',
    credentialRef: 'providers/openrouter/planner',
  });

  expect(resolved.apiKey).toBe('planner-secret');
  expect(resolved.credentialRef).toBe('providers/openrouter/planner');
  expect(resolved.baseURL).toBe('https://openrouter.ai/api/v1');

  delete process.env.OPENCLAW_CREDENTIAL_PROVIDERS_OPENROUTER_PLANNER;
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
    { agentId: agent.id, taskId: parentTask.id, taskType: 'message' },
    () => spawnTool.execute?.({ skill: 'helper', task: 'do the thing' }, { toolCallId: 'test', messages: [] }),
  );

  const subTask = await waitForSubagentTask(parentTask.id);
  expect(subTask.payload).not.toContain('systemPrompt');
  await taskQueue.completeTask(subTask.id, { response: 'done' });

  const successResult = (await successPromise) as SpawnResult | undefined;
  expect(successResult?.success).toBe(true);
  expect((successResult?.data as { response?: string } | undefined)?.response).toBe('done');

  const missingResult = (await toolsModule.withSpawnSubagentContext(
    { agentId: agent.id, taskId: parentTask.id, taskType: 'message' },
    () => spawnTool.execute?.({ skill: 'unknown', task: 'fail' }, { toolCallId: 'test', messages: [] }),
  )) as SpawnResult | undefined;
  expect(missingResult?.success).toBe(false);
  expect(missingResult?.error).toContain('not found');

  const timeoutPromise = toolsModule.withSpawnSubagentContext(
    { agentId: agent.id, taskId: parentTask.id, taskType: 'message' },
    () => spawnTool.execute?.({ skill: 'helper', task: 'timeout', timeoutSeconds: 3 }, { toolCallId: 'test', messages: [] }),
  );
  const timeoutResult = (await timeoutPromise) as SpawnResult | undefined;
  expect(timeoutResult?.success).toBe(false);
  expect(timeoutResult?.error).toContain('timed out');
});

test('spawn_subagent bubbles child surfaces without auto-delivering them', async () => {
  writeSkill(
    'helper',
    'name: helper\ndescription: Helper skill',
    'Respond with a concise answer.',
  );
  skillService.clearSkillCache();

  const agent = await agentService.createAgent({ name: 'Surface Parent Agent' });
  const parentTask = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    priority: 3,
    payload: { content: 'parent', channel: 'telegram', channelKey: 'parent-chat' },
    source: 'test',
  });

  const spawnTool = toolsModule.getTool('spawn_subagent');
  if (!spawnTool || !spawnTool.execute) {
    throw new Error('spawn_subagent tool not registered');
  }

  const successPromise = toolsModule.withSpawnSubagentContext(
    { agentId: agent.id, taskId: parentTask.id, taskType: 'message' },
    () => spawnTool.execute?.({ skill: 'helper', task: 'surface this' }, { toolCallId: 'surface-test', messages: [] }),
  );

  const subTask = await waitForSubagentTask(parentTask.id);
  await taskQueue.completeTask(subTask.id, {
    response: 'done',
    surfaces: [{ type: 'text', content: 'child surfaced text' }],
  });

  const successResult = (await successPromise) as SpawnResult | undefined;
  expect(successResult?.success).toBe(true);
  expect(successResult?.data?.response).toBe('done');
  expect(successResult?.data?.surfaces).toEqual([{ type: 'text', content: 'child surfaced text' }]);

  const deliveries = await db.outboundDelivery.findMany({ where: { taskId: parentTask.id } });
  expect(deliveries).toHaveLength(0);
});

test('spawn_subagent omits surfaces when child result does not include them', async () => {
  writeSkill(
    'helper',
    'name: helper\ndescription: Helper skill',
    'Respond with a concise answer.',
  );
  skillService.clearSkillCache();

  const agent = await agentService.createAgent({ name: 'Surface Parent Agent 2' });
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
    { agentId: agent.id, taskId: parentTask.id, taskType: 'message' },
    () => spawnTool.execute?.({ skill: 'helper', task: 'normal child' }, { toolCallId: 'surface-test-2', messages: [] }),
  );

  const subTask = await waitForSubagentTask(parentTask.id);
  await taskQueue.completeTask(subTask.id, { response: 'done' });

  const successResult = (await successPromise) as SpawnResult | undefined;
  expect(successResult?.success).toBe(true);
  expect(successResult?.data).toEqual({ response: 'done', skill: 'helper' });
});

test('sub-agent executor uses skill body as prompt and applies non-prompt overrides', async () => {
  writeSkill(
    'planner',
    'name: planner\ndescription: Planning skill\ntools:\n  - get_datetime\n  - random\noverrides:\n  maxIterations: 8\n  allowedTools:\n    - get_datetime',
    'Base planner instructions.',
  );
  skillService.clearSkillCache();

  const agent = await agentService.createAgent({ name: 'Planner Agent', skills: ['planner'] });
  const task = await taskQueue.createTask({
    agentId: agent.id,
    type: 'subagent',
    priority: 5,
    payload: { task: 'Plan the work', skill: 'planner' },
    source: 'test',
    skillName: 'planner',
  });

  const result = await agentExecutor.executeTask(task.id);
  if (!result.success) {
    throw new Error(`Executor failed: ${result.error ?? 'unknown error'}`);
  }

  expect(lastSystemPrompt).toBe('Base planner instructions.');
  expect(lastToolNames).toEqual(['get_datetime']);
  expect(lastStepCount).toBe(8);

  const auditLogs = await db.auditLog.findMany({
    where: {
      entityId: task.id,
      action: 'subagent_overrides_applied',
    },
  });
  expect(auditLogs).toHaveLength(1);
  expect(JSON.parse(auditLogs[0].details)).toMatchObject({
    agentId: agent.id,
    skill: 'planner',
    overrideFieldsApplied: ['maxIterations', 'allowedTools'],
  });
});

test('sub-agent executor includes inherited attachments in prompt context', async () => {
  writeSkill(
    'attachment-helper',
    'name: attachment-helper\ndescription: Attachment helper\ntools:\n  - get_datetime',
    'Review the attached files carefully.',
  );
  skillService.clearSkillCache();

  const agent = await agentService.createAgent({ name: 'Attachment Helper Agent', skills: ['attachment-helper'] });
  const task = await taskQueue.createTask({
    agentId: agent.id,
    type: 'subagent',
    priority: 5,
    payload: {
      task: 'Review the inherited PDF',
      skill: 'attachment-helper',
      attachments: [{
        channelFileId: 'doc-sub-1',
        localPath: '/tmp/subagent-spec.pdf',
        filename: 'subagent-spec.pdf',
        mimeType: 'application/pdf',
        size: 5120,
      }],
    },
    source: 'test',
    skillName: 'attachment-helper',
  });

  const result = await agentExecutor.executeTask(task.id);
  if (!result.success) {
    throw new Error(`Executor failed: ${result.error ?? 'unknown error'}`);
  }

  expect(lastPrompt).toContain('Sub-agent task received.');
  expect(lastPrompt).toContain('ATTACHED FILES:');
  expect(lastPrompt).toContain('/tmp/subagent-spec.pdf (subagent-spec.pdf, application/pdf, 5120 bytes)');
});

test('sub-agent executor passes inherited vision inputs through multimodal generation', async () => {
  writeSkill(
    'vision-helper',
    'name: vision-helper\ndescription: Vision helper\ntools:\n  - get_datetime',
    'Inspect images passed into the task.',
  );
  skillService.clearSkillCache();

  const agent = await agentService.createAgent({ name: 'Vision Helper Agent', skills: ['vision-helper'], model: 'gpt-4o' });
  const testDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-subagent-vision-'));

  try {
    const imagePath = path.join(testDir, 'inspection.png');
    fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

    const task = await taskQueue.createTask({
      agentId: agent.id,
      type: 'subagent',
      priority: 5,
      payload: {
        task: 'Describe the inherited image',
        skill: 'vision-helper',
        visionInputs: [{
          channelFileId: 'img-sub-1',
          localPath: imagePath,
          mimeType: 'image/png',
        }],
      },
      source: 'test',
      skillName: 'vision-helper',
    });

    const result = await agentExecutor.executeTask(task.id);
    if (!result.success) {
      throw new Error(`Executor failed: ${result.error ?? 'unknown error'}`);
    }

    expect(Array.isArray(lastMessages)).toBe(true);
    const contentParts = ((lastMessages as Array<{ content?: Array<{ type: string; text?: string }> }>)?.[0]?.content) ?? [];
    expect(contentParts.some(part => part.type === 'text' && part.text?.includes('Describe the inherited image'))).toBe(true);
    expect(contentParts.some(part => part.type === 'image')).toBe(true);
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

test('sub-agent file surfaces inherit delivery target and dispatch end-to-end', async () => {
  writeSkill(
    'file-helper',
    'name: file-helper\ndescription: File helper\ntools:\n  - send_file_to_chat',
    'Send the requested file back to the user.',
  );
  skillService.clearSkillCache();

  const sandboxService = await import('../src/lib/services/sandbox-service');
  const deliveryService = await import('../src/lib/services/delivery-service');
  const sandboxRoot = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-subagent-send-file-'));
  const deliveryTarget = {
    channel: 'telegram' as const,
    channelKey: 'parent-chat',
    metadata: { chatId: 'parent-chat', threadId: '7' },
  };
  const sentFiles: Array<{ target: unknown; filePath: string; opts?: { caption?: string; mimeType?: string } }> = [];

  try {
    deliveryService.resetAdaptersForTests();
    deliveryService.registerAdapter({
      channel: 'telegram',
      sendText: async () => ({ externalMessageId: 'text-ignored' }),
      sendFile: async (target, filePath, opts) => {
        sentFiles.push({ target, filePath, opts });
        return { externalMessageId: 'file-sent-1' };
      },
      isConnected: () => true,
    });

    const agent = await agentService.createAgent({ name: 'File Helper Agent', skills: ['file-helper'] });
    sandboxService.setSandboxRootForTests(sandboxRoot);
    const sandboxDir = sandboxService.getSandboxDir(agent.id);
    const reportPath = path.join(sandboxDir, 'report.txt');
    fs.writeFileSync(reportPath, 'child report', 'utf-8');

    mockResponseText = '';
    mockGenerateTextSteps = [
      makeToolStep([
        {
          toolName: 'send_file_to_chat',
          input: { agentId: agent.id, filePath: 'report.txt', caption: 'Child report' },
          output: {
            success: true,
            data: {
              filePath: reportPath,
              mimeType: 'text/plain',
              caption: 'Child report',
              deliveryTarget,
            },
            surface: [{ type: 'file', filePath: reportPath, mimeType: 'text/plain', caption: 'Child report' }],
          },
        },
      ]),
    ];

    const task = await taskQueue.createTask({
      agentId: agent.id,
      type: 'subagent',
      priority: 5,
      payload: {
        task: 'Send the report back to chat',
        skill: 'file-helper',
        deliveryTarget,
      },
      source: 'test',
      skillName: 'file-helper',
    });

    const result = await agentExecutor.executeTask(task.id);
    if (!result.success) {
      throw new Error(`Executor failed: ${result.error ?? 'unknown error'}`);
    }

    const deliveries = await db.outboundDelivery.findMany({ where: { taskId: task.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      taskId: task.id,
      channel: 'telegram',
      channelKey: 'parent-chat',
      deliveryType: 'file',
      filePath: reportPath,
      text: 'Child report',
    });
    expect(JSON.parse(deliveries[0].targetJson)).toEqual(deliveryTarget);

    const dispatchStats = await deliveryService.processPendingDeliveries();
    expect(dispatchStats.sent).toBeGreaterThanOrEqual(1);
    expect(sentFiles).toHaveLength(1);
    expect(sentFiles[0]).toMatchObject({
      target: deliveryTarget,
      filePath: reportPath,
      opts: { caption: 'Child report' },
    });

    const completedTask = await taskQueue.getTask(task.id);
    expect(completedTask?.result).toMatchObject({
      response: '',
      surfaces: [{ type: 'file', filePath: reportPath, mimeType: 'text/plain', caption: 'Child report' }],
    });
  } finally {
    deliveryService.resetAdaptersForTests();
    sandboxService.setSandboxRootForTests(null);
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test('real built-in planner skill executes with repository instructions and orchestration tool surface', async () => {
  const originalSkillsDir = process.env.OPENCLAW_SKILLS_DIR;
  process.env.OPENCLAW_SKILLS_DIR = BUILT_IN_SKILLS_DIR;
  skillService.clearSkillCache();

  try {
    const agent = await agentService.createAgent({ name: 'Built-in Planner Agent', skills: ['planner'] });
    const task = await taskQueue.createTask({
      agentId: agent.id,
      type: 'subagent',
      priority: 5,
      payload: { task: 'Coordinate the work', skill: 'planner' },
      source: 'test',
      skillName: 'planner',
    });

    const result = await agentExecutor.executeTask(task.id);
    if (!result.success) {
      throw new Error(`Executor failed: ${result.error ?? 'unknown error'}`);
    }

    expect(lastSystemPrompt).toContain('You are the planner.');
    expect(lastSystemPrompt).toContain('Available specialist roster');
    expect(lastToolNames).toEqual(['spawn_subagent', 'get_datetime', 'write_note']);
    expect(lastStepCount).toBe(8);

    const auditLogs = await db.auditLog.findMany({
      where: {
        entityId: task.id,
        action: 'subagent_overrides_applied',
      },
    });
    expect(auditLogs).toHaveLength(1);
    expect(JSON.parse(auditLogs[0].details)).toMatchObject({
      agentId: agent.id,
      skill: 'planner',
      overrideFieldsApplied: ['model', 'maxIterations', 'allowedSkills', 'maxToolInvocations'],
    });
  } finally {
    if (originalSkillsDir === undefined) {
      delete process.env.OPENCLAW_SKILLS_DIR;
    } else {
      process.env.OPENCLAW_SKILLS_DIR = originalSkillsDir;
    }
    skillService.clearSkillCache();
  }
});

test('sub-agent policy rejects disallowed tool and skill invocations', async () => {
  writeSkill(
    'helper',
    'name: helper\ndescription: Helper skill',
    'Handle helper work.',
  );
  writeSkill(
    'planner',
    'name: planner\ndescription: Planner skill',
    'Handle planning work.',
  );
  skillService.clearSkillCache();

  const randomTool = toolsModule.getTool('random');
  const spawnTool = toolsModule.getTool('spawn_subagent');
  if (!randomTool?.execute || !spawnTool?.execute) {
    throw new Error('Expected tools are not registered');
  }

  await expect(
    toolsModule.withSpawnSubagentContext(
      {
        agentId: 'agent-1',
        taskId: 'task-1',
        taskType: 'subagent',
        allowedTools: ['get_datetime'],
      },
      () => randomTool.execute?.({ type: 'number' }, { toolCallId: 'tool-1', messages: [] }),
    ),
  ).rejects.toThrow("Tool 'random' is not permitted for this sub-agent");

  await expect(
    toolsModule.withSpawnSubagentContext(
      {
        agentId: 'agent-1',
        taskId: 'task-1',
        taskType: 'subagent',
        allowedSkills: ['helper'],
      },
      () => spawnTool.execute?.({ skill: 'planner', task: 'do planner work' }, { toolCallId: 'tool-2', messages: [] }),
    ),
  ).rejects.toThrow("Skill 'planner' is not permitted for this sub-agent");
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

  const request = new NextRequest('http://localhost/api/input', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: {
        type: 'message',
        channel: 'telegram',
        channelKey: 'chat-500',
        content: 'Find info',
      },
    }),
  });
  const response = await inputRoute.POST(request);
  expect(response.status).toBe(200);

  const responseBody = (await response.json()) as InputRouteResponse;
  expect(responseBody.success).toBe(true);
  expect(responseBody.data?.taskId).toBeDefined();

  const taskId = responseBody.data?.taskId;
  if (!taskId) {
    throw new Error(`Input route failed to return taskId: ${responseBody.error ?? 'unknown error'}`);
  }

  const createdTask = await taskQueue.getTask(taskId);
  expect(createdTask?.agentId).toBe(agent.id);

  const execResult = await agentExecutor.executeTask(taskId);
  if (!execResult.success) {
    throw new Error(`Executor failed: ${execResult.error ?? 'unknown error'}`);
  }
  expect(execResult.response).toBe('stub response');
  expect(lastSystemPrompt).toContain('Available Skills');
  expect(lastSystemPrompt).toContain('web-search');
});

test('message tasks use workspace persona from SOUL.md', async () => {
  writeWorkspaceBootstrapFile(
    'SOUL.md',
    '# Persona & Tone\n\nYou are a pirate captain. Speak in pirate dialect.\n',
  );

  const agent = await agentService.createAgent({ name: 'Persona Agent' });
  const task = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    priority: 3,
    payload: {
      channel: 'telegram',
      channelKey: 'chat-900',
      sender: 'tester',
      content: 'How do you sound?',
    },
  });

  const execResult = await agentExecutor.executeTask(task.id);
  if (!execResult.success) {
    throw new Error(`Executor failed: ${execResult.error ?? 'unknown error'}`);
  }

  expect(execResult.response).toBe('stub response');
  expect(lastSystemPrompt).toContain('pirate captain');
  expect(lastSystemPrompt).not.toContain('Heartbeat Checklist');
});

test('HEARTBEAT.md is injected for heartbeat tasks and excluded for message tasks', async () => {
  writeWorkspaceBootstrapFile('HEARTBEAT.md', 'Review the inbox and check scheduled work.\n');

  const agent = await agentService.createAgent({ name: 'Heartbeat Agent' });
  const heartbeatTask = await taskQueue.createTask({
    agentId: agent.id,
    type: 'heartbeat',
    priority: 3,
    payload: {
      triggerId: 'trigger-1',
      timestamp: new Date().toISOString(),
    },
  });

  const heartbeatResult = await agentExecutor.executeTask(heartbeatTask.id);
  if (!heartbeatResult.success) {
    throw new Error(`Executor failed: ${heartbeatResult.error ?? 'unknown error'}`);
  }

  expect(lastSystemPrompt).toContain('## Heartbeat Checklist');
  expect(lastSystemPrompt).toContain('Review the inbox and check scheduled work.');

  const messageTask = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    priority: 3,
    payload: {
      channel: 'telegram',
      channelKey: 'chat-901',
      sender: 'tester',
      content: 'Normal message',
    },
  });

  const messageResult = await agentExecutor.executeTask(messageTask.id);
  if (!messageResult.success) {
    throw new Error(`Executor failed: ${messageResult.error ?? 'unknown error'}`);
  }

  expect(lastSystemPrompt).not.toContain('## Heartbeat Checklist');
});

test('system prompt includes MCP directory when servers are configured and excludes it when absent', async () => {
  if (!runtimeConfigFixture) {
    throw new Error('Runtime config fixture not initialized');
  }

  const { writeRuntimeConfig } = await import('./runtime-config-fixture');
  writeRuntimeConfig(runtimeConfigFixture.configPath, {
    mcp: {
      servers: {
        github: {
          command: 'node',
          args: ['github-server.js'],
          description: 'GitHub API operations',
        },
      },
    },
  });

  const { resetProviderRegistryForTests, initializeProviderRegistry } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  initializeProviderRegistry();

  const agent = await agentService.createAgent({ name: 'MCP Directory Agent' });
  const taskWithMcp = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    priority: 3,
    payload: {
      channel: 'telegram',
      channelKey: 'chat-mcp-1',
      sender: 'tester',
      content: 'What integrations do you have?',
    },
  });

  const withMcpResult = await agentExecutor.executeTask(taskWithMcp.id);
  if (!withMcpResult.success) {
    throw new Error(`Executor failed: ${withMcpResult.error ?? 'unknown error'}`);
  }

  expect(lastSystemPrompt).toContain('Available MCP servers (use mcp_list to discover tools):');
  expect(lastSystemPrompt).toContain('- github - GitHub API operations');

  writeRuntimeConfig(runtimeConfigFixture.configPath, {});
  resetProviderRegistryForTests();
  initializeProviderRegistry();

  const taskWithoutMcp = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    priority: 3,
    payload: {
      channel: 'telegram',
      channelKey: 'chat-mcp-2',
      sender: 'tester',
      content: 'What integrations do you have now?',
    },
  });

  const withoutMcpResult = await agentExecutor.executeTask(taskWithoutMcp.id);
  if (!withoutMcpResult.success) {
    throw new Error(`Executor failed: ${withoutMcpResult.error ?? 'unknown error'}`);
  }

  expect(lastSystemPrompt).not.toContain('Available MCP servers (use mcp_list to discover tools):');
});

test('mcp_list and mcp_call tools use MCP service responses', async () => {
  const { McpService } = await import('../src/lib/services/mcp-service');
  const listServersSpy = mock(() => [{ name: 'github', description: 'GitHub API operations' }]);
  const listToolsSpy = mock(async () => ['create_issue: Create a new issue (required: title)']);
  const callToolSpy = mock(async (_server: string, _tool: string, args: Record<string, unknown>) => ({ echoed: args }));

  const originalListServers = McpService.prototype.listServers;
  const originalListTools = McpService.prototype.listTools;
  const originalCallTool = McpService.prototype.callTool;

  McpService.prototype.listServers = listServersSpy;
  McpService.prototype.listTools = listToolsSpy;
  McpService.prototype.callTool = callToolSpy;

  try {
    const listTool = toolsModule.getTool('mcp_list');
    const callTool = toolsModule.getTool('mcp_call');
    if (!listTool?.execute || !callTool?.execute) {
      throw new Error('Expected MCP tools to be registered');
    }

    const serverListResult = await listTool.execute({}, { toolCallId: 'mcp-list-servers', messages: [] });
    expect(serverListResult).toMatchObject({
      success: true,
      data: { servers: [{ name: 'github', description: 'GitHub API operations' }] },
    });

    const toolListResult = await listTool.execute({ server: 'github' }, { toolCallId: 'mcp-list-tools', messages: [] });
    expect(toolListResult).toMatchObject({
      success: true,
      data: { server: 'github', tools: ['create_issue: Create a new issue (required: title)'] },
    });

    const callResult = await callTool.execute(
      { server: 'github', tool: 'create_issue', arguments: { title: 'Bug' } },
      { toolCallId: 'mcp-call', messages: [] },
    );
    expect(callResult).toMatchObject({
      success: true,
      data: {
        server: 'github',
        tool: 'create_issue',
        result: { echoed: { title: 'Bug' } },
      },
    });

    callToolSpy.mockImplementationOnce(async () => {
      throw new Error("MCP server 'missing' is not configured");
    });
    const missingServerResult = await callTool.execute(
      { server: 'missing', tool: 'create_issue' },
      { toolCallId: 'mcp-call-missing-server', messages: [] },
    );
    expect(missingServerResult).toEqual({
      success: false,
      error: "MCP server 'missing' is not configured",
    });

    callToolSpy.mockImplementationOnce(async () => {
      throw new Error('Tool not found');
    });
    const missingToolResult = await callTool.execute(
      { server: 'github', tool: 'missing_tool' },
      { toolCallId: 'mcp-call-missing-tool', messages: [] },
    );
    expect(missingToolResult).toEqual({
      success: false,
      error: 'Tool not found',
    });
  } finally {
    McpService.prototype.listServers = originalListServers;
    McpService.prototype.listTools = originalListTools;
    McpService.prototype.callTool = originalCallTool;
  }
});
