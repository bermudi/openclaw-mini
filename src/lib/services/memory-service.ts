// OpenClaw Agent Runtime - Memory Service
// Persistent storage system using Markdown format

import { db } from '@/lib/db';
import { Memory, MemoryCategory } from '@/lib/types';
import { MemoryGit, type GitCommit } from '@/lib/services/memory-git';
import { eventBus } from '@/lib/services/event-bus';
import { memoryIndexingService, type AutomaticRecallResult } from '@/lib/services/memory-indexing';
import * as fs from 'fs';
import * as path from 'path';

export type { GitCommit };

export function validateMemoryKey(key: string): boolean {
  if (!key || key.includes('..')) return false;
  if (key.startsWith('/') || key.endsWith('/')) return false;
  if (key.includes('//')) return false;
  return /^[a-zA-Z0-9/_-]+$/.test(key);
}

export function getMemoryDir(): string {
  return process.env.OPENCLAW_MEMORY_DIR ?? path.join(process.cwd(), 'data', 'memories');
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPositiveFloatEnv(name: string, fallback: number): number {
  const value = process.env[name];
  const parsed = value ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCurrentArchiveDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function buildHistoryValue(entry: string): string {
  return `# History\n\n${entry}`;
}

export interface CreateMemoryInput {
  agentId: string;
  key: string;
  value: string;
  category?: MemoryCategory;
  confidence?: number;
  _commitAction?: 'Create' | 'Update' | 'Append';
  _preserveConfidence?: boolean;
  _skipIndexing?: boolean;
}

export interface UpdateMemoryInput {
  value: string;
  category?: MemoryCategory;
}

export interface MemoryPromptContext {
  pinnedSection: string;
  recalledSection: string;
  omittedCount: number;
  estimatedTokens: number;
  logId: string | null;
}

class MemoryService {
  private gitInstances = new Map<string, MemoryGit>();
  private memoryDirCreated = false;

  private ensureMemoryDir(): void {
    if (this.memoryDirCreated) return;
    const memoryDir = getMemoryDir();
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    this.memoryDirCreated = true;
  }

  private async getGit(agentId: string): Promise<MemoryGit | null> {
    if (!MemoryGit.isAvailable()) return null;
    let git = this.gitInstances.get(agentId);
    if (!git) {
      git = new MemoryGit(path.join(getMemoryDir(), agentId));
      this.gitInstances.set(agentId, git);
    }
    return git;
  }

  /**
   * Create or update memory entry
   */
  async setMemory(input: CreateMemoryInput): Promise<Memory> {
    if (!validateMemoryKey(input.key)) {
      throw new Error(`Invalid memory key: "${input.key}"`);
    }

    const existing = await db.memory.findUnique({
      where: {
        agentId_key: {
          agentId: input.agentId,
          key: input.key,
        },
      },
    });

    let memory;
    if (existing) {
      memory = await db.memory.update({
        where: { id: existing.id },
        data: {
          value: input.value,
          category: input.category ?? 'general',
          ...(input._preserveConfidence
            ? {}
            : {
                confidence: input.confidence ?? 1.0,
                lastReinforcedAt: new Date(),
              }),
        },
      });
    } else {
      memory = await db.memory.create({
        data: {
          agentId: input.agentId,
          key: input.key,
          value: input.value,
          category: input.category ?? 'general',
          confidence: input.confidence ?? 1.0,
          lastReinforcedAt: new Date(),
        },
      });
    }

    // Also save to file for persistence
    const action = input._commitAction ?? (existing ? 'Update' : 'Create');
    await this.saveToFile(input.agentId, input.key, input.value, action);

    if (!input._skipIndexing) {
      await memoryIndexingService.markMemoryForIndexing(memory.id, input.agentId, 'write');
    }

    eventBus.emit('memory:updated', { agentId: input.agentId, key: input.key });
    if (!input._skipIndexing) {
      eventBus.emit('memory:index-requested', {
        agentId: input.agentId,
        memoryId: memory.id,
        key: input.key,
        reason: 'write',
      });
    }

    return this.mapMemory(memory);
  }

  async processPendingIndexing(limit = 20): Promise<{ processed: number; failed: number }> {
    const states = await memoryIndexingService.getPendingIndexStates(limit);
    let processed = 0;
    let failed = 0;

    for (const state of states) {
      const result = await memoryIndexingService.indexMemory(state.memoryId);
      if (result.state?.status === 'indexed') {
        processed += 1;
      } else {
        failed += 1;
      }
    }

    return { processed, failed };
  }

  async reindexAgentMemories(agentId: string, force = false): Promise<{ indexed: number; failed: number }> {
    const result = await memoryIndexingService.reindexAgentMemories(agentId, { force });
    return {
      indexed: result.indexed,
      failed: result.failed,
    };
  }

  /**
   * Get memory by key
   */
  async getMemory(agentId: string, key: string): Promise<Memory | null> {
    const memory = await db.memory.findUnique({
      where: {
        agentId_key: {
          agentId,
          key,
        },
      },
    });

    return memory ? this.mapMemory(memory) : null;
  }

  /**
   * Get all memories for an agent
   */
  async getAgentMemories(agentId: string, category?: MemoryCategory): Promise<Memory[]> {
    const memories = await db.memory.findMany({
      where: {
        agentId,
        ...(category ? { category } : { category: { not: 'archived' } }),
      },
      orderBy: { confidence: 'desc' },
    });

    return memories.map(m => this.mapMemory(m));
  }

  /**
   * Delete memory
   */
  async deleteMemory(agentId: string, key: string): Promise<boolean> {
    const memory = await db.memory.findUnique({
      where: {
        agentId_key: {
          agentId,
          key,
        },
      },
    });

    if (!memory) {
      return false;
    }

    await db.memory.delete({
      where: { id: memory.id },
    });

    await memoryIndexingService.purgeMemoryIndex(memory.id);

    // Also delete file
    await this.deleteFile(agentId, key);

    return true;
  }

  /**
   * Get memory commit history
   */
  async getMemoryHistory(agentId: string, key?: string, limit = 50): Promise<GitCommit[]> {
    const git = await this.getGit(agentId);
    if (!git) return [];
    const filePath = key ? `${key}.md` : undefined;
    return git.log(filePath, limit);
  }

  /**
   * Get memory content at a specific commit
   */
  async getMemoryAtCommit(agentId: string, key: string, sha: string): Promise<string | null> {
    const git = await this.getGit(agentId);
    if (!git) return null;
    return git.show(sha, `${key}.md`);
  }

  /**
   * Load agent context (all memories combined)
   */
  async loadAgentContext(agentId: string, query = ''): Promise<string> {
    const promptContext = await this.buildPromptContext(agentId, Number.MAX_SAFE_INTEGER, query);
    const sections = [promptContext.pinnedSection, promptContext.recalledSection]
      .filter(section => section.trim().length > 0)
      .join('\n\n');

    return sections ? `# Agent Context\n\n${sections}` : '# Agent Context';
  }

  async buildPromptContext(agentId: string, availableTokenBudget: number, query: string): Promise<MemoryPromptContext> {
    const recall = await memoryIndexingService.buildAutomaticRecall(agentId, {
      query,
      availableTokenBudget,
    });

    return this.formatPromptContext(recall);
  }

  async searchMemories(agentId: string, query: string, limit?: number): Promise<{
    results: Awaited<ReturnType<typeof memoryIndexingService.searchMemories>>['results'];
    logId: string;
  }> {
    const search = await memoryIndexingService.searchMemories(agentId, { query, limit });
    return {
      results: search.results,
      logId: search.logEntry.id,
    };
  }

  async getExactMemory(agentId: string, key: string): Promise<{
    memory: Memory | null;
    retrievalMethod: 'exact';
  }> {
    return memoryIndexingService.exactGet(agentId, key);
  }

  /**
   * Initialize default memories for a new agent
   */
  async initializeAgentMemory(agentId: string, agentName: string): Promise<void> {
    const defaultMemories: CreateMemoryInput[] = [
      {
        agentId,
        key: 'system/preferences',
        value: this.getDefaultPreferences(agentName),
        category: 'preferences',
      },
      {
        agentId,
        key: 'system/history',
        value: '# History\n\nThis is a log of important events and interactions.\n\n',
        category: 'history',
      },
      {
        agentId,
        key: 'agent/context',
        value: '# Context\n\nCurrent context and ongoing tasks.\n\n',
        category: 'context',
      },
    ];

    for (const mem of defaultMemories) {
      await this.setMemory(mem);
    }
  }

  /**
   * Append to history memory
   */
  async appendHistory(agentId: string, entry: string): Promise<void> {
    const memory = await this.getMemory(agentId, 'system/history');
    const timestamp = new Date().toISOString();
    const newEntry = `\n### ${timestamp}\n\n${entry}\n`;

    const currentValue = memory?.value ?? '# History\n\n';
    const nextValue = memory ? currentValue + newEntry : buildHistoryValue(newEntry);
    const historyCapBytes = getPositiveIntegerEnv('OPENCLAW_HISTORY_CAP_BYTES', 50 * 1024);

    if (Buffer.byteLength(nextValue, 'utf-8') > historyCapBytes && memory && memory.value.trim().length > 0) {
      await this.appendHistoryArchive(agentId, memory.value);
      await this.setMemory({
        agentId,
        key: 'system/history',
        value: buildHistoryValue(newEntry),
        category: 'history',
        _commitAction: 'Append',
        _preserveConfidence: true,
      });
      return;
    }

    await this.setMemory({
      agentId,
      key: 'system/history',
      value: nextValue,
      category: 'history',
      _commitAction: 'Append',
    });
  }

  /**
   * Cleanup history archives
   */
  async cleanupHistoryArchives(agentId: string, retentionDays?: number): Promise<number> {
    const archiveDir = this.getHistoryArchiveDir(agentId);
    if (!fs.existsSync(archiveDir)) {
      return 0;
    }

    const daysToKeep = retentionDays ?? getPositiveIntegerEnv('OPENCLAW_HISTORY_RETENTION_DAYS', 30);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    let deleted = 0;
    for (const fileName of fs.readdirSync(archiveDir)) {
      const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(fileName);
      if (!match) {
        continue;
      }

      const fileDate = new Date(`${match[1]}T00:00:00.000Z`);
      if (Number.isNaN(fileDate.getTime())) {
        continue;
      }

      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(archiveDir, fileName));
        deleted += 1;
      }
    }

    return deleted;
  }

  /**
   * Update context memory
   */
  async updateContext(agentId: string, context: string): Promise<void> {
    await this.setMemory({
      agentId,
      key: 'agent/context',
      value: `# Context\n\nLast updated: ${new Date().toISOString()}\n\n${context}`,
      category: 'context',
    });
  }

  /**
   * Save memory to file
   */
  private async saveToFile(agentId: string, key: string, value: string, action: 'Create' | 'Update' | 'Append' = 'Update'): Promise<void> {
    this.ensureMemoryDir();
    const agentDir = path.join(getMemoryDir(), agentId);
    const filePath = path.join(agentDir, `${key}.md`);
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    fs.writeFileSync(filePath, value, 'utf-8');

    const git = await this.getGit(agentId);
    if (git) {
      await git.init();
      await git.add(`${key}.md`);
      await git.commit(`${action} ${key}`);
    }
  }

  /**
   * Delete memory file
   */
  private async deleteFile(agentId: string, key: string): Promise<void> {
    this.ensureMemoryDir();
    const agentDir = path.join(getMemoryDir(), agentId);
    const filePath = path.join(agentDir, `${key}.md`);
    if (!fs.existsSync(filePath)) return;

    const git = await this.getGit(agentId);
    if (git) {
      await git.init();
    }

    fs.unlinkSync(filePath);

    // Clean up empty parent directories up to (but not including) agentDir
    let dir = path.dirname(filePath);
    while (dir !== agentDir && dir.startsWith(agentDir)) {
      try {
        const entries = fs.readdirSync(dir);
        if (entries.length === 0) {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    if (git) {
      await git.add(`${key}.md`);
      await git.commit(`Delete ${key}`);
    }
  }

  /**
   * Get default preferences template
   */
  private getDefaultPreferences(agentName: string): string {
    return `# Preferences for ${agentName}

## Communication Style
- Professional and concise
- Clear and actionable responses

## Task Handling
- Prioritize urgent tasks
- Provide progress updates

## Notes
- Preferences can be updated at any time
- Add custom preferences below

`;
  }

  /**
   * Decay confidence for all non-archived memories using exponential decay.
   * Soft-deletes (archives) memories below the confidence floor.
   */
  async decayMemoryConfidence(): Promise<{ decayed: number; archived: number }> {
    const halfLifeDays = getPositiveFloatEnv('OPENCLAW_MEMORY_DECAY_HALF_LIFE_DAYS', 14);
    const floor = getPositiveFloatEnv('OPENCLAW_MEMORY_DECAY_FLOOR', 0.1);
    const now = new Date();

    const memories = await db.memory.findMany({
      where: {
        category: { not: 'archived' },
        lastReinforcedAt: { not: null },
      },
    });

    let decayed = 0;
    let archived = 0;

    for (const memory of memories) {
      if (!memory.lastReinforcedAt) continue;
      const daysSince = (now.getTime() - memory.lastReinforcedAt.getTime()) / (1000 * 60 * 60 * 24);
      const newConfidence = memory.confidence * Math.pow(0.5, daysSince / halfLifeDays);

      if (newConfidence < floor) {
        await db.memory.update({
          where: { id: memory.id },
          data: { category: 'archived', confidence: newConfidence },
        });
        archived++;
      } else {
        await db.memory.update({
          where: { id: memory.id },
          data: { confidence: newConfidence },
        });
        decayed++;
      }
    }

    return { decayed, archived };
  }

  /**
   * Map database memory to interface
   */
  private mapMemory(memory: {
    id: string;
    agentId: string;
    key: string;
    value: string;
    category: string;
    confidence: number;
    lastReinforcedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Memory {
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

  private formatPromptContext(recall: AutomaticRecallResult): MemoryPromptContext {
    const pinnedBody = recall.pinned.entries
      .map(memory => `## ${memory.key}\n\n${memory.value}`)
      .join('\n\n---\n\n');
    const recalledBody = recall.recalled.entries
      .map(memory => `## ${memory.key}\n\n${memory.value}\n\nRetrieval: ${memory.retrievalMethod} | Confidence: ${memory.confidence.toFixed(2)}`)
      .join('\n\n---\n\n');

    return {
      pinnedSection: pinnedBody ? `PINNED MEMORY (omitted: ${recall.pinned.omittedCount}):\n${pinnedBody}` : '',
      recalledSection: recalledBody ? `RECALLED MEMORY (omitted: ${recall.recalled.omittedCount}):\n${recalledBody}` : '',
      omittedCount: recall.pinned.omittedCount + recall.recalled.omittedCount,
      estimatedTokens: recall.pinned.estimatedTokens + recall.recalled.estimatedTokens,
      logId: recall.logEntry.id,
    };
  }

   private async appendHistoryArchive(agentId: string, value: string): Promise<void> {
    this.ensureMemoryDir();
    const archiveDir = this.getHistoryArchiveDir(agentId);
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const dateStr = getCurrentArchiveDate();
    const archivePath = path.join(archiveDir, `${dateStr}.md`);
    const archiveContent = fs.existsSync(archivePath)
      ? `\n\n${value}`
      : value;
    fs.appendFileSync(archivePath, archiveContent, 'utf-8');

    const git = await this.getGit(agentId);
    if (git) {
      await git.init();
      await git.add(`history/${dateStr}.md`);
      await git.commit(`Archive system/history to history/${dateStr}`);
    }
  }

   private getHistoryArchiveDir(agentId: string): string {
     return path.join(getMemoryDir(), agentId, 'history');
   }
}

export const memoryService = new MemoryService();
