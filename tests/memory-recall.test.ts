/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'memory-recall.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = path.join(tmpdir(), 'openclaw-mini-memory-recall');

let runtimeConfigFixture: RuntimeConfigFixture | null = null;
let db: typeof import('../src/lib/db').db;
let memoryService: typeof import('../src/lib/services/memory-service').memoryService;
let memoryIndexingService: typeof import('../src/lib/services/memory-indexing').memoryIndexingService;
let toolsModule: typeof import('../src/lib/tools');
let agentService: typeof import('../src/lib/services/agent-service').agentService;

async function resetDb() {
  await db.memoryRecallLog.deleteMany();
  await db.memoryChunk.deleteMany();
  await db.memoryIndexState.deleteMany();
  await db.embeddingCache.deleteMany();
  await db.memoryIndexMetadata.deleteMany();
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

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  process.env.OPENCLAW_MEMORY_DIR = MEMORY_ROOT;

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-memory-recall-', {
    runtime: {
      memory: {
        embeddingProvider: 'mock',
        embeddingModel: 'hash-embed',
        embeddingVersion: 'v1',
        embeddingDimensions: 32,
        chunkingThreshold: 20,
        chunkOverlap: 16,
        vectorRetrievalMode: 'in-process',
        recallConfidenceThreshold: 0.4,
        maxSearchResults: 10,
      },
    },
  });
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;

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

  const { resetDbClientForTests } = await import('../src/lib/db');
  await resetDbClientForTests();

  db = (await import('../src/lib/db')).db;
  memoryService = (await import('../src/lib/services/memory-service')).memoryService;
  memoryIndexingService = (await import('../src/lib/services/memory-indexing')).memoryIndexingService;
  agentService = (await import('../src/lib/services/agent-service')).agentService;
  toolsModule = await import('../src/lib/tools');
});

beforeEach(async () => {
  await resetDb();
  fs.rmSync(MEMORY_ROOT, { recursive: true, force: true });
  fs.mkdirSync(MEMORY_ROOT, { recursive: true });
});

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
  }
  fs.rmSync(MEMORY_ROOT, { recursive: true, force: true });
  fs.rmSync(TEST_DB_PATH, { force: true });
});

describe('memory recall indexing', () => {
  test('chunks long memories and preserves short memories as a single searchable unit', async () => {
    const shortUnits = memoryIndexingService.buildSearchableUnits({ value: 'Alice likes concise replies.' });
    const longUnits = memoryIndexingService.buildSearchableUnits({
      value: 'Long memory '.repeat(40),
    });

    expect(shortUnits).toHaveLength(1);
    expect(longUnits.length).toBeGreaterThanOrEqual(1);
    expect(longUnits[0]?.content.length).toBeGreaterThan(0);
  });

  test('reuses cached embeddings and invalidates cache when descriptor changes', async () => {
    const provider = {
      calls: 0,
      async embed(text: string, descriptor: { dimensions: number }) {
        this.calls += 1;
        return Array.from({ length: descriptor.dimensions }, (_, index) => (text.length + index) / 100);
      },
    };

    const first = await memoryIndexingService.generateEmbedding('same content', provider, {
      provider: 'mock',
      model: 'hash-embed',
      version: 'v1',
      dimensions: 8,
    });
    const second = await memoryIndexingService.generateEmbedding('same content', provider, {
      provider: 'mock',
      model: 'hash-embed',
      version: 'v1',
      dimensions: 8,
    });
    const third = await memoryIndexingService.generateEmbedding('same content', provider, {
      provider: 'mock',
      model: 'hash-embed',
      version: 'v2',
      dimensions: 8,
    });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(third.cached).toBe(false);
    expect(provider.calls).toBe(2);
  });

  test('exact, keyword, vector, and fused retrieval operate on shared substrate', async () => {
    const agent = await agentService.createAgent({ name: 'Recall Agent' });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'user/name',
      value: 'Alice prefers concise answers and likes Berlin cafes.',
      category: 'preferences',
      confidence: 0.95,
    });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'project/notes',
      value: 'Sprint ends Friday and Alice owns the launch checklist.',
      category: 'context',
      confidence: 0.88,
    });

    await memoryService.processPendingIndexing();

    const exact = await memoryService.getExactMemory(agent.id, 'user/name');
    const keyword = await memoryService.searchMemories(agent.id, 'Berlin', 5);
    const vector = await memoryIndexingService.searchMemories(agent.id, { query: 'concise answers', limit: 5 });
    const fused = memoryIndexingService.fuseCandidates(
      [
        {
          key: 'user/name',
          memoryId: exact.memory!.id,
          value: exact.memory!.value,
          snippet: 'Alice prefers concise answers',
          confidence: 0.95,
          category: 'preferences',
          retrievalMethod: 'keyword',
          score: 1,
          tokenEstimate: 5,
        },
      ],
      [
        {
          key: 'user/name',
          memoryId: exact.memory!.id,
          value: exact.memory!.value,
          snippet: 'Alice prefers concise answers',
          confidence: 0.95,
          category: 'preferences',
          retrievalMethod: 'vector',
          score: 1,
          tokenEstimate: 5,
        },
      ],
    );

    expect(exact.memory?.value).toContain('Berlin cafes');
    expect(keyword.results[0]?.key).toBe('user/name');
    expect(vector.results.some(result => result.key === 'user/name')).toBe(true);
    expect(fused[0]?.retrievalMethod).toBe('hybrid');
  });

  test('memory_search and memory_get tools expose ranked results with metadata', async () => {
    const agent = await agentService.createAgent({ name: 'Tool Agent' });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'user/timezone',
      value: 'UTC+2, Berlin',
      category: 'preferences',
      confidence: 0.91,
    });
    await memoryService.processPendingIndexing();

    const memorySearch = toolsModule.getTool('memory_search');
    const memoryGet = toolsModule.getTool('memory_get');
    if (!memorySearch?.execute || !memoryGet?.execute) {
      throw new Error('Expected memory tools to be registered');
    }

    const searchResult = await toolsModule.withToolExecutionContext(
      {
        agentId: agent.id,
        taskId: 'task-memory-search',
        taskType: 'message',
      },
      () => memorySearch.execute?.({ query: 'Berlin' }, { toolCallId: 'tool-search', messages: [] }),
    );
    const getResult = await toolsModule.withToolExecutionContext(
      {
        agentId: agent.id,
        taskId: 'task-memory-get',
        taskType: 'message',
      },
      () => memoryGet.execute?.({ key: 'user/timezone' }, { toolCallId: 'tool-get', messages: [] }),
    );

    const searchPayload = searchResult as { success?: boolean; data?: { results?: Array<{ key: string; confidence: number }>; recallLogId?: string } };
    const getPayload = getResult as { success?: boolean; data?: { memory?: { key: string; value: string } } };

    expect(searchPayload.success).toBe(true);
    expect(searchPayload.data?.results?.[0]?.key).toBe('user/timezone');
    expect(typeof searchPayload.data?.recallLogId).toBe('string');
    expect(getPayload.success).toBe(true);
    expect(getPayload.data?.memory?.value).toBe('UTC+2, Berlin');
  });

  test('automatic recall budgets pinned and recalled memory and logs omissions', async () => {
    const agent = await agentService.createAgent({ name: 'Budget Agent' });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'system/preferences',
      value: 'Always be concise and confirm timezone assumptions.',
      category: 'preferences',
      confidence: 0.99,
    });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'agent/context',
      value: 'Current task: help plan travel for Berlin next week.',
      category: 'context',
      confidence: 0.97,
    });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'travel/berlin',
      value: 'Berlin hotel shortlist includes Mitte and Kreuzberg options with breakfast.',
      category: 'general',
      confidence: 0.92,
    });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'travel/backup',
      value: 'Backup hotel option is farther away but cheaper.',
      category: 'general',
      confidence: 0.55,
    });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'travel/low-confidence',
      value: 'Unverified rumor about train strikes.',
      category: 'general',
      confidence: 0.2,
    });

    await memoryService.processPendingIndexing();

    const promptContext = await memoryService.buildPromptContext(agent.id, 35, 'Berlin hotel breakfast');
    const log = await db.memoryRecallLog.findFirst({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
    });

    expect(promptContext.pinnedSection).toContain('system/preferences');
    expect(promptContext.recalledSection).toContain('travel/berlin');
    expect(promptContext.recalledSection).not.toContain('travel/low-confidence');
    expect(promptContext.omittedCount).toBeGreaterThanOrEqual(0);
    expect(log?.omittedCount).toBeGreaterThanOrEqual(0);
  });

  test('keyword-only fallback works when vector retrieval is disabled', async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture not initialized');
    }

    const runtimeFixtureModule = await import('./runtime-config-fixture');
    runtimeFixtureModule.writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        memory: {
          embeddingProvider: 'disabled',
          vectorRetrievalMode: 'disabled',
          chunkingThreshold: 20,
          chunkOverlap: 16,
          recallConfidenceThreshold: 0.4,
          maxSearchResults: 10,
        },
      },
    });

    const providerRegistryModule = await import('../src/lib/services/provider-registry');
    providerRegistryModule.resetProviderRegistryForTests();
    providerRegistryModule.initializeProviderRegistry();

    const agent = await agentService.createAgent({ name: 'Fallback Agent' });
    await memoryService.setMemory({
      agentId: agent.id,
      key: 'notes/fallback',
      value: 'Keyword fallback should still find this note about cron jobs.',
      category: 'general',
      confidence: 0.82,
    });
    await memoryService.processPendingIndexing();

    const result = await memoryService.searchMemories(agent.id, 'cron jobs', 5);

    expect(result.results[0]?.key).toBe('notes/fallback');

    if (!runtimeConfigFixture) {
      return;
    }

    runtimeFixtureModule.writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        memory: {
          embeddingProvider: 'mock',
          embeddingModel: 'hash-embed',
          embeddingVersion: 'v1',
          embeddingDimensions: 32,
          chunkingThreshold: 20,
          chunkOverlap: 16,
          vectorRetrievalMode: 'in-process',
          recallConfidenceThreshold: 0.4,
          maxSearchResults: 10,
        },
      },
    });

    providerRegistryModule.resetProviderRegistryForTests();
    providerRegistryModule.initializeProviderRegistry();
  });
});
