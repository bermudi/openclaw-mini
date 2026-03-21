/// <reference types="bun-types" />

import { expect, test } from 'bun:test';
import { EventBus } from '../src/lib/services/event-bus';

test('emit/receive typed events', () => {
  const bus = new EventBus();
  let received: unknown = null;

  bus.on('task:completed', (data) => {
    received = data;
  });

  bus.emit('task:completed', { taskId: 't1', agentId: 'a1', taskType: 'message' });

  expect(received).toEqual({ taskId: 't1', agentId: 'a1', taskType: 'message' });
});

test('unsubscribe stops delivery', () => {
  const bus = new EventBus();
  let count = 0;

  const unsub = bus.on('task:created', () => {
    count += 1;
  });

  bus.emit('task:created', { taskId: 't1', agentId: 'a1', taskType: 'message', priority: 5 });
  expect(count).toBe(1);

  unsub();

  bus.emit('task:created', { taskId: 't2', agentId: 'a1', taskType: 'message', priority: 5 });
  expect(count).toBe(1);
});

test('multiple listeners all called', () => {
  const bus = new EventBus();
  const calls: string[] = [];

  bus.on('task:completed', () => calls.push('first'));
  bus.on('task:completed', () => calls.push('second'));

  bus.emit('task:completed', { taskId: 't1', agentId: 'a1', taskType: 'message' });

  expect(calls).toEqual(['first', 'second']);
});

test('throwing listener does not block subsequent listeners', () => {
  const bus = new EventBus();
  const calls: string[] = [];

  bus.on('task:failed', () => {
    calls.push('first');
    throw new Error('listener error');
  });
  bus.on('task:failed', () => {
    calls.push('second');
  });

  bus.emit('task:failed', { taskId: 't1', agentId: 'a1', taskType: 'message', error: 'oops' });

  expect(calls).toEqual(['first', 'second']);
});

test('emit does not throw when listener throws', () => {
  const bus = new EventBus();

  bus.on('memory:updated', () => {
    throw new Error('listener blew up');
  });

  expect(() => {
    bus.emit('memory:updated', { agentId: 'a1', key: 'system/history' });
  }).not.toThrow();
});

test('unsubscribe only removes the specific listener', () => {
  const bus = new EventBus();
  const calls: string[] = [];

  const unsub = bus.on('session:created', () => calls.push('first'));
  bus.on('session:created', () => calls.push('second'));

  unsub();

  bus.emit('session:created', { sessionId: 's1', agentId: 'a1', channel: 'telegram', channelKey: 'key1' });

  expect(calls).toEqual(['second']);
});

test('payload is passed correctly to listener', () => {
  const bus = new EventBus();
  let received: unknown = null;

  bus.on('subagent:completed', (data) => {
    received = data;
  });

  const payload = { taskId: 'sub1', parentTaskId: 'parent1', skillName: 'research', agentId: 'a1' };
  bus.emit('subagent:completed', payload);

  expect(received).toEqual(payload);
});
