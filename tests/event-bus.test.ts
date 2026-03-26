/// <reference types="bun-types" />

import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { EventBus } from '../src/lib/services/event-bus';

const broadcastMock = mock(async () => true);

mock.module('../src/lib/services/ws-client', () => ({
  wsClient: {
    broadcast: broadcastMock,
  },
}));

afterEach(() => {
  broadcastMock.mockReset();
  broadcastMock.mockImplementation(async () => true);
});

test('emit/receive typed events', async () => {
  const bus = new EventBus();
  let received: unknown = null;

  bus.on('task:completed', (data) => {
    received = data;
  });

  await bus.emit('task:completed', { taskId: 't1', agentId: 'a1', taskType: 'message' });

  expect(received).toEqual({ taskId: 't1', agentId: 'a1', taskType: 'message' });
  expect(broadcastMock).toHaveBeenCalledTimes(1);
});

test('unsubscribe stops delivery', async () => {
  const bus = new EventBus();
  let count = 0;

  const unsub = bus.on('task:created', () => {
    count += 1;
  });

  await bus.emit('task:created', { taskId: 't1', agentId: 'a1', taskType: 'message', priority: 5 });
  expect(count).toBe(1);

  unsub();

  await bus.emit('task:created', { taskId: 't2', agentId: 'a1', taskType: 'message', priority: 5 });
  expect(count).toBe(1);
});

test('multiple listeners all called', async () => {
  const bus = new EventBus();
  const calls: string[] = [];

  bus.on('task:completed', () => calls.push('first'));
  bus.on('task:completed', () => calls.push('second'));

  await bus.emit('task:completed', { taskId: 't1', agentId: 'a1', taskType: 'message' });

  expect(calls).toEqual(['first', 'second']);
});

test('throwing listener does not block subsequent listeners', async () => {
  const bus = new EventBus();
  const calls: string[] = [];
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

  bus.on('task:failed', () => {
    calls.push('first');
    throw new Error('listener error');
  });
  bus.on('task:failed', () => {
    calls.push('second');
  });

  await bus.emit('task:failed', { taskId: 't1', agentId: 'a1', taskType: 'message', error: 'oops' });

  expect(calls).toEqual(['first', 'second']);
  errorSpy.mockRestore();
});

test('emit does not throw when listener throws', async () => {
  const bus = new EventBus();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

  bus.on('memory:updated', () => {
    throw new Error('listener blew up');
  });

  await expect(bus.emit('memory:updated', { agentId: 'a1', key: 'system/history' })).resolves.toBeUndefined();
  errorSpy.mockRestore();
});

test('unsubscribe only removes the specific listener', async () => {
  const bus = new EventBus();
  const calls: string[] = [];

  const unsub = bus.on('session:created', () => calls.push('first'));
  bus.on('session:created', () => calls.push('second'));

  unsub();

  await bus.emit('session:created', { sessionId: 's1', agentId: 'a1', channel: 'telegram', channelKey: 'key1' });

  expect(calls).toEqual(['second']);
});

test('payload is passed correctly to listener', async () => {
  const bus = new EventBus();
  let received: unknown = null;

  bus.on('subagent:completed', (data) => {
    received = data;
  });

  const payload = { taskId: 'sub1', parentTaskId: 'parent1', skillName: 'research', agentId: 'a1' };
  await bus.emit('subagent:completed', payload);

  expect(received).toEqual(payload);
});

test('dispatchLocal forwards without rebroadcast', () => {
  const bus = new EventBus();
  const received: Array<{ taskId: string }> = [];

  bus.on('task:created', (data) => {
    received.push({ taskId: data.taskId });
  });

  bus.dispatchLocal('task:created', { taskId: 'local-1', agentId: 'agent-1', taskType: 'message', priority: 1 });

  expect(received).toEqual([{ taskId: 'local-1' }]);
  expect(broadcastMock).not.toHaveBeenCalled();
});

test('failed broadcast increments failure counter and resolves', async () => {
  const bus = new EventBus();
  broadcastMock.mockImplementation(async () => false);
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

  await expect(bus.emit('task:created', { taskId: 't1', agentId: 'a1', taskType: 'message', priority: 5 })).resolves.toBeUndefined();
  expect(bus.getBroadcastFailureCount()).toBe(1);
  errorSpy.mockRestore();
});
