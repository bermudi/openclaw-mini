/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test';
import { processSupervisor } from '../src/lib/services/process-supervisor';

afterEach(() => {
  processSupervisor.resetForTests();
});

describe('process supervisor', () => {
  test('creates sessions and captures child-process output', async () => {
    const session = await processSupervisor.spawnSession({
      agentId: 'agent-child',
      launchMode: 'child',
      bufferSize: 10000,
      sessionTimeoutMs: 5000,
      spawn: {
        mode: 'child',
        argv: [process.execPath, '-e', "console.log('child output');"],
        stdinMode: 'pipe-closed',
      },
    });

    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed).not.toBeNull();
    expect(completed?.status).toBe('completed');
    expect(completed?.stdout).toContain('child output');

    const listed = processSupervisor.listSessions('agent-child');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.sessionId).toBe(session.sessionId);
  });

  test('supports PTY input and output through the session API', async () => {
    const session = await processSupervisor.spawnSession({
      agentId: 'agent-pty',
      launchMode: 'pty',
      bufferSize: 10000,
      sessionTimeoutMs: 5000,
      spawn: {
        mode: 'pty',
        command: 'cat',
        cols: 120,
        rows: 30,
      },
    });

    processSupervisor.writeSession(session.sessionId, 'hello from pty\n');

    let output = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const polled = processSupervisor.pollSession(session.sessionId, 0, 4000);
      output = polled.output;
      if (output.includes('hello from pty')) {
        break;
      }
    }

    expect(output).toContain('hello from pty');

    processSupervisor.killSession(session.sessionId);
    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed?.status === 'cancelled' || completed?.status === 'failed').toBe(true);
  });

  test('marks timed out sessions when they exceed the configured timeout', async () => {
    const session = await processSupervisor.spawnSession({
      agentId: 'agent-timeout',
      launchMode: 'child',
      bufferSize: 10000,
      sessionTimeoutMs: 100,
      spawn: {
        mode: 'child',
        argv: [process.execPath, '-e', 'setTimeout(() => {}, 5000);'],
        stdinMode: 'pipe-closed',
      },
    });

    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed?.status).toBe('timed_out');
    expect(completed?.reason).toBe('overall-timeout');
  });

  test('returns clear errors for missing sessions', () => {
    expect(() => processSupervisor.pollSession('missing-session-id')).toThrow('Process session not found');
    expect(() => processSupervisor.writeSession('missing-session-id', 'hello')).toThrow('Process session not found');
  });

  test('truncates buffered output while preserving offset and log semantics', async () => {
    const session = await processSupervisor.spawnSession({
      agentId: 'agent-buffer',
      launchMode: 'child',
      bufferSize: 120,
      sessionTimeoutMs: 5000,
      spawn: {
        mode: 'child',
        argv: [process.execPath, '-e', "process.stdout.write('A'.repeat(400));"],
        stdinMode: 'pipe-closed',
      },
    });

    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed?.status).toBe('completed');

    const firstWindow = processSupervisor.readSessionLog(session.sessionId, 0, 120);
    expect(firstWindow.truncatedBeforeOffset).toBe(true);
    expect(firstWindow.droppedOutputChars).toBeGreaterThan(0);
    expect(firstWindow.totalOutputChars).toBe(400);
    expect(firstWindow.output.length).toBeLessThanOrEqual(120);
    expect(firstWindow.nextOffset).toBe(firstWindow.droppedOutputChars + firstWindow.output.length);

    const tailWindow = processSupervisor.readSessionLog(session.sessionId, firstWindow.droppedOutputChars, 40);
    expect(tailWindow.truncatedBeforeOffset).toBe(false);
    expect(tailWindow.output).toBe(firstWindow.output.slice(0, 40));
  });
});
