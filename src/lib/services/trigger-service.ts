// OpenClaw Agent Runtime - Trigger Service
// Manage scheduled and event-based triggers

import { db } from '@/lib/db';
import { Trigger, TriggerType, TriggerConfig } from '@/lib/types';

export interface CreateTriggerInput {
  agentId: string;
  name: string;
  type: TriggerType;
  config: TriggerConfig;
  enabled?: boolean;
}

export interface UpdateTriggerInput {
  name?: string;
  config?: TriggerConfig;
  enabled?: boolean;
}

class TriggerService {
  /**
   * Create a new trigger
   */
  async createTrigger(input: CreateTriggerInput): Promise<Trigger> {
    const trigger = await db.trigger.create({
      data: {
        agentId: input.agentId,
        name: input.name,
        type: input.type,
        config: JSON.stringify(input.config),
        enabled: input.enabled ?? true,
        nextTrigger: this.calculateNextTrigger(input.type, input.config),
      },
    });

    return this.mapTrigger(trigger);
  }

  /**
   * Get trigger by ID
   */
  async getTrigger(triggerId: string): Promise<Trigger | null> {
    const trigger = await db.trigger.findUnique({
      where: { id: triggerId },
    });

    return trigger ? this.mapTrigger(trigger) : null;
  }

  /**
   * Get all triggers for an agent
   */
  async getTriggersByAgent(agentId: string): Promise<Trigger[]> {
    const triggers = await db.trigger.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });

    return triggers.map(this.mapTrigger);
  }

  /**
   * Get all triggers
   */
  async getAllTriggers(): Promise<Trigger[]> {
    const triggers = await db.trigger.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return triggers.map(this.mapTrigger);
  }

  /**
   * Get triggers that are due to fire
   */
  async getDueTriggers(): Promise<Trigger[]> {
    const now = new Date();
    const triggers = await db.trigger.findMany({
      where: {
        enabled: true,
        type: { in: ['heartbeat', 'cron'] },
        nextTrigger: { lte: now },
      },
    });

    return triggers.map(this.mapTrigger);
  }

  /**
   * Update trigger
   */
  async updateTrigger(triggerId: string, input: UpdateTriggerInput): Promise<Trigger | null> {
    const trigger = await db.trigger.findUnique({
      where: { id: triggerId },
    });

    if (!trigger) {
      return null;
    }

    const updated = await db.trigger.update({
      where: { id: triggerId },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.config && { 
          config: JSON.stringify(input.config),
          nextTrigger: this.calculateNextTrigger(trigger.type as TriggerType, input.config),
        }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
      },
    });

    return this.mapTrigger(updated);
  }

  /**
   * Delete trigger
   */
  async deleteTrigger(triggerId: string): Promise<boolean> {
    const trigger = await db.trigger.findUnique({
      where: { id: triggerId },
    });

    if (!trigger) {
      return false;
    }

    await db.trigger.delete({
      where: { id: triggerId },
    });

    return true;
  }

  /**
   * Enable/disable trigger
   */
  async setTriggerEnabled(triggerId: string, enabled: boolean): Promise<Trigger | null> {
    const trigger = await db.trigger.findUnique({
      where: { id: triggerId },
    });

    if (!trigger) {
      return null;
    }

    const updated = await db.trigger.update({
      where: { id: triggerId },
      data: { enabled },
    });

    return this.mapTrigger(updated);
  }

  /**
   * Calculate next trigger time based on type and config
   */
  private calculateNextTrigger(type: TriggerType, config: TriggerConfig): Date {
    const next = new Date();

    switch (type) {
      case 'heartbeat':
        next.setMinutes(next.getMinutes() + (config.interval ?? 30));
        break;
      case 'cron':
        // Simplified: next day at same time for MVP
        next.setDate(next.getDate() + 1);
        break;
      case 'webhook':
      case 'hook':
        // These are event-driven, no next trigger
        return next;
    }

    return next;
  }

  /**
   * Map database trigger to interface
   */
  private mapTrigger(trigger: {
    id: string;
    agentId: string;
    name: string;
    type: string;
    config: string;
    enabled: boolean;
    lastTriggered: Date | null;
    nextTrigger: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Trigger {
    return {
      id: trigger.id,
      agentId: trigger.agentId,
      name: trigger.name,
      type: trigger.type as TriggerType,
      config: JSON.parse(trigger.config),
      enabled: trigger.enabled,
      lastTriggered: trigger.lastTriggered ?? undefined,
      nextTrigger: trigger.nextTrigger ?? undefined,
      createdAt: trigger.createdAt,
      updatedAt: trigger.updatedAt,
    };
  }
}

export const triggerService = new TriggerService();
