/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

mock.module('ai', () => ({
  generateText: async () => ({ text: 'stub', steps: [] }),
  stepCountIs: () => () => true,
}));

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'memory-git-versioning.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = path.join(os.tmpdir(), 'openclaw-mini-memory-git-memories');

let db: PrismaClient;
let memoryService: typeof import('../src/lib/services/memory-service').memoryService;
let validateMemoryKey: typeof import('../src/lib/services/memory-service').validateMemoryKey;
let MemoryGit: typeof import('../src/lib/services/memory-git').MemoryGit;
let historyRoute: typeof import('../src/app/api/agents/[id]/memory/history/route');
let atCommitRoute: typeof import('../src/app/api/agents/[id]/memory/[key]/at/[sha]/route');
let agentService: typeof import('../src/lib/services/agent-service').agentService;

const createdAgentIds = new Set<string>();
const tempDirs: string[] = [];
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function cleanupTempDirs() {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function cleanupAgentMemoryDirs() {
  for (const agentId of createdAgentIds) {
    fs.rmSync(path.join(MEMORY_ROOT, agentId), { recursive: true, force: true });
  }
  createdAgentIds.clear();
}

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

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.GIT_MEMORY_ENABLED = undefined as unknown as string;
  delete process.env.GIT_MEMORY_ENABLED;

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-memory-git-versioning-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_MEMORY_DIR = MEMORY_ROOT;

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

  db = (await import('../src/lib/db')).db;
  const memoryModule = await import('../src/lib/services/memory-service');
  memoryService = memoryModule.memoryService;
  validateMemoryKey = memoryModule.validateMemoryKey;
  const gitModule = await import('../src/lib/services/memory-git');
  MemoryGit = gitModule.MemoryGit;
  agentService = (await import('../src/lib/services/agent-service')).agentService;
  historyRoute = await import('../src/app/api/agents/[id]/memory/history/route');
  atCommitRoute = await import('../src/app/api/agents/[id]/memory/[key]/at/[sha]/route');

  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  cleanupAgentMemoryDirs();
  cleanupTempDirs();
  delete process.env.GIT_MEMORY_ENABLED;
  MemoryGit.resetAvailabilityCache();
});

afterEach(() => {
  cleanupTempDirs();
});

afterAll(async () => {
  cleanupAgentMemoryDirs();
  cleanupTempDirs();
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

// ─── 6.1 MemoryGit unit tests ────────────────────────────────────────────────

test('MemoryGit: init creates a git repository', async () => {
  const dir = makeTempDir('mem-git-init-');
  const git = new MemoryGit(dir);
  await git.init();
  expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
});

test('MemoryGit: init is idempotent — second call does not fail', async () => {
  const dir = makeTempDir('mem-git-init2-');
  const git = new MemoryGit(dir);
  await git.init();
  await git.init();
  expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
});

test('MemoryGit: commit creates a commit with the given message', async () => {
  const dir = makeTempDir('mem-git-commit-');
  const git = new MemoryGit(dir);
  await git.init();

  fs.writeFileSync(path.join(dir, 'test.md'), 'hello', 'utf-8');
  await git.add('test.md');
  await git.commit('Create test');

  const history = await git.log();
  expect(history).toHaveLength(1);
  expect(history[0]?.message).toBe('Create test');
});

test('MemoryGit: log returns commit history newest-first', async () => {
  const dir = makeTempDir('mem-git-log-');
  const git = new MemoryGit(dir);
  await git.init();

  fs.writeFileSync(path.join(dir, 'a.md'), 'first', 'utf-8');
  await git.add('a.md');
  await git.commit('First commit');

  fs.writeFileSync(path.join(dir, 'a.md'), 'second', 'utf-8');
  await git.add('a.md');
  await git.commit('Second commit');

  const history = await git.log();
  expect(history).toHaveLength(2);
  expect(history[0]?.message).toBe('Second commit');
  expect(history[1]?.message).toBe('First commit');
  expect(history[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
  expect(typeof history[0]?.timestamp).toBe('number');
});

test('MemoryGit: log with path returns only commits touching that file', async () => {
  const dir = makeTempDir('mem-git-log-path-');
  const git = new MemoryGit(dir);
  await git.init();

  fs.writeFileSync(path.join(dir, 'a.md'), 'a content', 'utf-8');
  await git.add('a.md');
  await git.commit('Create a');

  fs.writeFileSync(path.join(dir, 'b.md'), 'b content', 'utf-8');
  await git.add('b.md');
  await git.commit('Create b');

  const historyA = await git.log('a.md');
  expect(historyA).toHaveLength(1);
  expect(historyA[0]?.message).toBe('Create a');
});

test('MemoryGit: log with limit caps results', async () => {
  const dir = makeTempDir('mem-git-log-limit-');
  const git = new MemoryGit(dir);
  await git.init();

  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(dir, 'f.md'), `content ${i}`, 'utf-8');
    await git.add('f.md');
    await git.commit(`Commit ${i}`);
  }

  const limited = await git.log(undefined, 3);
  expect(limited).toHaveLength(3);
});

test('MemoryGit: log returns empty array when repo has no commits', async () => {
  const dir = makeTempDir('mem-git-log-empty-');
  const git = new MemoryGit(dir);
  await git.init();
  const history = await git.log();
  expect(history).toEqual([]);
});

test('MemoryGit: show returns file content at a specific commit', async () => {
  const dir = makeTempDir('mem-git-show-');
  const git = new MemoryGit(dir);
  await git.init();

  fs.writeFileSync(path.join(dir, 'mem.md'), 'version 1', 'utf-8');
  await git.add('mem.md');
  await git.commit('v1');
  const history1 = await git.log();
  const sha1 = history1[0]?.sha ?? '';

  fs.writeFileSync(path.join(dir, 'mem.md'), 'version 2', 'utf-8');
  await git.add('mem.md');
  await git.commit('v2');

  const content = await git.show(sha1, 'mem.md');
  expect(content).toBe('version 1');
});

test('MemoryGit: show returns null for non-existent file at commit', async () => {
  const dir = makeTempDir('mem-git-show-null-');
  const git = new MemoryGit(dir);
  await git.init();

  fs.writeFileSync(path.join(dir, 'real.md'), 'hello', 'utf-8');
  await git.add('real.md');
  await git.commit('init');

  const history = await git.log();
  const sha = history[0]?.sha ?? '';
  const content = await git.show(sha, 'nonexistent.md');
  expect(content).toBeNull();
});

test('MemoryGit: isAvailable returns false when GIT_MEMORY_ENABLED=false', () => {
  process.env.GIT_MEMORY_ENABLED = 'false';
  expect(MemoryGit.isAvailable()).toBe(false);
  delete process.env.GIT_MEMORY_ENABLED;
});

test('MemoryGit: isAvailable returns true when git is on PATH', () => {
  MemoryGit.resetAvailabilityCache();
  expect(MemoryGit.isAvailable()).toBe(true);
});

// ─── 6.2 Key validation unit tests ───────────────────────────────────────────

test('validateMemoryKey: accepts valid flat key', () => {
  expect(validateMemoryKey('preferences')).toBe(true);
});

test('validateMemoryKey: accepts valid path-based key', () => {
  expect(validateMemoryKey('system/preferences')).toBe(true);
  expect(validateMemoryKey('agent/context')).toBe(true);
  expect(validateMemoryKey('user/timezone')).toBe(true);
  expect(validateMemoryKey('a/b/c')).toBe(true);
});

test('validateMemoryKey: accepts hyphens and underscores', () => {
  expect(validateMemoryKey('my-key')).toBe(true);
  expect(validateMemoryKey('my_key')).toBe(true);
  expect(validateMemoryKey('system/my-pref_v2')).toBe(true);
});

test('validateMemoryKey: rejects path traversal with ..', () => {
  expect(validateMemoryKey('../etc/passwd')).toBe(false);
  expect(validateMemoryKey('system/../preferences')).toBe(false);
  expect(validateMemoryKey('a..b')).toBe(false);
});

test('validateMemoryKey: rejects empty segment (consecutive //)', () => {
  expect(validateMemoryKey('system//preferences')).toBe(false);
});

test('validateMemoryKey: rejects leading slash', () => {
  expect(validateMemoryKey('/system/preferences')).toBe(false);
});

test('validateMemoryKey: rejects trailing slash', () => {
  expect(validateMemoryKey('system/preferences/')).toBe(false);
});

test('validateMemoryKey: rejects special characters', () => {
  expect(validateMemoryKey('key with spaces')).toBe(false);
  expect(validateMemoryKey('key.md')).toBe(false);
  expect(validateMemoryKey('key@host')).toBe(false);
  expect(validateMemoryKey('')).toBe(false);
});

// ─── 6.3 MemoryService integration tests ─────────────────────────────────────

test('MemoryService: setMemory with path-based key creates nested file and git commit', async () => {
  const agent = await createAgent('Git Path Agent');

  await memoryService.setMemory({
    agentId: agent.id,
    key: 'system/preferences',
    value: '# Preferences\n\ntest content',
    category: 'preferences',
  });

  const filePath = path.join(MEMORY_ROOT, agent.id, 'system', 'preferences.md');
  expect(fs.existsSync(filePath)).toBe(true);
  expect(fs.readFileSync(filePath, 'utf-8')).toContain('test content');

  const history = await memoryService.getMemoryHistory(agent.id, 'system/preferences');
  expect(history.length).toBeGreaterThan(0);
  expect(history[0]?.message).toBe('Create system/preferences');
});

test('MemoryService: second setMemory produces Update commit', async () => {
  const agent = await createAgent('Git Update Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'agent/context', value: 'v1', category: 'context' });
  await memoryService.setMemory({ agentId: agent.id, key: 'agent/context', value: 'v2', category: 'context' });

  const history = await memoryService.getMemoryHistory(agent.id, 'agent/context');
  expect(history.length).toBeGreaterThanOrEqual(2);
  expect(history[0]?.message).toBe('Update agent/context');
  expect(history[1]?.message).toBe('Create agent/context');
});

test('MemoryService: deleteMemory creates delete commit', async () => {
  const agent = await createAgent('Git Delete Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'agent/context', value: 'to delete', category: 'context' });
  await memoryService.deleteMemory(agent.id, 'agent/context');

  const filePath = path.join(MEMORY_ROOT, agent.id, 'agent', 'context.md');
  expect(fs.existsSync(filePath)).toBe(false);

  const history = await memoryService.getMemoryHistory(agent.id);
  expect(history.some(h => h.message === 'Delete agent/context')).toBe(true);
});

test('MemoryService: appendHistory uses system/history key', async () => {
  const agent = await createAgent('Append History Agent');

  await memoryService.setMemory({
    agentId: agent.id,
    key: 'system/history',
    value: '# History\n\n',
    category: 'history',
  });

  await memoryService.appendHistory(agent.id, 'Something happened');

  const mem = await memoryService.getMemory(agent.id, 'system/history');
  expect(mem?.value).toContain('Something happened');

  const history = await memoryService.getMemoryHistory(agent.id, 'system/history');
  expect(history.some(h => h.message === 'Append system/history')).toBe(true);
});

test('MemoryService: setMemory rejects invalid keys', async () => {
  const agent = await createAgent('Key Validation Agent');

  await expect(
    memoryService.setMemory({ agentId: agent.id, key: '../evil', value: 'bad', category: 'general' })
  ).rejects.toThrow('Invalid memory key');

  await expect(
    memoryService.setMemory({ agentId: agent.id, key: 'system//pref', value: 'bad', category: 'general' })
  ).rejects.toThrow('Invalid memory key');
});

test('MemoryService: deleteMemory cleans up empty parent directories', async () => {
  const agent = await createAgent('Cleanup Dir Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'agent/context', value: 'data', category: 'context' });
  const agentSubDir = path.join(MEMORY_ROOT, agent.id, 'agent');
  expect(fs.existsSync(agentSubDir)).toBe(true);

  await memoryService.deleteMemory(agent.id, 'agent/context');
  expect(fs.existsSync(agentSubDir)).toBe(false);
});

test('MemoryService: getMemoryAtCommit returns content at a past commit', async () => {
  const agent = await createAgent('Time Travel Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'old content', category: 'preferences' });
  const firstHistory = await memoryService.getMemoryHistory(agent.id, 'system/preferences');
  const oldSha = firstHistory[0]?.sha ?? '';

  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'new content', category: 'preferences' });

  const past = await memoryService.getMemoryAtCommit(agent.id, 'system/preferences', oldSha);
  expect(past).toBe('old content');

  const current = await memoryService.getMemory(agent.id, 'system/preferences');
  expect(current?.value).toBe('new content');
});

test('MemoryService: initializeAgentMemory uses path-based default keys', async () => {
  const agent = await createAgent('Init Keys Agent');
  await memoryService.initializeAgentMemory(agent.id, agent.name);

  const prefs = await memoryService.getMemory(agent.id, 'system/preferences');
  const history = await memoryService.getMemory(agent.id, 'system/history');
  const context = await memoryService.getMemory(agent.id, 'agent/context');

  expect(prefs).not.toBeNull();
  expect(history).not.toBeNull();
  expect(context).not.toBeNull();

  expect(fs.existsSync(path.join(MEMORY_ROOT, agent.id, 'system', 'preferences.md'))).toBe(true);
  expect(fs.existsSync(path.join(MEMORY_ROOT, agent.id, 'system', 'history.md'))).toBe(true);
  expect(fs.existsSync(path.join(MEMORY_ROOT, agent.id, 'agent', 'context.md'))).toBe(true);
});

// ─── 6.4 History API endpoint tests ──────────────────────────────────────────

test('history API: returns commit history for an agent', async () => {
  const agent = await createAgent('History API Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'v1', category: 'preferences' });
  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'v2', category: 'preferences' });

  const response = await historyRoute.GET(
    new NextRequest(`http://localhost/api/agents/${agent.id}/memory/history`),
    { params: Promise.resolve({ id: agent.id }) }
  );

  expect(response.status).toBe(200);
  const body = await response.json() as { success: boolean; data: Array<{ sha: string; message: string; timestamp: number }> };
  expect(body.success).toBe(true);
  expect(body.data.length).toBeGreaterThanOrEqual(2);
  expect(typeof body.data[0]?.sha).toBe('string');
  expect(typeof body.data[0]?.message).toBe('string');
  expect(typeof body.data[0]?.timestamp).toBe('number');
});

test('history API: filters by key query param', async () => {
  const agent = await createAgent('History Filter Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'pref v1', category: 'preferences' });
  await memoryService.setMemory({ agentId: agent.id, key: 'agent/context', value: 'ctx v1', category: 'context' });

  const response = await historyRoute.GET(
    new NextRequest(`http://localhost/api/agents/${agent.id}/memory/history?key=system/preferences`),
    { params: Promise.resolve({ id: agent.id }) }
  );

  const body = await response.json() as { success: boolean; data: Array<{ message: string }> };
  expect(body.success).toBe(true);
  expect(body.data.every(h => h.message.includes('system/preferences'))).toBe(true);
});

test('history API: respects limit query param', async () => {
  const agent = await createAgent('History Limit Agent');

  for (let i = 0; i < 5; i++) {
    await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: `v${i}`, category: 'preferences' });
  }

  const response = await historyRoute.GET(
    new NextRequest(`http://localhost/api/agents/${agent.id}/memory/history?limit=3`),
    { params: Promise.resolve({ id: agent.id }) }
  );

  const body = await response.json() as { success: boolean; data: unknown[] };
  expect(body.success).toBe(true);
  expect(body.data.length).toBeLessThanOrEqual(3);
});

test('history API: returns 404-friendly empty array for agent with no git history', async () => {
  const response = await historyRoute.GET(
    new NextRequest('http://localhost/api/agents/nonexistent-agent/memory/history'),
    { params: Promise.resolve({ id: 'nonexistent-agent' }) }
  );

  expect(response.status).toBe(200);
  const body = await response.json() as { success: boolean; data: unknown[] };
  expect(body.success).toBe(true);
  expect(body.data).toEqual([]);
});

test('at-commit API: returns memory content at a specific commit', async () => {
  const agent = await createAgent('At Commit API Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'at commit content', category: 'preferences' });
  const history = await memoryService.getMemoryHistory(agent.id, 'system/preferences');
  const sha = history[0]?.sha ?? '';

  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'newer content', category: 'preferences' });

  const response = await atCommitRoute.GET(
    new NextRequest(`http://localhost/api/agents/${agent.id}/memory/system%2Fpreferences/at/${sha}`),
    { params: Promise.resolve({ id: agent.id, key: 'system/preferences', sha }) }
  );

  expect(response.status).toBe(200);
  const body = await response.json() as { success: boolean; data: { value: string; sha: string; key: string } };
  expect(body.success).toBe(true);
  expect(body.data.value).toBe('at commit content');
  expect(body.data.sha).toBe(sha);
  expect(body.data.key).toBe('system/preferences');
});

test('at-commit API: returns 404 for non-existent key at commit', async () => {
  const agent = await createAgent('At Commit 404 Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'something', category: 'preferences' });
  const history = await memoryService.getMemoryHistory(agent.id);
  const sha = history[0]?.sha ?? '';

  const response = await atCommitRoute.GET(
    new NextRequest(`http://localhost/api/agents/${agent.id}/memory/nonexistent/at/${sha}`),
    { params: Promise.resolve({ id: agent.id, key: 'nonexistent', sha }) }
  );

  expect(response.status).toBe(404);
});

// ─── 6.5 Graceful degradation tests ──────────────────────────────────────────

test('graceful degradation: all memory operations succeed when GIT_MEMORY_ENABLED=false', async () => {
  process.env.GIT_MEMORY_ENABLED = 'false';
  MemoryGit.resetAvailabilityCache();

  const agent = await createAgent('Degraded Agent');

  await expect(
    memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'works', category: 'preferences' })
  ).resolves.toBeDefined();

  const mem = await memoryService.getMemory(agent.id, 'system/preferences');
  expect(mem?.value).toBe('works');

  await expect(memoryService.appendHistory(agent.id, 'event')).resolves.toBeUndefined();
  await expect(memoryService.deleteMemory(agent.id, 'system/preferences')).resolves.toBe(true);

  const filePath = path.join(MEMORY_ROOT, agent.id, 'system', 'preferences.md');
  expect(fs.existsSync(filePath)).toBe(false);

  const gitDir = path.join(MEMORY_ROOT, agent.id, '.git');
  expect(fs.existsSync(gitDir)).toBe(false);
});

test('graceful degradation: getMemoryHistory returns empty array when git disabled', async () => {
  process.env.GIT_MEMORY_ENABLED = 'false';
  MemoryGit.resetAvailabilityCache();

  const agent = await createAgent('Degraded History Agent');
  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'v1', category: 'preferences' });

  const history = await memoryService.getMemoryHistory(agent.id, 'system/preferences');
  expect(history).toEqual([]);
});

test('graceful degradation: getMemoryAtCommit returns null when git disabled', async () => {
  process.env.GIT_MEMORY_ENABLED = 'false';
  MemoryGit.resetAvailabilityCache();

  const agent = await createAgent('Degraded Commit Agent');
  const result = await memoryService.getMemoryAtCommit(agent.id, 'system/preferences', 'abc123');
  expect(result).toBeNull();
});

test('graceful degradation: no .git directory created when GIT_MEMORY_ENABLED=false', async () => {
  process.env.GIT_MEMORY_ENABLED = 'false';
  MemoryGit.resetAvailabilityCache();

  const agent = await createAgent('No Git Dir Agent');

  await memoryService.setMemory({ agentId: agent.id, key: 'system/preferences', value: 'content', category: 'preferences' });
  await memoryService.setMemory({ agentId: agent.id, key: 'agent/context', value: 'context', category: 'context' });

  expect(fs.existsSync(path.join(MEMORY_ROOT, agent.id, '.git'))).toBe(false);
});
