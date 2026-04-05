/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { io } from 'socket.io-client';

import { agentService } from '../src/lib/services/agent-service';
import { sessionService } from '../src/lib/services/session-service';
import { GET as getSessions } from '../src/app/api/sessions/route';
import { GET as getWorkspace, PUT as putWorkspace } from '../src/app/api/workspace/route';
import { RuntimeRealtimeServer } from '../src/lib/runtime/realtime-server';

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'dashboard-runtime-integration.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let workspaceDir = '';

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';

  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push', '--accept-data-loss'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, NO_ENV_FILE: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare dashboard test DB: ${dbPush.stderr.toString()}`);
  }

  const { recreateDbClientForTests } = await import('../src/lib/db');
  await recreateDbClientForTests();
});

beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-dashboard-runtime-'));
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';
  delete process.env.OPENCLAW_ALLOWED_ORIGINS;
});

afterEach(() => {
  delete process.env.OPENCLAW_WORKSPACE_DIR;
  delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
  delete process.env.OPENCLAW_ALLOWED_ORIGINS;

  if (workspaceDir) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  const { db } = await import('../src/lib/db');
  await db.$disconnect();
  fs.rmSync(TEST_DB_PATH, { force: true });
});

describe('dashboard runtime verification', () => {
  test('sessions endpoint returns dashboard session summary fields', async () => {
    const agent = await agentService.createAgent({ name: 'Dashboard Agent' });
    const session = await sessionService.getOrCreateSession(agent.id, 'main', 'webchat', 'dashboard-session');

    await sessionService.appendToContext(session.id, {
      role: 'user',
      content: 'hello dashboard',
      channel: 'webchat',
      channelKey: 'dashboard-session',
    });

    const response = await getSessions(
      new NextRequest(`http://localhost/api/sessions?agentId=${agent.id}`),
    );
    const body = await response.json() as {
      success: boolean;
      data: Array<{
        id: string;
        channel: string;
        channelKey: string;
        lastActive: string;
        messageCount: number;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([
      expect.objectContaining({
        id: session.id,
        channel: 'webchat',
        channelKey: 'dashboard-session',
        messageCount: 1,
      }),
    ]);
  });

  test('workspace endpoint supports dashboard load and save flow', async () => {
    const saveResponse = await putWorkspace(
      new NextRequest('http://localhost/api/workspace', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'DASHBOARD.md', content: '# Dashboard\n\nStandalone runtime test\n' }),
      }),
    );
    const saveBody = await saveResponse.json() as { success: boolean };

    expect(saveResponse.status).toBe(200);
    expect(saveBody.success).toBe(true);

    const listResponse = await getWorkspace(new NextRequest('http://localhost/api/workspace'));
    const listBody = await listResponse.json() as {
      success: boolean;
      data: Array<{ name: string; size: number }>;
    };

    expect(listResponse.status).toBe(200);
    expect(listBody.success).toBe(true);
    expect(listBody.data.map((file) => file.name)).toContain('DASHBOARD.md');

    const readResponse = await getWorkspace(
      new NextRequest('http://localhost/api/workspace?file=DASHBOARD.md'),
    );
    const readBody = await readResponse.json() as {
      success: boolean;
      data: { content: string };
    };

    expect(readResponse.status).toBe(200);
    expect(readBody.success).toBe(true);
    expect(readBody.data.content).toContain('Standalone runtime test');
  });

  test('realtime server allows dashboard origin and answers preflight', async () => {
    process.env.OPENCLAW_ALLOWED_ORIGINS = 'http://localhost:3001';

    const server = new RuntimeRealtimeServer({ port: 0, readinessProvider: () => ({ state: 'ready' }) });
    await server.start();

    try {
      const port = server.getPort();
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3001',
          'Access-Control-Request-Method': 'GET',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
      expect(response.headers.get('access-control-allow-methods')).toContain('GET');
    } finally {
      await server.stop();
    }
  });

  test('realtime server delivers operator events to a subscribed dashboard client', async () => {
    const server = new RuntimeRealtimeServer({ port: 0, readinessProvider: () => ({ state: 'ready' }) });
    await server.start();

    const socket = io(`http://127.0.0.1:${server.getPort()}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('socket connect timeout')), 5000);

        socket.on('connect', () => {
          socket.emit('subscribe:all');
        });

        socket.on('subscribed:all', () => {
          clearTimeout(timeout);
          resolve();
        });

        socket.on('connect_error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const event = await new Promise<{ type: string; data: Record<string, unknown> }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('event timeout')), 5000);

        socket.on('event', (payload) => {
          clearTimeout(timeout);
          resolve(payload as { type: string; data: Record<string, unknown> });
        });

        void server.broadcast({ type: 'task:created', data: { taskId: 'task-1' } }, 'agent-1');
      });

      expect(event.type).toBe('task:created');
      expect(event.data.taskId).toBe('task-1');
    } finally {
      socket.disconnect();
      await server.stop();
    }
  });
});
