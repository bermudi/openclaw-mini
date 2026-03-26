/// <reference types="bun-types" />

import { beforeEach, expect, mock, spyOn, test } from 'bun:test';

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

  on(event: string, handler: Handler): this {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  once(event: string, handler: Handler): this {
    const wrapped: Handler = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, handler: Handler): this {
    const handlers = this.handlers.get(event) ?? [];
    this.handlers.set(event, handlers.filter((candidate) => candidate !== handler));
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    this.emitted.push({ event, args });
    return true;
  }

  connect(): this {
    this.connected = true;
    this.trigger('connect');
    return this;
  }

  disconnect(): this {
    this.connected = false;
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    this.managerHandlers.clear();
    return this;
  }

  trigger(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  triggerManager(event: string, ...args: unknown[]): void {
    for (const handler of this.managerHandlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

const ioMock = mock(() => new FakeSocket());
const dispatchLocalMock = mock(() => {});
const getSourceIdMock = mock(() => 'self-source');

mock.module('socket.io-client', () => ({
  io: ioMock,
}));

mock.module('../src/lib/services/event-bus', () => ({
  eventBus: {
    dispatchLocal: dispatchLocalMock,
    getSourceId: getSourceIdMock,
  },
}));

let BackplaneClientService: typeof import('../src/lib/services/backplane-client').BackplaneClientService;
let socket: FakeSocket;

beforeEach(async () => {
  ioMock.mockImplementation(() => {
    socket = new FakeSocket();
    return socket;
  });
  dispatchLocalMock.mockReset();
  getSourceIdMock.mockReset();
  getSourceIdMock.mockImplementation(() => 'self-source');

  ({ BackplaneClientService } = await import('../src/lib/services/backplane-client'));
});

test('start connects and subscribes to internal room', async () => {
  const client = new BackplaneClientService();

  await client.start();

  expect(client.isConnected()).toBe(true);
  expect(socket.emitted.some((entry) => entry.event === 'subscribe:internal')).toBe(true);
});

test('stop disconnects cleanly', async () => {
  const client = new BackplaneClientService();

  await client.start();
  await client.stop();

  expect(client.isConnected()).toBe(false);
});

test('forwards remote events to local dispatch without rebroadcast', async () => {
  const client = new BackplaneClientService();

  await client.start();
  socket.trigger('event', {
    type: 'task:created',
    data: { taskId: 'remote-task', agentId: 'agent-1', taskType: 'cron', priority: 6 },
    source: 'other-process',
    timestamp: new Date().toISOString(),
  });

  expect(dispatchLocalMock).toHaveBeenCalledWith('task:created', {
    taskId: 'remote-task',
    agentId: 'agent-1',
    taskType: 'cron',
    priority: 6,
  });
});

test('ignores self-originated events', async () => {
  const client = new BackplaneClientService();

  await client.start();
  socket.trigger('event', {
    type: 'task:created',
    data: { taskId: 'self-task', agentId: 'agent-1', taskType: 'message', priority: 3 },
    source: 'self-source',
    timestamp: new Date().toISOString(),
  });

  expect(dispatchLocalMock).not.toHaveBeenCalled();
});

test('reconnect logs and re-subscribes to internal room', async () => {
  const client = new BackplaneClientService();
  const infoSpy = spyOn(console, 'info').mockImplementation(() => {});

  await client.start();
  socket.triggerManager('reconnect', 2);

  const subscribeCount = socket.emitted.filter((entry) => entry.event === 'subscribe:internal').length;
  expect(subscribeCount).toBe(2);
  expect(infoSpy).toHaveBeenCalled();

  infoSpy.mockRestore();
});
