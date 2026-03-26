/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createHmac } from 'crypto';
import fs from 'fs';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

mock.module('ai', () => ({
  generateText: async () => ({ text: 'stub response', steps: [] }),
  stepCountIs: () => () => true,
}));

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'api-auth-hardening.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = path.join(tmpdir(), 'openclaw-mini-api-auth-memories');
const AUTH_TOKEN = 'super-secret-bearer-token';

let db: PrismaClient;
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

let agentRoute: typeof import('../src/app/api/agents/route');
let tasksRoute: typeof import('../src/app/api/tasks/route');
let taskExecuteRoute: typeof import('../src/app/api/tasks/[id]/execute/route');
let sessionsRoute: typeof import('../src/app/api/sessions/route');
let auditRoute: typeof import('../src/app/api/audit/route');
let skillsRoute: typeof import('../src/app/api/skills/route');
let workspaceRoute: typeof import('../src/app/api/workspace/route');
let toolsRoute: typeof import('../src/app/api/tools/route');
let triggerManualFireRoute: typeof import('../src/app/api/triggers/[id]/fire/route');
let schedulerModule: typeof import('../mini-services/scheduler/index');
let wsModule: typeof import('../mini-services/openclaw-ws/index');
let agentService: typeof import('../src/lib/services/agent-service').agentService;
let taskQueue: typeof import('../src/lib/services/task-queue').taskQueue;
let sessionService: typeof import('../src/lib/services/session-service').sessionService;
let initialize: typeof import('../src/lib/init').initialize;
let resetInitForTests: typeof import('../src/lib/init').resetInitForTests;
let initializeProviderRegistry: typeof import('../src/lib/services/provider-registry').initializeProviderRegistry;
let resetProviderRegistryForTests: typeof import('../src/lib/services/provider-registry').resetProviderRegistryForTests;
let buildInternalAuthHeaders: typeof import('../src/lib/internal-auth').buildInternalAuthHeaders;
let getInternalAuthStartupStatus: typeof import('../src/lib/internal-auth').getInternalAuthStartupStatus;
let resetInternalAuthWarningsForTests: typeof import('../src/lib/internal-auth').resetInternalAuthWarningsForTests;
let verifyWebhook: typeof import('../src/lib/webhook-security').verifyWebhook;

async function resetDb(): Promise<void> {
  await db.sessionMessage.deleteMany();
  await db.task.deleteMany();
  await db.session.deleteMany();
  await db.channelBinding.deleteMany();
  await db.trigger.deleteMany();
  await db.webhookLog.deleteMany();
  await db.memory.deleteMany();
  await db.auditLog.deleteMany();
  await db.agent.deleteMany();
}

function authHeaders(extra?: HeadersInit): Headers {
  return buildInternalAuthHeaders(extra);
}

function bearerRequest(url: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(url, {
    method: init.method,
    body: init.body,
    cache: init.cache,
    credentials: init.credentials,
    integrity: init.integrity,
    keepalive: init.keepalive,
    mode: init.mode,
    redirect: init.redirect,
    referrer: init.referrer,
    referrerPolicy: init.referrerPolicy,
    headers: authHeaders(init.headers),
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  process.env.OPENCLAW_API_KEY = AUTH_TOKEN;
  delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
  process.env.OPENCLAW_MEMORY_DIR = MEMORY_ROOT;

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-api-auth-hardening-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;

  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  fs.mkdirSync(MEMORY_ROOT, { recursive: true });

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare api-auth-hardening test DB: ${dbPush.stderr.toString()}`);
  }

  db = (await import('../src/lib/db')).db;
  ({ agentService } = await import('../src/lib/services/agent-service'));
  ({ taskQueue } = await import('../src/lib/services/task-queue'));
  ({ sessionService } = await import('../src/lib/services/session-service'));
  ({ initialize, resetInitForTests } = await import('../src/lib/init'));
  ({ initializeProviderRegistry, resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry'));
  ({ buildInternalAuthHeaders, getInternalAuthStartupStatus, resetInternalAuthWarningsForTests } = await import('../src/lib/internal-auth'));
  ({ verifyWebhook } = await import('../src/lib/webhook-security'));

  agentRoute = await import('../src/app/api/agents/route');
  tasksRoute = await import('../src/app/api/tasks/route');
  taskExecuteRoute = await import('../src/app/api/tasks/[id]/execute/route');
  sessionsRoute = await import('../src/app/api/sessions/route');
  auditRoute = await import('../src/app/api/audit/route');
  skillsRoute = await import('../src/app/api/skills/route');
  workspaceRoute = await import('../src/app/api/workspace/route');
  toolsRoute = await import('../src/app/api/tools/route');
  triggerManualFireRoute = await import('../src/app/api/triggers/[id]/fire/route');
  schedulerModule = await import('../mini-services/scheduler/index');
  wsModule = await import('../mini-services/openclaw-ws/index');

  await resetDb();
});

beforeEach(async () => {
  process.env.OPENCLAW_API_KEY = AUTH_TOKEN;
  delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
  resetProviderRegistryForTests();
  initializeProviderRegistry();
  resetInternalAuthWarningsForTests();
  resetInitForTests();
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
  resetProviderRegistryForTests();
  delete process.env.OPENCLAW_API_KEY;
  delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
  delete process.env.OPENCLAW_MEMORY_DIR;

  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }

  if (fs.existsSync(MEMORY_ROOT)) {
    fs.rmSync(MEMORY_ROOT, { recursive: true, force: true });
  }
});

describe('admin API auth enforcement', () => {
  test('returns 401 for missing token on protected routes', async () => {
    const agent = await agentService.createAgent({ name: 'Auth Agent' });

    const task = await taskQueue.createTask({
      agentId: agent.id,
      type: 'message',
      payload: { text: 'run me' },
    });

    const session = await sessionService.getOrCreateSession(agent.id, 'main', 'webchat', 'secure-session');
    await sessionService.appendToContext(session.id, { role: 'user', content: 'hello' });

    const responses = await Promise.all([
      agentRoute.GET(new NextRequest('http://localhost/api/agents')),
      tasksRoute.GET(new NextRequest('http://localhost/api/tasks')),
      tasksRoute.POST(new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, type: 'message', payload: { text: 'queued' } }),
      })),
      taskExecuteRoute.POST(new NextRequest(`http://localhost/api/tasks/${task.id}/execute`, { method: 'POST' }), {
        params: Promise.resolve({ id: task.id }),
      }),
      sessionsRoute.GET(new NextRequest(`http://localhost/api/sessions?agentId=${agent.id}`)),
      auditRoute.GET(new NextRequest('http://localhost/api/audit')),
      skillsRoute.GET(new NextRequest('http://localhost/api/skills')),
      workspaceRoute.GET(new NextRequest('http://localhost/api/workspace')),
      toolsRoute.GET(new NextRequest('http://localhost/api/tools')),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      const body = await response.json() as { success?: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    }
  });

  test('returns 401 for invalid token and logs failure context without leaking the token', async () => {
    const warnSpy = spyOn(console, 'warn');

    const response = await agentRoute.GET(new NextRequest('http://localhost/api/agents', {
      headers: { authorization: 'Bearer wrong-token' },
    }));
    const body = await response.json() as { error?: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');

    const auditLog = await db.auditLog.findFirst({
      where: { action: 'auth_failed', entityId: '/api/agents' },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditLog).not.toBeNull();

    const details = JSON.parse(auditLog?.details ?? '{}') as Record<string, unknown>;
    expect(details.route).toBe('/api/agents');
    expect(details.reason).toBe('invalid_token');
    expect(details.service).toBe('nextjs');
    expect(warnSpy.mock.calls.some(call => String(call[0]).includes('/api/agents'))).toBe(true);
    expect(warnSpy.mock.calls.some(call => String(call[0]).includes('wrong-token'))).toBe(false);

    warnSpy.mockRestore();
  });

  test('allows valid bearer token on representative protected routes', async () => {
    const agent = await agentService.createAgent({ name: 'Secure Agent' });
    const session = await sessionService.getOrCreateSession(agent.id, 'main', 'webchat', 'session-1');
    await sessionService.appendToContext(session.id, { role: 'user', content: 'hello' });

    const [agentsResponse, tasksResponse, sessionsResponse, skillsResponse, workspaceResponse, toolsResponse] = await Promise.all([
      agentRoute.GET(bearerRequest('http://localhost/api/agents')),
      tasksRoute.POST(bearerRequest('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, type: 'message', payload: { text: 'queued' } }),
      })),
      sessionsRoute.GET(bearerRequest(`http://localhost/api/sessions?agentId=${agent.id}`)),
      skillsRoute.GET(bearerRequest('http://localhost/api/skills')),
      workspaceRoute.GET(bearerRequest('http://localhost/api/workspace')),
      toolsRoute.GET(bearerRequest('http://localhost/api/tools')),
    ]);

    expect(agentsResponse.status).toBe(200);
    expect(tasksResponse.status).toBe(200);
    expect(sessionsResponse.status).toBe(200);
    expect(skillsResponse.status).toBe(200);
    expect(workspaceResponse.status).toBe(200);
    expect(toolsResponse.status).toBe(200);
  });
});

describe('service-to-service and websocket auth', () => {
  test('scheduler adds bearer auth to task execution requests', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await schedulerModule.executeTaskViaApi('task-123');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const headers = new Headers(init?.headers);
    expect(url).toContain('/api/tasks/');
    expect(url).toContain('/execute');
    expect(headers.get('authorization')).toBe(`Bearer ${AUTH_TOKEN}`);
    expect(headers.get('content-type')).toBe('application/json');

    fetchSpy.mockRestore();
  });

  test('scheduler creates trigger tasks via authenticated task API', async () => {
    const fetchSpy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: 'task-456' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await schedulerModule.createTaskViaApi({
      agentId: 'agent-123',
      type: 'heartbeat',
      priority: 7,
      payload: { triggerId: 'trigger-1', timestamp: '2026-03-25T00:00:00.000Z' },
      source: 'heartbeat:test',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const headers = new Headers(init?.headers);
    expect(url).toContain('/api/tasks');
    expect(headers.get('authorization')).toBe(`Bearer ${AUTH_TOKEN}`);
    expect(headers.get('content-type')).toBe('application/json');

    fetchSpy.mockRestore();
  });

  test('manual trigger fire requires auth and rejects unsupported trigger types', async () => {
    const agent = await agentService.createAgent({ name: 'Manual Fire Agent' });
    const webhookTrigger = await db.trigger.create({
      data: {
        agentId: agent.id,
        name: 'webhook-trigger',
        type: 'webhook',
        config: JSON.stringify({ endpoint: '/hook' }),
      },
    });

    const unauthorizedResponse = await triggerManualFireRoute.POST(
      new NextRequest(`http://localhost/api/triggers/${webhookTrigger.id}/fire`, { method: 'POST' }),
      { params: Promise.resolve({ id: webhookTrigger.id }) },
    );
    expect(unauthorizedResponse.status).toBe(401);

    const unsupportedResponse = await triggerManualFireRoute.POST(
      bearerRequest(`http://localhost/api/triggers/${webhookTrigger.id}/fire`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: webhookTrigger.id }) },
    );
    const unsupportedBody = await unsupportedResponse.json() as { success?: boolean; error?: string };

    expect(unsupportedResponse.status).toBe(400);
    expect(unsupportedBody.success).toBe(false);
    expect(unsupportedBody.error).toContain('heartbeat and cron triggers');
  });

  test('websocket /broadcast rejects missing token and accepts valid bearer token', async () => {
    delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
    const emittedEvents: Array<{ room: string | null; name: string; payload: unknown }> = [];
    const ioStub = {
      to(room: string) {
        return {
          emit(name: string, payload: unknown) {
            emittedEvents.push({ room, name, payload });
          },
        };
      },
      emit(name: string, payload: unknown) {
        emittedEvents.push({ room: null, name, payload });
      },
      sockets: {
        sockets: { size: 0 },
        adapter: { rooms: new Map<string, Set<string>>() },
      },
    } as unknown as Parameters<typeof wsModule.createWsHttpHandler>[0];

    const server = createServer(wsModule.createWsHttpHandler(ioStub));
    server.keepAliveTimeout = 1;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const unauthorizedResponse = await fetch(`${baseUrl}/broadcast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify({ event: { type: 'stats:update', data: { ok: true } } }),
      });

      expect(unauthorizedResponse.status).toBe(401);
      expect(emittedEvents).toHaveLength(0);

      const authorizedResponse = await fetch(`${baseUrl}/broadcast`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json', connection: 'close' }),
        body: JSON.stringify({
          agentId: 'agent-123',
          event: { type: 'task:completed', data: { done: true } },
        }),
      });
      const authorizedBody = await authorizedResponse.json() as { success?: boolean };

      expect(authorizedResponse.status).toBe(200);
      expect(authorizedBody.success).toBe(true);
      expect(emittedEvents.some(event => event.room === 'agent:agent-123' && event.name === 'event')).toBe(true);
      expect(emittedEvents.some(event => event.room === 'admin' && event.name === 'event')).toBe(true);

      const auditLog = await db.auditLog.findFirst({
        where: { action: 'auth_failed', entityId: '/broadcast' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditLog).not.toBeNull();
    } finally {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});

describe('startup validation and webhook signature separation', () => {
  test('startup fails without auth token when insecure-local mode is disabled', async () => {
    delete process.env.OPENCLAW_API_KEY;
    delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
    resetInitForTests();

    const result = await initialize();

    expect(result.success).toBe(false);
    expect(result.hardFailures.some(failure => failure.type === 'internal-auth')).toBe(true);
  });

  test('startup allows insecure local mode with a warning', async () => {
    delete process.env.OPENCLAW_API_KEY;
    process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';
    resetInitForTests();

    const result = await initialize();

    expect(result.success).toBe(true);
    expect(result.softWarnings.some(warning => warning.type === 'internal-auth')).toBe(true);
    expect(getInternalAuthStartupStatus().warning).toContain('local testing');
  });

  test('webhook signature verification remains separate from internal bearer auth', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const secret = 'github-webhook-secret';
    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;

    const result = verifyWebhook('github', payload, { 'x-hub-signature-256': signature }, secret);

    expect(result.valid).toBe(true);
  });
});
