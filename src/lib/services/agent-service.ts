// OpenClaw Agent Runtime - Agent Service
// Agent management and status tracking

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
    const agent = await db.agent.create({
      data: {
        name: input.name,
        description: input.description,
        skills: JSON.stringify(input.skills ?? []),
        status: 'idle',
      },
    });

    return this.mapAgent(agent);
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
    const agent = await db.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return false;
    }

    await db.agent.delete({
      where: { id: agentId },
    });

    return true;
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
  private mapAgent(agent: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    skills: string;
    createdAt: Date;
    updatedAt: Date;
  }): Agent {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description ?? undefined,
      status: agent.status as AgentStatus,
      skills: JSON.parse(agent.skills),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }
}

export const agentService = new AgentService();
