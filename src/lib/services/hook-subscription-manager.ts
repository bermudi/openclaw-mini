// OpenClaw Agent Runtime - Hook Subscription Manager
// Subscribes enabled hook triggers to the event bus at startup and on runtime changes

import { db } from '@/lib/db';
import { eventBus, type EventMap } from './event-bus';
import { inputManager } from './input-manager';

class HookSubscriptionManager {
  private readonly unsubscribers = new Map<string, () => void>();

  async initialize(): Promise<number> {
    const triggers = await db.trigger.findMany({
      where: { type: 'hook', enabled: true },
    });

    for (const trigger of triggers) {
      this.subscribe(trigger.id, trigger.agentId, JSON.parse(trigger.config));
    }

    console.log(`[HookSubscriptionManager] Initialized with ${triggers.length} hook trigger(s)`);
    return triggers.length;
  }

  async subscribeHookTrigger(triggerId: string): Promise<void> {
    const trigger = await db.trigger.findUnique({ where: { id: triggerId } });
    if (!trigger || trigger.type !== 'hook' || !trigger.enabled) {
      return;
    }
    this.subscribe(trigger.id, trigger.agentId, JSON.parse(trigger.config));
  }

  unsubscribeHookTrigger(triggerId: string): void {
    const unsub = this.unsubscribers.get(triggerId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(triggerId);
    }
  }

  private subscribe(triggerId: string, agentId: string, config: { event?: string; condition?: Record<string, unknown> }): void {
    if (!config.event) {
      return;
    }

    this.unsubscribeHookTrigger(triggerId);

    const event = config.event as keyof EventMap;
    const condition = config.condition;

    const unsubscribe = eventBus.on(event, (data) => {
      const dataRecord = data as Record<string, unknown>;

      if (condition && Object.keys(condition).length > 0) {
        const matches = Object.entries(condition).every(
          ([key, value]) => dataRecord[key] === value,
        );
        if (!matches) {
          return;
        }
      }

      inputManager.processHook(
        { type: 'hook', event: config.event!, data: dataRecord },
        agentId,
      ).catch((error: unknown) => {
        console.error(`[HookSubscriptionManager] processHook failed for trigger ${triggerId}:`, error);
      });
    });

    this.unsubscribers.set(triggerId, unsubscribe);
  }
}

export const hookSubscriptionManager = new HookSubscriptionManager();
