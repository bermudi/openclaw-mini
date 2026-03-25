/// <reference types="bun-types" />

import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
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
    expect(completed?.status === 'cancelled' || completed?.status === 'failed' || completed?.status === 'completed').toBe(true);
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

  test('applies no-output timeouts to silent native PTY sessions', async () => {
    processSupervisor.setNativePtyModuleLoaderForTests(() => ({
      spawn: () => {
        const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

        return {
          pid: 0,
          cols: 120,
          rows: 30,
          process: 'fake-native-pty',
          handleFlowControl: false,
          onData: () => ({ dispose() {} }),
          onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
            exitListeners.add(listener);
            return { dispose() { exitListeners.delete(listener); } };
          },
          resize() {},
          clear() {},
          write() {},
          kill(signal?: string) {
            for (const listener of exitListeners) {
              listener({ exitCode: 1, signal: signal === 'SIGTERM' ? 15 : 9 });
            }
            exitListeners.clear();
          },
          pause() {},
          resume() {},
        };
      },
    }) as never);

    const session = await processSupervisor.spawnSession({
      agentId: 'agent-pty-no-output-native',
      launchMode: 'pty',
      bufferSize: 10000,
      sessionTimeoutMs: 5000,
      noOutputTimeoutMs: 100,
      spawn: {
        mode: 'pty',
        command: 'sleep 5',
        cols: 120,
        rows: 30,
      },
    });

    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed?.status).toBe('timed_out');
    expect(completed?.reason).toBe('no-output-timeout');
    expect(processSupervisor.getPtyBackendForSession(session.sessionId)).toBe('native');
  });

  test('applies no-output timeouts to silent fallback PTY sessions', async () => {
    const session = await processSupervisor.spawnSession({
      agentId: 'agent-pty-no-output-fallback',
      launchMode: 'pty',
      bufferSize: 10000,
      sessionTimeoutMs: 5000,
      noOutputTimeoutMs: 100,
      spawn: {
        mode: 'pty',
        command: 'sleep 5',
        cols: 120,
        rows: 30,
        forceFallback: true,
      },
    });

    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed?.status).toBe('timed_out');
    expect(completed?.reason).toBe('no-output-timeout');
    expect(processSupervisor.getPtyBackendForSession(session.sessionId)).toBe('fallback');
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

  test('kills PTY process trees and terminates spawned descendants', async () => {
    const childPidFile = path.join(tmpdir(), `openclaw-mini-pty-child-${Date.now()}.pid`);
    const command = `sleep 30 & echo $! > '${childPidFile}'; wait`;
    const session = await processSupervisor.spawnSession({
      agentId: 'agent-pty-process-tree',
      launchMode: 'pty',
      bufferSize: 10000,
      sessionTimeoutMs: 5000,
      spawn: {
        mode: 'pty',
        command,
        cols: 120,
        rows: 30,
        forceFallback: true,
      },
    });

    let childPid = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (fs.existsSync(childPidFile)) {
        childPid = Number.parseInt(fs.readFileSync(childPidFile, 'utf-8').trim(), 10);
        if (Number.isInteger(childPid) && childPid > 0) {
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(childPid).toBeGreaterThan(0);

    processSupervisor.killSession(session.sessionId);
    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed?.status === 'cancelled' || completed?.status === 'failed').toBe(true);

    const isAlive = (pid: number | undefined) => {
      if (!pid || pid <= 0) {
        return false;
      }

      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    for (let attempt = 0; attempt < 20 && (isAlive(session.pid) || isAlive(childPid)); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    expect(isAlive(session.pid)).toBe(false);
    expect(isAlive(childPid)).toBe(false);

    fs.rmSync(childPidFile, { force: true });
  });

  test('prefers the native PTY backend when it loads successfully', async () => {
    const infoMessages: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      infoMessages.push(args.map(value => String(value)).join(' '));
    };

    try {
      const session = await processSupervisor.spawnSession({
        agentId: 'agent-native-pty',
        launchMode: 'pty',
        bufferSize: 10000,
        sessionTimeoutMs: 5000,
        spawn: {
          mode: 'pty',
          command: 'printf native-pty',
          cols: 120,
          rows: 30,
        },
      });

      const completed = await processSupervisor.waitForSession(session.sessionId);
      expect(completed?.status).toBe('completed');
      expect(processSupervisor.getPtyBackendForSession(session.sessionId)).toBe('native');
      expect(infoMessages.some(message => message.includes('PTY backend selected: native'))).toBe(true);
    } finally {
      console.info = originalInfo;
    }
  });

  test('falls back to the Unix wrapper when the native PTY module cannot be loaded', async () => {
    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map(value => String(value)).join(' '));
    };

    processSupervisor.setNativePtyModuleLoaderForTests(() => {
      throw new Error("Cannot find module '@lydell/node-pty'");
    });

    try {
      const session = await processSupervisor.spawnSession({
        agentId: 'agent-fallback-load-failure',
        launchMode: 'pty',
        bufferSize: 10000,
        sessionTimeoutMs: 5000,
        spawn: {
          mode: 'pty',
          command: 'printf fallback-load-failure',
          cols: 120,
          rows: 30,
        },
      });

      const completed = await processSupervisor.waitForSession(session.sessionId);
      expect(completed?.status).toBe('completed');
      expect(completed?.stdout).toContain('fallback-load-failure');
      expect(processSupervisor.getPtyBackendForSession(session.sessionId)).toBe('fallback');
      expect(warnMessages.some(message => message.includes('Native PTY backend unavailable'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('falls back to the Unix wrapper on native ABI mismatch errors', async () => {
    processSupervisor.setNativePtyModuleLoaderForTests(() => {
      throw new Error('The module was compiled against a different Node.js version using NODE_MODULE_VERSION 123');
    });

    const session = await processSupervisor.spawnSession({
      agentId: 'agent-fallback-abi-mismatch',
      launchMode: 'pty',
      bufferSize: 10000,
      sessionTimeoutMs: 5000,
      spawn: {
        mode: 'pty',
        command: 'printf fallback-abi-mismatch',
        cols: 120,
        rows: 30,
      },
    });

    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed?.status).toBe('completed');
    expect(completed?.stdout).toContain('fallback-abi-mismatch');
    expect(processSupervisor.getPtyBackendForSession(session.sessionId)).toBe('fallback');
  });

  test('honors forced fallback mode and warns operators when native PTY is disabled', async () => {
    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map(value => String(value)).join(' '));
    };

    try {
      const session = await processSupervisor.spawnSession({
        agentId: 'agent-forced-fallback',
        launchMode: 'pty',
        bufferSize: 10000,
        sessionTimeoutMs: 5000,
        spawn: {
          mode: 'pty',
          command: 'printf forced-fallback',
          cols: 120,
          rows: 30,
          forceFallback: true,
        },
      });

      const completed = await processSupervisor.waitForSession(session.sessionId);
      expect(completed?.status).toBe('completed');
      expect(completed?.stdout).toContain('forced-fallback');
      expect(processSupervisor.getPtyBackendForSession(session.sessionId)).toBe('fallback');
      expect(warnMessages.some(message => message.includes('forcePtyFallback'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('fails clearly when no supported PTY backend is available for the host', async () => {
    processSupervisor.setPlatformForTests('win32');

    const session = await processSupervisor.spawnSession({
      agentId: 'agent-unsupported-platform',
      launchMode: 'pty',
      bufferSize: 10000,
      sessionTimeoutMs: 5000,
      spawn: {
        mode: 'pty',
        command: 'printf unsupported-platform',
        cols: 120,
        rows: 30,
      },
    });

    const completed = await processSupervisor.waitForSession(session.sessionId);
    expect(completed?.status).toBe('failed');
    expect(completed?.reason).toBe('spawn-error');
    expect(completed?.stderr).toContain('No supported PTY backend available');
  });
});
