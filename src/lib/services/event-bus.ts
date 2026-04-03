import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { WSBroadcastEvent } from '@/lib/ws-events';
import type { WSEventType } from '@/lib/ws-events';

export interface EventBusBroadcaster {
  broadcast(event: WSBroadcastEvent, agentId?: string): Promise<boolean>;
}

export type EventMap = {
  'task:started': { taskId: string; agentId: string; taskType: string };
  'task:completed': { taskId: string; agentId: string; taskType: string; result?: Record<string, unknown> };
  'task:failed': { taskId: string; agentId: string; taskType: string; error: string };
  'task:created': { taskId: string; agentId: string; taskType: string; priority: number };
  'trigger:fired': { triggerId: string; agentId: string; triggerType: string; taskId: string };
  'session:created': { sessionId: string; agentId: string; channel: string; channelKey: string };
  'memory:updated': { agentId: string; key: string };
  'memory:index-requested': { agentId: string; memoryId: string; key: string; reason: 'write' | 'delete' | 'reindex' };
  'subagent:completed': { taskId: string; parentTaskId: string; skillName: string; agentId: string };
  'subagent:failed': { taskId: string; parentTaskId: string; skillName: string; agentId: string; error: string };
};

type Listener<K extends keyof EventMap> = (data: EventMap[K]) => void;

let eventBusBroadcaster: EventBusBroadcaster | null = null;

export function registerEventBusBroadcaster(broadcaster: EventBusBroadcaster | null): void {
  eventBusBroadcaster = broadcaster;
}

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly sourceId = randomUUID();
  private broadcastFailureCount = 0;

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async emit<K extends keyof EventMap>(event: K, data: EventMap[K]): Promise<void> {
    this.emitter.emit(event, data);

    if (!eventBusBroadcaster) {
      return;
    }

    const ok = await eventBusBroadcaster.broadcast(
      {
        type: event as WSEventType,
        data: data as Record<string, unknown>,
        source: this.sourceId,
      },
      this.getAgentId(data),
    );

    if (!ok) {
      this.broadcastFailureCount += 1;
      console.error('[EventBus] Broadcast failed', {
        eventType: event,
        source: this.sourceId,
        errorClass: 'BroadcastFailed',
        failureCount: this.broadcastFailureCount,
      });
    }
  }

  on<K extends keyof EventMap>(event: K, listener: Listener<K>): () => void {
    const wrapped = (data: EventMap[K]) => {
      try {
        listener(data);
      } catch (error) {
        console.error(`[EventBus] Listener error for event "${event}":`, error);
      }
    };
    this.emitter.on(event, wrapped as (data: unknown) => void);
    return () => {
      this.emitter.off(event, wrapped as (data: unknown) => void);
    };
  }

  dispatchLocal<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emitter.emit(event, data);
  }

  getSourceId(): string {
    return this.sourceId;
  }

  getBroadcastFailureCount(): number {
    return this.broadcastFailureCount;
  }

  resetMetricsForTests(): void {
    this.broadcastFailureCount = 0;
    eventBusBroadcaster = null;
    this.emitter.removeAllListeners();
    this.emitter.setMaxListeners(0);
  }

  private getAgentId(data: Record<string, unknown>): string | undefined {
    return typeof data.agentId === 'string' ? data.agentId : undefined;
  }
}

export const eventBus = new EventBus();
