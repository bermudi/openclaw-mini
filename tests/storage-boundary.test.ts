/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import {
  StorageValidationError,
  parseTaskPayload,
  serializeTaskPayload,
  parseTaskResult,
  serializeTaskResult,
  parseAsyncTaskRegistry,
  serializeAsyncTaskRegistry,
  parseTriggerConfig,
  serializeTriggerConfig,
  parseAgentSkills,
  serializeAgentSkills,
  type AsyncTaskRecordValidated,
} from '../src/lib/storage-boundary';

// ─── Task payload ────────────────────────────────────────────────────────────

describe('Task.payload', () => {
  test('accepts valid JSON object', () => {
    const raw = JSON.stringify({ content: 'hello', channel: 'slack' });
    const result = parseTaskPayload(raw);
    expect(result).toEqual({ content: 'hello', channel: 'slack' });
  });

  test('accepts empty object', () => {
    expect(parseTaskPayload('{}')).toEqual({});
  });

  test('throws StorageValidationError on malformed JSON', () => {
    expect(() => parseTaskPayload('not-json')).toThrow(StorageValidationError);
  });

  test('throws StorageValidationError when value is not an object', () => {
    expect(() => parseTaskPayload('"a string"')).toThrow(StorageValidationError);
    expect(() => parseTaskPayload('42')).toThrow(StorageValidationError);
    expect(() => parseTaskPayload('["array"]')).toThrow(StorageValidationError);
  });

  test('serializeTaskPayload round-trips correctly', () => {
    const payload = { type: 'message', text: 'hi', count: 3 };
    const raw = serializeTaskPayload(payload);
    expect(parseTaskPayload(raw)).toEqual(payload);
  });

  test('serializeTaskPayload rejects non-objects', () => {
    expect(() => serializeTaskPayload('not-an-object' as unknown as Record<string, unknown>)).toThrow(StorageValidationError);
  });
});

// ─── Task result ─────────────────────────────────────────────────────────────

describe('Task.result', () => {
  test('accepts valid JSON object', () => {
    const raw = JSON.stringify({ success: true, items: [] });
    expect(parseTaskResult(raw)).toEqual({ success: true, items: [] });
  });

  test('throws StorageValidationError on malformed JSON', () => {
    expect(() => parseTaskResult('{bad')).toThrow(StorageValidationError);
  });

  test('throws StorageValidationError when value is not an object', () => {
    expect(() => parseTaskResult('"string"')).toThrow(StorageValidationError);
  });

  test('serializeTaskResult round-trips correctly', () => {
    const result = { status: 'done', count: 1 };
    expect(parseTaskResult(serializeTaskResult(result))).toEqual(result);
  });
});

// ─── AsyncTaskRegistry ───────────────────────────────────────────────────────

describe('Session.asyncTaskRegistry', () => {
  const validRecord: AsyncTaskRecordValidated = {
    taskId: 'task-123',
    skill: 'researcher',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  test('accepts valid registry JSON', () => {
    const raw = JSON.stringify({ 'task-123': validRecord });
    const map = parseAsyncTaskRegistry(raw);
    expect(map.get('task-123')).toEqual(validRecord);
  });

  test('accepts empty registry', () => {
    expect(parseAsyncTaskRegistry('{}').size).toBe(0);
  });

  test('throws StorageValidationError on malformed JSON', () => {
    expect(() => parseAsyncTaskRegistry('{bad')).toThrow(StorageValidationError);
  });

  test('throws StorageValidationError when record is missing required fields', () => {
    const bad = JSON.stringify({ 'task-1': { taskId: 'task-1' } });
    expect(() => parseAsyncTaskRegistry(bad)).toThrow(StorageValidationError);
  });

  test('throws StorageValidationError when status is not a valid enum value', () => {
    const bad = JSON.stringify({ 'task-1': { ...validRecord, status: 'unknown-status' } });
    expect(() => parseAsyncTaskRegistry(bad)).toThrow(StorageValidationError);
  });

  test('serializeAsyncTaskRegistry round-trips correctly', () => {
    const registry = new Map<string, AsyncTaskRecordValidated>([['task-123', validRecord]]);
    const raw = serializeAsyncTaskRegistry(registry);
    const restored = parseAsyncTaskRegistry(raw);
    expect(restored.get('task-123')).toEqual(validRecord);
  });
});

// ─── TriggerConfig ───────────────────────────────────────────────────────────

describe('Trigger.config', () => {
  test('accepts valid cron config', () => {
    const raw = JSON.stringify({ cronExpression: '0 9 * * 1-5', timezone: 'UTC' });
    const result = parseTriggerConfig(raw);
    expect(result.cronExpression).toBe('0 9 * * 1-5');
    expect(result.timezone).toBe('UTC');
  });

  test('accepts valid heartbeat config', () => {
    const raw = JSON.stringify({ interval: 30 });
    expect(parseTriggerConfig(raw).interval).toBe(30);
  });

  test('accepts empty config', () => {
    expect(parseTriggerConfig('{}')).toEqual({});
  });

  test('throws StorageValidationError on malformed JSON', () => {
    expect(() => parseTriggerConfig('not-json')).toThrow(StorageValidationError);
  });

  test('throws StorageValidationError when interval is not a positive integer', () => {
    expect(() => parseTriggerConfig('{"interval": -5}')).toThrow(StorageValidationError);
    expect(() => parseTriggerConfig('{"interval": 0}')).toThrow(StorageValidationError);
  });

  test('serializeTriggerConfig round-trips correctly', () => {
    const config = { cronExpression: '*/5 * * * *', timezone: 'America/Chicago' };
    const raw = serializeTriggerConfig(config);
    const result = parseTriggerConfig(raw);
    expect(result.cronExpression).toBe('*/5 * * * *');
    expect(result.timezone).toBe('America/Chicago');
  });
});

// ─── Agent.skills ────────────────────────────────────────────────────────────

describe('Agent.skills', () => {
  test('accepts valid string array', () => {
    const raw = JSON.stringify(['researcher', 'coder', 'planner']);
    expect(parseAgentSkills(raw)).toEqual(['researcher', 'coder', 'planner']);
  });

  test('accepts empty array', () => {
    expect(parseAgentSkills('[]')).toEqual([]);
  });

  test('throws StorageValidationError on malformed JSON', () => {
    expect(() => parseAgentSkills('not-json')).toThrow(StorageValidationError);
  });

  test('throws StorageValidationError when value is not an array', () => {
    expect(() => parseAgentSkills('{"researcher": true}')).toThrow(StorageValidationError);
    expect(() => parseAgentSkills('"researcher"')).toThrow(StorageValidationError);
  });

  test('throws StorageValidationError when array contains non-string elements', () => {
    expect(() => parseAgentSkills('[1, 2, 3]')).toThrow(StorageValidationError);
    expect(() => parseAgentSkills('["ok", null]')).toThrow(StorageValidationError);
  });

  test('serializeAgentSkills round-trips correctly', () => {
    const skills = ['browser', 'researcher'];
    expect(parseAgentSkills(serializeAgentSkills(skills))).toEqual(skills);
  });
});
