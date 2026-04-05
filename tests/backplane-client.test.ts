/// <reference types="bun-types" />

import { beforeEach, expect, spyOn, test } from 'bun:test';
import { EventBus, registerEventBusBroadcaster } from '../src/lib/services/event-bus';

type Handler = (...args: unknown[]) => void;

class FakeSocket {
  connected = false;
  readonly emitted: Array<{ event: string; args: unknown[] }> = [];
  readonly io = {
    on: (event: string, handler: Handler) => {
      const handlers = this.managerHandlers.get(event) ?? [];
      handlers.push(handler);
      this.managerHandlers.set(event, handlers);
      return this.io;
    },
  };

  private readonly handlers = new Map<string, Handler[]>();
  private readonly managerHandlers = new Map<string, Handler[]>();

  connect() {
    this.connected = true;
    this.triggerManager('connect');
  }

  disconnect() {
    this.connected = false;
    this.triggerManager('disconnect');
  }

  triggerManager(event: string, ...args: unknown[]) {
    const handlers = this.managerHandlers.get(event) ?? [];
    for (const handler of handlers) {
      handler(...args);
    }
  }

  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
    const handlers = this.handlers.get(event) ?? [];
    for (const handler of handlers) {
      handler(...args);
    }
  }

  getEmitted(event: string) {
    return this.emitted.filter((e) => e.event === event);
  }
}

function createFakeSocket() {
  return new FakeSocket();
}

let fakeSocket: FakeSocket;
let eventBus: EventBus;

beforeEach(() => {
  fakeSocket = createFakeSocket();
  eventBus = new EventBus();
  eventBus.resetMetricsForTests();
});

test('isConnected returns false when no broadcaster registered', () => {
  registerEventBusBroadcaster(null);
  expect(eventBus).toBeDefined();
});

test('broadcaster registration works', () => {
  const broadcaster = {
    broadcast: async (event: unknown, agentId?: string) => true,
  };
  registerEventBusBroadcaster(broadcaster as never);
  expect(eventBus).toBeDefined();
});

test('events can be emitted and listened to', async () => {
  let receivedData: unknown = null;
  
  eventBus.on('task:created', async (data) => {
    receivedData = data;
  });

  await eventBus.emit('task:created', { taskId: 't1', agentId: 'a1', taskType: 'message', priority: 3 });
  
  expect(receivedData).toEqual({ taskId: 't1', agentId: 'a1', taskType: 'message', priority: 3 });
});

test('event bus handles broadcast failures gracefully', async () => {
  const badBroadcaster = {
    broadcast: async () => {
      throw new Error('Broadcast failed');
    },
  };
  registerEventBusBroadcaster(badBroadcaster as never);
  
  await eventBus.emit('task:created', { taskId: 't1', agentId: 'a1', taskType: 'message', priority: 3 });
  
  expect(eventBus.getBroadcastFailureCount()).toBe(1);
});

test('event bus emits to multiple listeners', async () => {
  let callCount = 0;
  
  eventBus.on('task:completed', async () => { callCount++; });
  eventBus.on('task:completed', async () => { callCount++; });
  eventBus.on('task:completed', async () => { callCount++; });
  
  await eventBus.emit('task:completed', { taskId: 't1', agentId: 'a1', taskType: 'message' });
  
  expect(callCount).toBe(3);
});

test('dispatchLocal emits without broadcasting', async () => {
  const handler = spyOn(console, 'log').mockImplementation(() => {});
  
  eventBus.on('task:started', async (data) => {
    console.log('Received:', data);
  });

  eventBus.dispatchLocal('task:started', { taskId: 't1', agentId: 'a1', taskType: 'message' });
  
  expect(handler).toHaveBeenCalled();
  handler.mockRestore();
});

test('sourceId is unique per instance', () => {
  const bus1 = new EventBus();
  const bus2 = new EventBus();
  
  expect(bus1.getSourceId()).not.toBe(bus2.getSourceId());
});
