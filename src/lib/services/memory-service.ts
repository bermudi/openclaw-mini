// OpenClaw Agent Runtime - Memory Service
// Persistent storage system using Markdown format

import { db } from '@/lib/db';
import { Memory, MemoryCategory } from '@/lib/types';
import * as fs from 'fs';
import * as path from 'path';

const MEMORY_DIR = path.join(process.cwd(), 'data', 'memories');

export interface CreateMemoryInput {
  agentId: string;
  key: string;
  value: string;
  category?: MemoryCategory;
}

export interface UpdateMemoryInput {
  value: string;
  category?: MemoryCategory;
}

class MemoryService {
  constructor() {
    // Ensure memory directory exists
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
  }

  /**
   * Create or update memory entry
   */
  async setMemory(input: CreateMemoryInput): Promise<Memory> {
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
        },
      });
    } else {
      memory = await db.memory.create({
        data: {
          agentId: input.agentId,
          key: input.key,
          value: input.value,
          category: input.category ?? 'general',
        },
      });
    }

    // Also save to file for persistence
    await this.saveToFile(input.agentId, input.key, input.value);

    return this.mapMemory(memory);
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
        ...(category && { category }),
      },
      orderBy: { updatedAt: 'desc' },
    });

    return memories.map(this.mapMemory);
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

    // Also delete file
    await this.deleteFile(agentId, key);

    return true;
  }

  /**
   * Load agent context (all memories combined)
   */
  async loadAgentContext(agentId: string): Promise<string> {
    const memories = await this.getAgentMemories(agentId);

    const sections = memories.map(memory => {
      return `## ${memory.key}\n\n${memory.value}\n\n---\n`;
    });

    return `# Agent Context\n\n${sections.join('')}`;
  }

  /**
   * Initialize default memories for a new agent
   */
  async initializeAgentMemory(agentId: string, agentName: string): Promise<void> {
    const defaultMemories: CreateMemoryInput[] = [
      {
        agentId,
        key: 'preferences',
        value: this.getDefaultPreferences(agentName),
        category: 'preferences',
      },
      {
        agentId,
        key: 'history',
        value: '# History\n\nThis is a log of important events and interactions.\n\n',
        category: 'history',
      },
      {
        agentId,
        key: 'context',
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
    const memory = await this.getMemory(agentId, 'history');
    const timestamp = new Date().toISOString();
    const newEntry = `\n### ${timestamp}\n\n${entry}\n`;

    await this.setMemory({
      agentId,
      key: 'history',
      value: memory ? memory.value + newEntry : `# History\n\n${newEntry}`,
      category: 'history',
    });
  }

  /**
   * Update context memory
   */
  async updateContext(agentId: string, context: string): Promise<void> {
    await this.setMemory({
      agentId,
      key: 'context',
      value: `# Context\n\nLast updated: ${new Date().toISOString()}\n\n${context}`,
      category: 'context',
    });
  }

  /**
   * Save memory to file
   */
  private async saveToFile(agentId: string, key: string, value: string): Promise<void> {
    const agentDir = path.join(MEMORY_DIR, agentId);
    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
    }

    const filePath = path.join(agentDir, `${key}.md`);
    fs.writeFileSync(filePath, value, 'utf-8');
  }

  /**
   * Delete memory file
   */
  private async deleteFile(agentId: string, key: string): Promise<void> {
    const filePath = path.join(MEMORY_DIR, agentId, `${key}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
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
   * Map database memory to interface
   */
  private mapMemory(memory: {
    id: string;
    agentId: string;
    key: string;
    value: string;
    category: string;
    createdAt: Date;
    updatedAt: Date;
  }): Memory {
    return {
      id: memory.id,
      agentId: memory.agentId,
      key: memory.key,
      value: memory.value,
      category: memory.category as MemoryCategory,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    };
  }
}

export const memoryService = new MemoryService();
