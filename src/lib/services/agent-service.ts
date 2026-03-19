// OpenClaw Agent Runtime - Agent Service
// Agent management and status tracking

import { Prisma, type Agent as DbAgent } from '@prisma/client';
import { db } from '@/lib/db';
import { Agent, AgentStatus } from '@/lib/types';

export interface CreateAgentInput {
  name: string;
  description?: string;
  skills?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  status?: AgentStatus;
  skills?: string[];
}

class AgentService {
  /**
   * Create a new agent
   */
  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const agent = await db.$transaction(async (tx) => {
      const defaultAgent = await tx.agent.findFirst({
        where: { isDefault: true },
        select: { id: true },
      });

      return tx.agent.create({
        data: {
          name: input.name,
          description: input.description,
          skills: JSON.stringify(input.skills ?? []),
          status: 'idle',
          isDefault: !defaultAgent,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.mapAgent(agent);
  }

  /**
   * Get the default agent
   */
  async getDefaultAgent(): Promise<Agent | null> {
    const agent = await db.agent.findFirst({
      where: { isDefault: true },
    });

    return agent ? this.mapAgent(agent) : null;
  }

  /**
   * Set an agent as the default (exactly one default)
   */
  async setDefaultAgent(agentId: string): Promise<Agent | null> {
    return db.$transaction(async (tx) => {
      const agent = await tx.agent.findUnique({
        where: { id: agentId },
      });

      if (!agent) {
        return null;
      }

      await tx.agent.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });

      const updated = await tx.agent.update({
        where: { id: agentId },
        data: { isDefault: true },
      });

      return this.mapAgent(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<Agent | null> {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
    });

    return agent ? this.mapAgent(agent) : null;
  }

  /**
   * Get all agents
   */
  async getAgents(): Promise<Agent[]> {
    const agents = await db.agent.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return agents.map(this.mapAgent);
  }

  /**
   * Update agent
   */
  async updateAgent(agentId: string, input: UpdateAgentInput): Promise<Agent | null> {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return null;
    }

    const updated = await db.agent.update({
      where: { id: agentId },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status && { status: input.status }),
        ...(input.skills && { skills: JSON.stringify(input.skills) }),
      },
    });

    return this.mapAgent(updated);
  }

  /**
   * Delete agent and all related data
   */
  async deleteAgent(agentId: string): Promise<boolean> {
    return db.$transaction(async (tx) => {
      const agent = await tx.agent.findUnique({
        where: { id: agentId },
      });

      if (!agent) {
        return false;
      }

      await tx.agent.delete({
        where: { id: agentId },
      });

      if (agent.isDefault) {
        const replacement = await tx.agent.findFirst({
          orderBy: { createdAt: 'desc' },
        });

        if (replacement) {
          await tx.agent.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
          await tx.agent.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }

      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Set agent status
   */
  async setAgentStatus(agentId: string, status: AgentStatus): Promise<Agent | null> {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return null;
    }

    const updated = await db.agent.update({
      where: { id: agentId },
      data: { status },
    });

    return this.mapAgent(updated);
  }

  /**
   * Get agent with stats
   */
  async getAgentWithStats(agentId: string): Promise<{
    agent: Agent;
    taskCounts: { pending: number; processing: number; completed: number; failed: number };
  } | null> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      return null;
    }

    const [pending, processing, completed, failed] = await Promise.all([
      db.task.count({ where: { agentId, status: 'pending' } }),
      db.task.count({ where: { agentId, status: 'processing' } }),
      db.task.count({ where: { agentId, status: 'completed' } }),
      db.task.count({ where: { agentId, status: 'failed' } }),
    ]);

    return {
      agent,
      taskCounts: { pending, processing, completed, failed },
    };
  }

  /**
   * Map database agent to interface
   */
  private mapAgent(agent: DbAgent): Agent {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description ?? undefined,
      status: agent.status as AgentStatus,
      skills: JSON.parse(agent.skills),
      isDefault: Boolean(agent.isDefault),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }
}

export const agentService = new AgentService();
