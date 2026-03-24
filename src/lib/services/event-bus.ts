// OpenClaw Agent Runtime - Event Bus
// Typed in-process pub/sub using Node.js EventEmitter

import { EventEmitter } from 'events';

export type EventMap = {
  'task:completed': { taskId: string; agentId: string; taskType: string; result?: Record<string, unknown> };
  'task:failed': { taskId: string; agentId: string; taskType: string; error: string };
  'task:created': { taskId: string; agentId: string; taskType: string; priority: number };
  'session:created': { sessionId: string; agentId: string; channel: string; channelKey: string };
  'memory:updated': { agentId: string; key: string };
  'memory:index-requested': { agentId: string; memoryId: string; key: string; reason: 'write' | 'delete' | 'reindex' };
  'subagent:completed': { taskId: string; parentTaskId: string; skillName: string; agentId: string };
  'subagent:failed': { taskId: string; parentTaskId: string; skillName: string; agentId: string; error: string };
};

type Listener<K extends keyof EventMap> = (data: EventMap[K]) => void;

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emitter.emit(event, data);
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
}

export const eventBus = new EventBus();
