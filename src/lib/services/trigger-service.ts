// OpenClaw Agent Runtime - Trigger Service
// Manage scheduled and event-based triggers

import { db } from '@/lib/db';
import { Task, Trigger, TriggerType, TriggerConfig } from '@/lib/types';
import { hookSubscriptionManager } from './hook-subscription-manager';
import { taskQueue } from './task-queue';
import {
  calculateNextTimeTrigger,
  TriggerFireError,
  TriggerValidationError,
  validateCronExpression,
} from './time-trigger';

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

export interface FireTimeBasedTriggerInput {
  mode: 'scheduled' | 'manual';
  referenceTime?: Date;
}

export interface FireTimeBasedTriggerResult {
  trigger: Trigger;
  task: Task;
}

class TriggerService {
  /**
   * Create a new trigger
   */
  async createTrigger(input: CreateTriggerInput): Promise<Trigger> {
    this.validateTriggerConfig(input.type, input.config);
    const nextTrigger = calculateNextTimeTrigger(input.type, input.config);

    const trigger = await db.trigger.create({
      data: {
        agentId: input.agentId,
        name: input.name,
        type: input.type,
        config: JSON.stringify(input.config),
        enabled: input.enabled ?? true,
        nextTrigger: nextTrigger ?? null,
      },
    });

    if (input.type === 'hook' && (input.enabled ?? true)) {
      hookSubscriptionManager.subscribeHookTrigger(trigger.id).catch((error: unknown) => {
        console.error(`[TriggerService] Failed to subscribe hook trigger ${trigger.id}:`, error);
      });
    }

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

    if (input.config) {
      this.validateTriggerConfig(trigger.type as TriggerType, input.config);
    }

    const nextTrigger = input.config
      ? calculateNextTimeTrigger(trigger.type as TriggerType, input.config)
      : undefined;

    const updated = await db.trigger.update({
      where: { id: triggerId },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.config && { 
          config: JSON.stringify(input.config),
          nextTrigger: nextTrigger ?? null,
        }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
      },
    });

    if (trigger.type === 'hook') {
      hookSubscriptionManager.unsubscribeHookTrigger(triggerId);
      if (updated.enabled) {
        hookSubscriptionManager.subscribeHookTrigger(triggerId).catch((error: unknown) => {
          console.error(`[TriggerService] Failed to re-subscribe hook trigger ${triggerId}:`, error);
        });
      }
    }

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

    if (trigger.type === 'hook') {
      hookSubscriptionManager.unsubscribeHookTrigger(triggerId);
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

    if (trigger.type === 'hook') {
      if (enabled) {
        hookSubscriptionManager.subscribeHookTrigger(triggerId).catch((error: unknown) => {
          console.error(`[TriggerService] Failed to subscribe hook trigger ${triggerId}:`, error);
        });
      } else {
        hookSubscriptionManager.unsubscribeHookTrigger(triggerId);
      }
    }

    return this.mapTrigger(updated);
  }

  async fireTimeBasedTrigger(
    triggerId: string,
    input: FireTimeBasedTriggerInput,
  ): Promise<FireTimeBasedTriggerResult> {
    const trigger = await db.trigger.findUnique({
      where: { id: triggerId },
    });

    if (!trigger) {
      throw new TriggerFireError('Trigger not found', 404);
    }

    if (!trigger.enabled) {
      throw new TriggerFireError('Trigger is disabled', 400);
    }

    if (trigger.type !== 'heartbeat' && trigger.type !== 'cron') {
      throw new TriggerFireError('Manual fire only supports heartbeat and cron triggers', 400);
    }

    const referenceTime = input.referenceTime ?? new Date();
    const triggerType = trigger.type as 'heartbeat' | 'cron';
    const parsedTrigger = this.mapTrigger(trigger);
    const payload = triggerType === 'cron'
      ? {
          triggerId,
          scheduledTime: referenceTime.toISOString(),
          timestamp: referenceTime.toISOString(),
        }
      : {
          triggerId,
          timestamp: referenceTime.toISOString(),
        };

    const task = await this.createTriggerTask({
      agentId: trigger.agentId,
      triggerType,
      triggerName: trigger.name,
      mode: input.mode,
      payload,
    });

    if (input.mode === 'scheduled') {
      const nextTrigger = calculateNextTimeTrigger(triggerType, parsedTrigger.config, referenceTime);

      if (!nextTrigger) {
        throw new TriggerFireError('Unable to calculate next trigger', 400);
      }

      const updated = await db.trigger.update({
        where: { id: triggerId },
        data: {
          lastTriggered: referenceTime,
          nextTrigger,
        },
      });

      return {
        trigger: this.mapTrigger(updated),
        task,
      };
    }

    return {
      trigger: parsedTrigger,
      task,
    };
  }

  private async createTriggerTask(input: {
    agentId: string;
    triggerType: 'heartbeat' | 'cron';
    triggerName: string;
    mode: 'scheduled' | 'manual';
    payload: Record<string, unknown>;
  }): Promise<Task> {
    return taskQueue.createTask({
      agentId: input.agentId,
      type: input.triggerType,
      priority: input.triggerType === 'cron' ? 6 : 7,
      payload: input.payload,
      source: `${input.mode === 'manual' ? 'manual:' : ''}${input.triggerType}:${input.triggerName}`,
    });
  }

  private validateTriggerConfig(type: TriggerType, config: TriggerConfig): void {
    if (type !== 'cron') {
      return;
    }

    if (!config.cronExpression?.trim()) {
      throw new TriggerValidationError('Cron triggers require a cronExpression');
    }

    validateCronExpression(config.cronExpression);
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
