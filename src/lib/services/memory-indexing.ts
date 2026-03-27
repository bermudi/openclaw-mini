import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getRuntimeConfig } from '@/lib/config/runtime';
import { countTokens } from '@/lib/utils/token-counter';
import type {
  Memory,
  MemoryCategory,
  MemoryChunk,
  MemoryIndexState,
  MemoryIndexStatus,
  MemoryRecallCandidate,
  MemoryRecallLogEntry,
  MemoryRecallMode,
  MemoryRetrievalMethod,
} from '@/lib/types';

const DEFAULT_RRF_K = 60;
const DEFAULT_PINNED_KEYS = ['system/preferences', 'agent/context'];

type PrismaMemoryRecord = NonNullable<Awaited<ReturnType<typeof db.memory.findUnique>>>;
type PrismaChunkWithMemory = Awaited<ReturnType<typeof db.memoryChunk.findMany<{ include: { memory: true } }>>>[number];

export interface SearchableMemoryUnit {
  chunkIndex: number;
  content: string;
  normalizedContent: string;
  contentHash: string;
  tokenEstimate: number;
  charCount: number;
}

export interface EmbeddingDescriptor {
  provider: string;
  model: string;
  version: string;
  dimensions: number;
}

export interface EmbeddingProvider {
  embed(text: string, descriptor: EmbeddingDescriptor): Promise<number[]>;
}

export interface EmbeddingResult {
  values: number[];
  descriptor: EmbeddingDescriptor;
  cached: boolean;
}

export interface MemorySearchResult {
  memoryId: string;
  key: string;
  snippet: string;
  confidence: number;
  category: MemoryCategory;
  retrievalMethod: MemoryRetrievalMethod;
  score: number;
}

export interface ExactMemoryResult {
  memory: Memory | null;
  retrievalMethod: 'exact';
}

export interface AutomaticRecallOptions {
  query: string;
  availableTokenBudget: number;
  pinnedKeys?: string[];
}

export interface AutomaticRecallResult {
  pinned: {
    entries: MemoryRecallCandidate[];
    omittedCount: number;
    estimatedTokens: number;
  };
  recalled: {
    entries: MemoryRecallCandidate[];
    omittedCount: number;
    estimatedTokens: number;
  };
  logEntry: MemoryRecallLogEntry;
}

export interface RecallSearchOptions {
  query: string;
  limit?: number;
  includeLowConfidence?: boolean;
}

interface HybridCandidateResult {
  exact: MemoryRecallCandidate[];
  keyword: MemoryRecallCandidate[];
  vector: MemoryRecallCandidate[];
  combined: MemoryRecallCandidate[];
  retrievalMode: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeContent(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function makeSnippet(content: string, maxLength = 200): string {
  const normalized = normalizeWhitespace(content);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clampLimit(limit?: number): number {
  const max = getRuntimeConfig().memory.maxSearchResults;
  if (!limit || !Number.isFinite(limit)) {
    return max;
  }
  return Math.max(1, Math.min(Math.floor(limit), max));
}

function buildFtsMatchQuery(query: string): string | null {
  const tokens = normalizeWhitespace(query)
    .split(/\s+/)
    .map(token => token.replace(/[^\p{L}\p{N}_/-]+/gu, ''))
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map(token => `"${token.replace(/"/g, '""')}"`).join(' AND ');
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function rrfContribution(rank: number, k = DEFAULT_RRF_K): number {
  return 1 / (k + rank + 1);
}

function buildEmbeddingDescriptor(): EmbeddingDescriptor {
  const memoryConfig = getRuntimeConfig().memory;
  return {
    provider: memoryConfig.embeddingProvider,
    model: memoryConfig.embeddingModel,
    version: memoryConfig.embeddingVersion,
    dimensions: memoryConfig.embeddingDimensions,
  };
}

function parseEmbedding(value: string | null): number[] | null {
  if (!value) {
    return null;
  }
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed) || !parsed.every(entry => typeof entry === 'number')) {
    return null;
  }
  return parsed;
}

class HashEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string, descriptor: EmbeddingDescriptor): Promise<number[]> {
    const normalized = normalizeContent(text);
    const vector = Array.from({ length: descriptor.dimensions }, () => 0);
    const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    const input = tokens.length > 0 ? tokens : [normalized || 'empty'];

    for (const token of input) {
      const tokenHash = createHash('sha256').update(`${descriptor.provider}:${descriptor.model}:${token}`).digest();
      for (let index = 0; index < descriptor.dimensions; index += 1) {
        const byte = tokenHash[index % tokenHash.length] ?? 0;
        vector[index] += (byte / 255) - 0.5;
      }
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) {
      return vector;
    }

    return vector.map(value => value / norm);
  }
}

function getEmbeddingProvider(): EmbeddingProvider | null {
  const descriptor = buildEmbeddingDescriptor();
  if (descriptor.provider === 'disabled') {
    return null;
  }
  return new HashEmbeddingProvider();
}

function mapMemory(memory: PrismaMemoryRecord): Memory {
  return {
    id: memory.id,
    agentId: memory.agentId,
    key: memory.key,
    value: memory.value,
    category: memory.category as MemoryCategory,
    confidence: memory.confidence,
    lastReinforcedAt: memory.lastReinforcedAt,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

function mapChunk(chunk: {
  id: string;
  memoryId: string;
  agentId: string;
  memoryKey: string;
  chunkIndex: number;
  content: string;
  normalizedContent: string;
  contentHash: string;
  tokenEstimate: number;
  charCount: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  embeddingDimensions: number | null;
  embeddingJson: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MemoryChunk {
  return {
    id: chunk.id,
    memoryId: chunk.memoryId,
    agentId: chunk.agentId,
    memoryKey: chunk.memoryKey,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    normalizedContent: chunk.normalizedContent,
    contentHash: chunk.contentHash,
    tokenEstimate: chunk.tokenEstimate,
    charCount: chunk.charCount,
    embeddingProvider: chunk.embeddingProvider,
    embeddingModel: chunk.embeddingModel,
    embeddingVersion: chunk.embeddingVersion,
    embeddingDimensions: chunk.embeddingDimensions,
    embedding: parseEmbedding(chunk.embeddingJson),
    indexedAt: chunk.indexedAt,
    createdAt: chunk.createdAt,
    updatedAt: chunk.updatedAt,
  };
}

function mapIndexState(state: {
  id: string;
  memoryId: string;
  agentId: string;
  status: string;
  lastContentHash: string | null;
  lastIndexedAt: Date | null;
  lastError: string | null;
  attempts: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  embeddingDimensions: number | null;
  vectorMode: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MemoryIndexState {
  return {
    id: state.id,
    memoryId: state.memoryId,
    agentId: state.agentId,
    status: state.status as MemoryIndexStatus,
    lastContentHash: state.lastContentHash,
    lastIndexedAt: state.lastIndexedAt,
    lastError: state.lastError,
    attempts: state.attempts,
    embeddingProvider: state.embeddingProvider,
    embeddingModel: state.embeddingModel,
    embeddingVersion: state.embeddingVersion,
    embeddingDimensions: state.embeddingDimensions,
    vectorMode: state.vectorMode,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function mapRecallLog(entry: {
  id: string;
  agentId: string;
  mode: string;
  query: string | null;
  retrievalMode: string;
  candidateCounts: string;
  selectedKeys: string;
  omittedKeys: string;
  selectedCount: number;
  omittedCount: number;
  estimatedTokens: number;
  details: string;
  createdAt: Date;
}): MemoryRecallLogEntry {
  return {
    id: entry.id,
    agentId: entry.agentId,
    mode: entry.mode as MemoryRecallMode,
    query: entry.query,
    retrievalMode: entry.retrievalMode,
    candidateCounts: parseJson<Record<string, number>>(entry.candidateCounts, {}),
    selectedKeys: parseJson<string[]>(entry.selectedKeys, []),
    omittedKeys: parseJson<string[]>(entry.omittedKeys, []),
    selectedCount: entry.selectedCount,
    omittedCount: entry.omittedCount,
    estimatedTokens: entry.estimatedTokens,
    details: parseJson<Record<string, unknown>>(entry.details, {}),
    createdAt: entry.createdAt,
  };
}

export class MemoryIndexingService {
  private metadataReady = false;

  async ensureIndexStructures(): Promise<void> {
    await db.$executeRawUnsafe(
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(memory_chunk_id UNINDEXED, agent_id UNINDEXED, memory_key, content)',
    );
    await db.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS memory_chunk_vectors (memory_chunk_id TEXT PRIMARY KEY, embedding_json TEXT NOT NULL, dimensions INTEGER NOT NULL)',
    );

    if (this.metadataReady) {
      return;
    }

    const metadataColumns = await db.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("memory_index_metadata")');
    const hasMetadataTable = metadataColumns.some(column => column.name === 'indexName');
    if (!hasMetadataTable) {
      return;
    }

    await db.memoryIndexMetadata.upsert({
      where: {
        indexName_scopeKey: {
          indexName: 'memory_chunks_fts',
          scopeKey: 'global',
        },
      },
      create: {
        indexName: 'memory_chunks_fts',
        scopeKey: 'global',
        status: 'ready',
        details: JSON.stringify({ type: 'fts5' }),
      },
      update: {
        status: 'ready',
        details: JSON.stringify({ type: 'fts5' }),
      },
    });

    await db.memoryIndexMetadata.upsert({
      where: {
        indexName_scopeKey: {
          indexName: 'memory_chunk_vectors',
          scopeKey: 'global',
        },
      },
      create: {
        indexName: 'memory_chunk_vectors',
        scopeKey: 'global',
        status: 'ready',
        details: JSON.stringify({ type: 'vector-store', mode: getRuntimeConfig().memory.vectorRetrievalMode }),
      },
      update: {
        status: 'ready',
        details: JSON.stringify({ type: 'vector-store', mode: getRuntimeConfig().memory.vectorRetrievalMode }),
      },
    });

    this.metadataReady = true;
  }

  buildSearchableUnits(memory: Pick<Memory, 'value'>): SearchableMemoryUnit[] {
    const threshold = Math.max(1, getRuntimeConfig().memory.chunkingThreshold);
    const overlap = Math.min(getRuntimeConfig().memory.chunkOverlap, Math.max(0, threshold - 1));
    const normalizedValue = normalizeWhitespace(memory.value);
    const tokenLength = countTokens(normalizedValue);

    if (!normalizedValue) {
      return [];
    }

    if (tokenLength <= threshold) {
      return [this.createUnit(normalizedValue, 0)];
    }

    const effectiveTokenThreshold = Math.max(1, Math.floor(threshold / 4));
    const effectiveOverlap = Math.min(Math.max(0, Math.floor(overlap / 4)), Math.max(0, effectiveTokenThreshold - 1));
    if (tokenLength <= effectiveTokenThreshold) {
      return [this.createUnit(normalizedValue, 0)];
    }

    const words = normalizedValue.split(' ').filter(Boolean);
    const chunks: SearchableMemoryUnit[] = [];
    let chunkIndex = 0;
    let currentWords: string[] = [];

    for (const word of words) {
      const candidateWords = [...currentWords, word];
      const candidateContent = candidateWords.join(' ');
      if (currentWords.length > 0 && countTokens(candidateContent) > effectiveTokenThreshold) {
        chunks.push(this.createUnit(currentWords.join(' '), chunkIndex));
        chunkIndex += 1;
        const overlapWords = this.selectOverlapWords(currentWords, effectiveOverlap);
        currentWords = overlapWords.length > 0 ? [...overlapWords, word] : [word];
      } else {
        currentWords = candidateWords;
      }
    }

    if (currentWords.length > 0) {
      chunks.push(this.createUnit(currentWords.join(' '), chunkIndex));
    }

    return chunks;
  }

  private selectOverlapWords(words: string[], overlapTokens: number): string[] {
    if (overlapTokens <= 0 || words.length === 0) {
      return [];
    }

    const overlapWords: string[] = [];
    for (let index = words.length - 1; index >= 0; index -= 1) {
      overlapWords.unshift(words[index]!);
      if (countTokens(overlapWords.join(' ')) >= overlapTokens) {
        break;
      }
    }

    return overlapWords;
  }

  private createUnit(content: string, chunkIndex: number): SearchableMemoryUnit {
    const normalizedContent = normalizeContent(content);
    return {
      chunkIndex,
      content,
      normalizedContent,
      contentHash: hashContent(normalizedContent),
      tokenEstimate: countTokens(content),
      charCount: content.length,
    };
  }

  async markMemoryForIndexing(memoryId: string, agentId: string, reason: 'write' | 'reindex'): Promise<MemoryIndexState> {
    const memory = await db.memory.findUnique({ where: { id: memoryId } });
    const contentHash = memory ? hashContent(normalizeContent(memory.value)) : null;
    const state = await db.memoryIndexState.upsert({
      where: { memoryId },
      create: {
        memoryId,
        agentId,
        status: 'pending',
        lastContentHash: contentHash,
        vectorMode: getRuntimeConfig().memory.vectorRetrievalMode,
      },
      update: {
        status: reason === 'reindex' ? 'stale' : 'pending',
        lastContentHash: contentHash,
        lastError: null,
        vectorMode: getRuntimeConfig().memory.vectorRetrievalMode,
      },
    });
    return mapIndexState(state);
  }

  async purgeMemoryIndex(memoryId: string): Promise<void> {
    const chunks = await db.memoryChunk.findMany({
      where: { memoryId },
      select: { id: true },
    });

    for (const chunk of chunks) {
      await db.$executeRawUnsafe('DELETE FROM memory_chunks_fts WHERE memory_chunk_id = ?', chunk.id);
      await db.$executeRawUnsafe('DELETE FROM memory_chunk_vectors WHERE memory_chunk_id = ?', chunk.id);
    }

    await db.memoryChunk.deleteMany({ where: { memoryId } });
  }

  async generateEmbedding(
    content: string,
    provider: EmbeddingProvider,
    descriptor: EmbeddingDescriptor,
  ): Promise<EmbeddingResult> {
    const normalizedContent = normalizeContent(content);
    const contentHash = hashContent(normalizedContent);
    const cached = await db.embeddingCache.findUnique({
      where: {
        contentHash_provider_model_version_dimensions: {
          contentHash,
          provider: descriptor.provider,
          model: descriptor.model,
          version: descriptor.version,
          dimensions: descriptor.dimensions,
        },
      },
    });

    if (cached) {
      return {
        values: parseJson<number[]>(cached.embedding, []),
        descriptor,
        cached: true,
      };
    }

    const values = await provider.embed(content, descriptor);
    try {
      await db.embeddingCache.create({
        data: {
          contentHash,
          normalizedContent,
          provider: descriptor.provider,
          model: descriptor.model,
          version: descriptor.version,
          dimensions: descriptor.dimensions,
          embedding: JSON.stringify(values),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await db.embeddingCache.findUnique({
          where: {
            contentHash_provider_model_version_dimensions: {
              contentHash,
              provider: descriptor.provider,
              model: descriptor.model,
              version: descriptor.version,
              dimensions: descriptor.dimensions,
            },
          },
        });

        if (existing) {
          return {
            values: parseJson<number[]>(existing.embedding, []),
            descriptor,
            cached: true,
          };
        }
      }

      throw error;
    }

    return {
      values,
      descriptor,
      cached: false,
    };
  }

  async indexMemory(memoryId: string, options: { force?: boolean } = {}): Promise<{ chunks: MemoryChunk[]; state: MemoryIndexState | null }> {
    await this.ensureIndexStructures();

    const memory = await db.memory.findUnique({ where: { id: memoryId } });
    if (!memory) {
      await this.purgeMemoryIndex(memoryId);
      await db.memoryIndexState.deleteMany({ where: { memoryId } });
      return { chunks: [], state: null };
    }

    const descriptor = buildEmbeddingDescriptor();
    const provider = getEmbeddingProvider();
    const units = this.buildSearchableUnits({ value: memory.value });
    const nextHash = hashContent(normalizeContent(memory.value));

    const state = await db.memoryIndexState.upsert({
      where: { memoryId },
      create: {
        memoryId,
        agentId: memory.agentId,
        status: 'pending',
        lastContentHash: nextHash,
        embeddingProvider: descriptor.provider,
        embeddingModel: descriptor.model,
        embeddingVersion: descriptor.version,
        embeddingDimensions: descriptor.dimensions,
        vectorMode: getRuntimeConfig().memory.vectorRetrievalMode,
      },
      update: {
        attempts: { increment: 1 },
        status: 'pending',
        lastContentHash: nextHash,
        lastError: null,
        embeddingProvider: descriptor.provider,
        embeddingModel: descriptor.model,
        embeddingVersion: descriptor.version,
        embeddingDimensions: descriptor.dimensions,
        vectorMode: getRuntimeConfig().memory.vectorRetrievalMode,
      },
    });

    const existingChunks = await db.memoryChunk.findMany({ where: { memoryId } });
    const unchanged = !options.force
      && existingChunks.length === units.length
      && existingChunks.every((chunk, index) => chunk.contentHash === units[index]?.contentHash)
      && existingChunks.every(chunk => chunk.indexedAt !== null);

    if (unchanged) {
      return {
        chunks: existingChunks.map(mapChunk),
        state: mapIndexState(state),
      };
    }

    try {
      await this.purgeMemoryIndex(memoryId);
      const createdChunks: MemoryChunk[] = [];

      for (const unit of units) {
        let embeddingValues: number[] | null = null;
        let embeddingCacheId: string | null = null;

        if (provider && descriptor.provider !== 'disabled') {
          const result = await this.generateEmbedding(unit.content, provider, descriptor);
          embeddingValues = result.values;
          const cache = await db.embeddingCache.findUnique({
            where: {
              contentHash_provider_model_version_dimensions: {
                contentHash: unit.contentHash,
                provider: descriptor.provider,
                model: descriptor.model,
                version: descriptor.version,
                dimensions: descriptor.dimensions,
              },
            },
          });
          embeddingCacheId = cache?.id ?? null;
        }

        const created = await db.memoryChunk.create({
          data: {
            memoryId,
            agentId: memory.agentId,
            memoryKey: memory.key,
            chunkIndex: unit.chunkIndex,
            content: unit.content,
            normalizedContent: unit.normalizedContent,
            contentHash: unit.contentHash,
            tokenEstimate: unit.tokenEstimate,
            charCount: unit.charCount,
            embeddingCacheId,
            embeddingProvider: embeddingValues ? descriptor.provider : null,
            embeddingModel: embeddingValues ? descriptor.model : null,
            embeddingVersion: embeddingValues ? descriptor.version : null,
            embeddingDimensions: embeddingValues ? descriptor.dimensions : null,
            embeddingJson: embeddingValues ? JSON.stringify(embeddingValues) : null,
            indexedAt: new Date(),
          },
        });

        await db.$executeRawUnsafe(
          'INSERT INTO memory_chunks_fts (memory_chunk_id, agent_id, memory_key, content) VALUES (?, ?, ?, ?)',
          created.id,
          memory.agentId,
          memory.key,
          unit.content,
        );

        if (embeddingValues) {
          await db.$executeRawUnsafe(
            'INSERT OR REPLACE INTO memory_chunk_vectors (memory_chunk_id, embedding_json, dimensions) VALUES (?, ?, ?)',
            created.id,
            JSON.stringify(embeddingValues),
            descriptor.dimensions,
          );
        }

        createdChunks.push(mapChunk(created));
      }

      const updatedState = await db.memoryIndexState.upsert({
        where: { memoryId },
        create: {
          memoryId,
          agentId: memory.agentId,
          status: 'indexed',
          lastContentHash: nextHash,
          lastIndexedAt: new Date(),
          lastError: null,
          attempts: 1,
          embeddingProvider: descriptor.provider,
          embeddingModel: descriptor.model,
          embeddingVersion: descriptor.version,
          embeddingDimensions: descriptor.dimensions,
          vectorMode: getRuntimeConfig().memory.vectorRetrievalMode,
        },
        update: {
          status: 'indexed',
          lastIndexedAt: new Date(),
          lastError: null,
        },
      });

      return {
        chunks: createdChunks,
        state: mapIndexState(updatedState),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedState = await db.memoryIndexState.upsert({
        where: { memoryId },
        create: {
          memoryId,
          agentId: memory.agentId,
          status: 'failed',
          lastContentHash: nextHash,
          lastError: message,
          attempts: 1,
          embeddingProvider: descriptor.provider,
          embeddingModel: descriptor.model,
          embeddingVersion: descriptor.version,
          embeddingDimensions: descriptor.dimensions,
          vectorMode: getRuntimeConfig().memory.vectorRetrievalMode,
        },
        update: {
          status: 'failed',
          lastError: message,
        },
      });
      return {
        chunks: [],
        state: mapIndexState(failedState),
      };
    }
  }

  async reindexAgentMemories(agentId: string, options: { force?: boolean } = {}): Promise<{ indexed: number; failed: number; states: MemoryIndexState[] }> {
    await this.ensureIndexStructures();

    const memories = await db.memory.findMany({
      where: {
        agentId,
        category: { not: 'archived' },
      },
      orderBy: [{ updatedAt: 'asc' }, { key: 'asc' }],
    });

    let indexed = 0;
    let failed = 0;
    const states: MemoryIndexState[] = [];

    for (const memory of memories) {
      await this.markMemoryForIndexing(memory.id, agentId, 'reindex');
      const result = await this.indexMemory(memory.id, options);
      if (result.state?.status === 'indexed') {
        indexed += 1;
      } else {
        failed += 1;
      }
      if (result.state) {
        states.push(result.state);
      }
    }

    return { indexed, failed, states };
  }

  async getPendingIndexStates(limit = 50): Promise<MemoryIndexState[]> {
    const states = await db.memoryIndexState.findMany({
      where: {
        status: { in: ['pending', 'stale', 'failed'] },
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
      take: Math.max(1, limit),
    });

    return states.map(mapIndexState);
  }

  async exactGet(agentId: string, key: string): Promise<ExactMemoryResult> {
    const memory = await db.memory.findUnique({
      where: {
        agentId_key: {
          agentId,
          key,
        },
      },
    });

    return {
      memory: memory ? mapMemory(memory) : null,
      retrievalMethod: 'exact',
    };
  }

  private async keywordCandidates(agentId: string, query: string, limit?: number): Promise<MemoryRecallCandidate[]> {
    await this.ensureIndexStructures();

    const normalizedQuery = normalizeWhitespace(query);
    if (!normalizedQuery) {
      return [];
    }

    const resolvedLimit = clampLimit(limit);
    const ftsQuery = buildFtsMatchQuery(normalizedQuery);

    if (!ftsQuery) {
      return [];
    }

    try {
      const rows = await db.$queryRawUnsafe<Array<{
        id: string;
        memoryId: string;
        memoryKey: string;
        content: string;
        tokenEstimate: number;
        value: string;
        category: string;
        confidence: number;
      }>>(
        `
          SELECT
            mc.id AS id,
            mc."memoryId" AS memoryId,
            mc."memoryKey" AS memoryKey,
            mc.content AS content,
            mc."tokenEstimate" AS tokenEstimate,
            m.value AS value,
            m.category AS category,
            m.confidence AS confidence
          FROM memory_chunks_fts
          JOIN memory_chunks mc ON mc.id = memory_chunks_fts.memory_chunk_id
          JOIN memories m ON m.id = mc."memoryId"
          WHERE memory_chunks_fts MATCH ?
            AND mc."agentId" = ?
            AND m.category != 'archived'
          ORDER BY bm25(memory_chunks_fts), m.confidence DESC, m."updatedAt" DESC
          LIMIT ?
        `,
        ftsQuery,
        agentId,
        resolvedLimit,
      );

      return rows.map((row, index) => ({
        key: row.memoryKey,
        memoryId: row.memoryId,
        value: row.value,
        snippet: makeSnippet(row.content),
        confidence: row.confidence,
        category: row.category as MemoryCategory,
        retrievalMethod: 'keyword',
        score: rrfContribution(index),
        tokenEstimate: row.tokenEstimate,
        chunkId: row.id,
      }));
    } catch {
      const rows = await db.memoryChunk.findMany({
        where: {
          agentId,
          OR: [
            { normalizedContent: { contains: normalizeContent(normalizedQuery) } },
            { memoryKey: { contains: normalizedQuery } },
          ],
          memory: {
            category: { not: 'archived' },
          },
        },
        include: {
          memory: true,
        },
        orderBy: [
          { memory: { confidence: 'desc' } },
          { updatedAt: 'desc' },
        ],
        take: resolvedLimit,
      });

      return rows.map((row, index) => ({
        key: row.memoryKey,
        memoryId: row.memoryId,
        value: row.memory.value,
        snippet: makeSnippet(row.content),
        confidence: row.memory.confidence,
        category: row.memory.category as MemoryCategory,
        retrievalMethod: 'keyword',
        score: rrfContribution(index),
        tokenEstimate: row.tokenEstimate,
        chunkId: row.id,
      }));
    }
  }

  private async vectorCandidates(agentId: string, query: string, limit?: number): Promise<MemoryRecallCandidate[]> {
    const descriptor = buildEmbeddingDescriptor();
    const provider = getEmbeddingProvider();
    if (!provider || descriptor.provider === 'disabled') {
      return [];
    }

    const queryEmbedding = await this.generateEmbedding(query, provider, descriptor);
    const chunks = await db.memoryChunk.findMany({
      where: {
        agentId,
        embeddingJson: { not: null },
        memory: {
          category: { not: 'archived' },
        },
      },
      include: {
        memory: true,
      },
    });

    return chunks
      .map((chunk) => {
        const embedding = parseEmbedding(chunk.embeddingJson);
        if (!embedding) {
          return null;
        }
        return {
          chunk,
          score: cosineSimilarity(queryEmbedding.values, embedding),
        };
      })
      .filter((entry): entry is { chunk: PrismaChunkWithMemory; score: number } => entry !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, clampLimit(limit))
      .map(({ chunk, score }) => ({
        key: chunk.memoryKey,
        memoryId: chunk.memoryId,
        value: chunk.memory.value,
        snippet: makeSnippet(chunk.content),
        confidence: chunk.memory.confidence,
        category: chunk.memory.category as MemoryCategory,
        retrievalMethod: 'vector',
        score,
        tokenEstimate: chunk.tokenEstimate,
        chunkId: chunk.id,
      }));
  }

  fuseCandidates(
    keyword: MemoryRecallCandidate[],
    vector: MemoryRecallCandidate[],
    options: { includeLowConfidence?: boolean } = {},
  ): MemoryRecallCandidate[] {
    const threshold = getRuntimeConfig().memory.recallConfidenceThreshold;
    const fused = new Map<string, MemoryRecallCandidate>();

    const merge = (candidates: MemoryRecallCandidate[], method: MemoryRetrievalMethod) => {
      candidates.forEach((candidate, index) => {
        if (!options.includeLowConfidence && candidate.confidence < threshold) {
          return;
        }
        const existing = fused.get(candidate.key);
        const nextScore = (existing?.score ?? 0) + rrfContribution(index);
        fused.set(candidate.key, {
          ...(existing ?? candidate),
          retrievalMethod: existing
            ? existing.retrievalMethod === method
              ? method
              : 'hybrid'
            : method,
          score: nextScore,
          confidence: Math.max(existing?.confidence ?? 0, candidate.confidence),
          snippet: existing?.snippet && existing.snippet.length >= candidate.snippet.length
            ? existing.snippet
            : candidate.snippet,
        });
      });
    };

    merge(keyword, 'keyword');
    merge(vector, 'vector');

    return [...fused.values()].sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      return right.score - left.score;
    });
  }

  private async collectHybridCandidates(
    agentId: string,
    options: RecallSearchOptions,
  ): Promise<HybridCandidateResult> {
    const query = normalizeWhitespace(options.query);
    if (!query) {
      return {
        exact: [],
        keyword: [],
        vector: [],
        combined: [],
        retrievalMode: 'keyword-only',
      };
    }

    const exactResult = agentId ? await this.exactGet(agentId, query) : { memory: null, retrievalMethod: 'exact' as const };
    const exact = exactResult.memory
      ? [{
          key: exactResult.memory.key,
          memoryId: exactResult.memory.id,
          value: exactResult.memory.value,
          snippet: makeSnippet(exactResult.memory.value),
          confidence: exactResult.memory.confidence,
          category: exactResult.memory.category,
          retrievalMethod: 'exact' as const,
          score: Number.MAX_SAFE_INTEGER,
          tokenEstimate: countTokens(exactResult.memory.value),
        }]
      : [];

    const keyword = await this.keywordCandidates(agentId, query, options.limit);
    let vector: MemoryRecallCandidate[] = [];
    let retrievalMode = 'keyword-only';

    try {
      vector = await this.vectorCandidates(agentId, query, options.limit);
      retrievalMode = vector.length > 0 ? 'hybrid' : 'keyword-only';
    } catch (error) {
      retrievalMode = 'keyword-only';
      console.warn('[memory-indexing] vector retrieval unavailable, using keyword fallback:', error);
    }

    const fused = this.fuseCandidates(keyword, vector, {
      includeLowConfidence: options.includeLowConfidence,
    });

    const combined = [...exact, ...fused.filter(candidate => candidate.key !== exactResult.memory?.key)]
      .slice(0, clampLimit(options.limit));

    return {
      exact,
      keyword,
      vector,
      combined,
      retrievalMode,
    };
  }

  async searchMemories(
    agentId: string,
    options: RecallSearchOptions,
  ): Promise<{ results: MemorySearchResult[]; logEntry: MemoryRecallLogEntry }> {
    const candidates = await this.collectHybridCandidates(agentId, options);
    const results = candidates.combined.map(candidate => ({
      memoryId: candidate.memoryId,
      key: candidate.key,
      snippet: candidate.snippet,
      confidence: candidate.confidence,
      category: candidate.category,
      retrievalMethod: candidate.retrievalMethod,
      score: candidate.score,
    }));

    const logEntry = await this.logRecall({
      agentId,
      mode: 'search',
      query: normalizeWhitespace(options.query),
      retrievalMode: candidates.retrievalMode,
      candidateCounts: {
        exact: candidates.exact.length,
        keyword: candidates.keyword.length,
        vector: candidates.vector.length,
      },
      selected: candidates.combined,
      omitted: [],
      estimatedTokens: candidates.combined.reduce((sum, candidate) => sum + candidate.tokenEstimate, 0),
      details: {
        includeLowConfidence: options.includeLowConfidence ?? false,
      },
    });

    return { results, logEntry };
  }

  async buildAutomaticRecall(
    agentId: string,
    options: AutomaticRecallOptions,
  ): Promise<AutomaticRecallResult> {
    await this.ensureIndexStructures();

    const pinnedKeys = options.pinnedKeys ?? DEFAULT_PINNED_KEYS;
    const pinnedMemories = await db.memory.findMany({
      where: {
        agentId,
        key: { in: pinnedKeys },
        category: { not: 'archived' },
      },
      orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
    });

    const pinnedCandidates: MemoryRecallCandidate[] = pinnedMemories.map(memory => ({
      key: memory.key,
      memoryId: memory.id,
      value: memory.value,
      snippet: memory.value,
      confidence: memory.confidence,
      category: memory.category as MemoryCategory,
      retrievalMethod: 'pinned',
      score: Number.MAX_SAFE_INTEGER,
      tokenEstimate: countTokens(memory.value),
    }));

    const hybrid = await this.collectHybridCandidates(agentId, {
      query: options.query,
      limit: getRuntimeConfig().memory.maxSearchResults,
      includeLowConfidence: true,
    });

    const recalledPool = hybrid.combined.filter(candidate => !pinnedKeys.includes(candidate.key));
    const threshold = getRuntimeConfig().memory.recallConfidenceThreshold;
    let remainingBudget = Math.max(0, options.availableTokenBudget);
    const pinnedSelected: MemoryRecallCandidate[] = [];
    const pinnedOmitted: MemoryRecallCandidate[] = [];
    const recalledSelected: MemoryRecallCandidate[] = [];
    const recalledOmitted: MemoryRecallCandidate[] = [];
    for (const candidate of pinnedCandidates) {
      if (candidate.tokenEstimate <= remainingBudget) {
        pinnedSelected.push(candidate);
        remainingBudget -= candidate.tokenEstimate;
      } else {
        pinnedOmitted.push(candidate);
      }
    }

    for (const candidate of recalledPool) {
      if (candidate.confidence < threshold) {
        recalledOmitted.push(candidate);
        continue;
      }
      if (candidate.tokenEstimate <= remainingBudget) {
        recalledSelected.push(candidate);
        remainingBudget = Math.max(remainingBudget - candidate.tokenEstimate, 0);
      } else {
        recalledOmitted.push(candidate);
      }
    }

    const logEntry = await this.logRecall({
      agentId,
      mode: 'automatic',
      query: normalizeWhitespace(options.query),
      retrievalMode: hybrid.retrievalMode === 'keyword-only' ? 'automatic-keyword' : 'automatic-hybrid',
      candidateCounts: {
        pinned: pinnedCandidates.length,
        exact: hybrid.exact.length,
        keyword: hybrid.keyword.length,
        vector: hybrid.vector.length,
      },
      selected: [...pinnedSelected, ...recalledSelected],
      omitted: [...pinnedOmitted, ...recalledOmitted],
      estimatedTokens: [...pinnedSelected, ...recalledSelected].reduce((sum, candidate) => sum + candidate.tokenEstimate, 0),
      details: {
        availableTokenBudget: options.availableTokenBudget,
        threshold,
      },
    });

    return {
      pinned: {
        entries: pinnedSelected,
        omittedCount: pinnedOmitted.length,
        estimatedTokens: pinnedSelected.reduce((sum, candidate) => sum + candidate.tokenEstimate, 0),
      },
      recalled: {
        entries: recalledSelected,
        omittedCount: recalledOmitted.length,
        estimatedTokens: recalledSelected.reduce((sum, candidate) => sum + candidate.tokenEstimate, 0),
      },
      logEntry,
    };
  }

  async logRecall(input: {
    agentId: string;
    mode: MemoryRecallMode;
    query: string;
    retrievalMode: string;
    candidateCounts: Record<string, number>;
    selected: Array<Pick<MemoryRecallCandidate, 'key'>>;
    omitted: Array<Pick<MemoryRecallCandidate, 'key'>>;
    estimatedTokens: number;
    details: Record<string, unknown>;
  }): Promise<MemoryRecallLogEntry> {
    const entry = await db.memoryRecallLog.create({
      data: {
        agentId: input.agentId,
        mode: input.mode,
        query: input.query,
        retrievalMode: input.retrievalMode,
        candidateCounts: JSON.stringify(input.candidateCounts),
        selectedKeys: JSON.stringify(input.selected.map(candidate => candidate.key)),
        omittedKeys: JSON.stringify(input.omitted.map(candidate => candidate.key)),
        selectedCount: input.selected.length,
        omittedCount: input.omitted.length,
        estimatedTokens: input.estimatedTokens,
        details: JSON.stringify(input.details),
      },
    });

    return mapRecallLog(entry);
  }
}

export const memoryIndexingService = new MemoryIndexingService();
