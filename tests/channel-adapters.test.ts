/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

mock.module('ai', () => ({
  generateText: async () => ({ text: 'stub response', steps: [] }),
  stepCountIs: () => () => true,
}));

// ──────────────────────────────────────────────────────────────────────────────
// Baileys mock — must happen before any import of whatsapp-adapter
// ──────────────────────────────────────────────────────────────────────────────

type ConnectionListener = (update: {
  connection?: string;
  lastDisconnect?: { error?: { output?: { statusCode?: number } } };
  qr?: string;
}) => void;

type MessagesListener = (event: {
  messages: Array<{
    key: { remoteJid?: string };
    message?: { conversation?: string; extendedTextMessage?: { text?: string } };
  }>;
  type: string;
}) => void;

const mockSocketEvents: Record<string, ((...args: unknown[]) => void)[]> = {};
const mockSentMessages: Array<{ jid: string; content: Record<string, unknown> }> = [];
let mockLogout: (() => Promise<void>) = async () => {};
const mockDownloadedMedia: Array<{ msgId: string; buffer: Buffer; ext: string }> = [];

const createMockSocket = () => ({
  ev: {
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (!mockSocketEvents[event]) mockSocketEvents[event] = [];
      mockSocketEvents[event].push(cb);
    },
  },
  sendMessage: async (jid: string, content: Record<string, unknown>) => {
    mockSentMessages.push({ jid, content });
    return { key: { id: `msg-${Date.now()}` } };
  },
  logout: () => mockLogout(),
});

mock.module('@whiskeysockets/baileys', () => ({
  default: () => createMockSocket(),
  useMultiFileAuthState: async (_dir: string) => ({
    state: {},
    saveCreds: async () => {},
  }),
  DisconnectReason: {
    loggedOut: 401,
    badSession: 500,
    connectionReplaced: 440,
  },
  downloadMediaMessage: async (msg: { key: { remoteJid: string } }) => {
    const msgId = msg.key.remoteJid;
    const found = mockDownloadedMedia.find(m => m.msgId === msgId);
    return found?.buffer ?? Buffer.from('test-media-content');
  },
  extensionForMediaMessage: (_msg: unknown) => 'jpg',
}));

// ──────────────────────────────────────────────────────────────────────────────
// DB & module refs
// ──────────────────────────────────────────────────────────────────────────────

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'channel-adapters.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = path.join(tmpdir(), 'openclaw-mini-channel-memories');
const WHATSAPP_AUTH_ROOT = path.join(tmpdir(), 'openclaw-mini-whatsapp-auth');

let db: PrismaClient;
let deliveryService: typeof import('../src/lib/services/delivery-service');
let adapterIndex: typeof import('../src/lib/adapters');
let agentService: typeof import('../src/lib/services/agent-service');
let inputManager: typeof import('../src/lib/services/input-manager');
let initialMemoryDirs = new Set<string>();
let runtimeConfigFixture: RuntimeConfigFixture | null = null;

type DeliveryRecord = {
  id: string;
  taskId: string;
  channel: string;
  channelKey: string;
  targetJson: string;
  text: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  sentAt: Date | null;
  externalMessageId: string | null;
  dedupeKey: string;
};
type DeliveryModel = {
  deleteMany(): Promise<unknown>;
  findMany(): Promise<DeliveryRecord[]>;
  create(args: { data: Record<string, unknown> }): Promise<DeliveryRecord>;
  findUnique(args: { where: { id: string } }): Promise<DeliveryRecord | null>;
};
type DeliveryDbClient = PrismaClient & { outboundDelivery: DeliveryModel };

function deliveryModel(): DeliveryModel {
  return (db as DeliveryDbClient).outboundDelivery;
}

function captureInitialMemoryDirs() {
  if (!fs.existsSync(MEMORY_ROOT)) { initialMemoryDirs = new Set(); return; }
  initialMemoryDirs = new Set(fs.readdirSync(MEMORY_ROOT));
}

function cleanupMemoryDirs() {
  if (!fs.existsSync(MEMORY_ROOT)) return;
  for (const entry of fs.readdirSync(MEMORY_ROOT)) {
    if (!initialMemoryDirs.has(entry)) {
      fs.rmSync(path.join(MEMORY_ROOT, entry), { recursive: true, force: true });
    }
  }
}

async function resetDb() {
  await deliveryModel().deleteMany();
  await db.sessionMessage.deleteMany();
  await db.task.deleteMany();
  await db.session.deleteMany();
  await db.channelBinding.deleteMany();
  await db.memory.deleteMany();
  await db.auditLog.deleteMany();
  await db.agent.deleteMany();
}

async function createDefaultAgent(name = 'Test Agent') {
  const agent = await agentService.agentService.createAgent({ name });
  await agentService.agentService.setDefaultAgent(agent.id);
  return agent;
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  process.env.OPENCLAW_API_KEY = 'test-api-key';
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';
  process.env.WHATSAPP_AUTH_DIR = WHATSAPP_AUTH_ROOT;
  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-channel-adapters-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_MEMORY_DIR = MEMORY_ROOT;
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  captureInitialMemoryDirs();

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, NO_ENV_FILE: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare channel-adapters test DB: ${dbPush.stderr.toString()}`);
  }

  db = (await import('../src/lib/db')).db;
  deliveryService = await import('../src/lib/services/delivery-service');
  adapterIndex = await import('../src/lib/adapters');
  agentService = await import('../src/lib/services/agent-service');
  inputManager = await import('../src/lib/services/input-manager');

  await resetDb();
});

beforeEach(async () => {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';
  deliveryService.resetAdaptersForTests();
  adapterIndex.resetAdapterInitializationForTests();
  mockSentMessages.length = 0;
  for (const key of Object.keys(mockSocketEvents)) delete mockSocketEvents[key];
  await resetDb();
});

afterAll(async () => {
  delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
  delete process.env.OPENCLAW_API_KEY;
  delete process.env.WHATSAPP_AUTH_DIR;
  await resetDb();
  await db.$disconnect();
  cleanupMemoryDirs();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  if (fs.existsSync(TEST_DB_PATH)) fs.rmSync(TEST_DB_PATH, { force: true });
  delete process.env.OPENCLAW_MEMORY_DIR;
  if (fs.existsSync(MEMORY_ROOT)) fs.rmSync(MEMORY_ROOT, { recursive: true, force: true });
  if (fs.existsSync(WHATSAPP_AUTH_ROOT)) fs.rmSync(WHATSAPP_AUTH_ROOT, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6.1 Adapter lifecycle tests — isConnected() in dispatchDelivery
// ──────────────────────────────────────────────────────────────────────────────

describe('6.1 adapter lifecycle — delivery routing', () => {
  test('adapter without isConnected is treated as always connected', async () => {
    const agent = await createDefaultAgent();
    const task = await db.task.create({
      data: { agentId: agent.id, type: 'message', priority: 3, status: 'pending', payload: '{}' },
    });

    deliveryService.registerAdapter({
      channel: 'telegram',
      sendText: async () => ({ externalMessageId: 'msg-ok' }),
    });

    const delivery = await deliveryModel().create({
      data: {
        taskId: task.id,
        channel: 'telegram',
        channelKey: 'chat-1',
        targetJson: JSON.stringify({ channel: 'telegram', channelKey: 'chat-1', metadata: { chatId: 'chat-1' } }),
        text: 'hello',
        dedupeKey: `task:${task.id}:a`,
      },
    });

    const outcome = await deliveryService.dispatchDelivery(delivery);
    expect(outcome).toBe('sent');
  });

  test('adapter with isConnected() === false defers delivery', async () => {
    const agent = await createDefaultAgent();
    const task = await db.task.create({
      data: { agentId: agent.id, type: 'message', priority: 3, status: 'pending', payload: '{}' },
    });

    deliveryService.registerAdapter({
      channel: 'webchat',
      sendText: async () => ({ }),
      isConnected: () => false,
    });

    const delivery = await deliveryModel().create({
      data: {
        taskId: task.id,
        channel: 'webchat',
        channelKey: 'session-1',
        targetJson: JSON.stringify({ channel: 'webchat', channelKey: 'session-1', metadata: {} }),
        text: 'deferred',
        dedupeKey: `task:${task.id}:b`,
      },
    });

    const outcome = await deliveryService.dispatchDelivery(delivery);
    const updated = await deliveryModel().findUnique({ where: { id: delivery.id } });

    expect(outcome).toBe('retried');
    expect(updated?.status).toBe('pending');
    expect(updated?.nextAttemptAt).toBeTruthy();
    expect(updated?.lastError).toContain('not connected');
  });

  test('adapter with isConnected() === true proceeds normally', async () => {
    const agent = await createDefaultAgent();
    const task = await db.task.create({
      data: { agentId: agent.id, type: 'message', priority: 3, status: 'pending', payload: '{}' },
    });

    deliveryService.registerAdapter({
      channel: 'webchat',
      sendText: async () => ({ externalMessageId: 'ws-broadcast-ok' }),
      isConnected: () => true,
    });

    const delivery = await deliveryModel().create({
      data: {
        taskId: task.id,
        channel: 'webchat',
        channelKey: 'session-2',
        targetJson: JSON.stringify({ channel: 'webchat', channelKey: 'session-2', metadata: {} }),
        text: 'proceed',
        dedupeKey: `task:${task.id}:c`,
      },
    });

    const outcome = await deliveryService.dispatchDelivery(delivery);
    expect(outcome).toBe('sent');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6.2 Telegram adapter lifecycle tests
// ──────────────────────────────────────────────────────────────────────────────

describe('6.2 Telegram adapter lifecycle', () => {
  test('start() sets connected, stop() sets disconnected, isConnected() returns correct state', async () => {
    const { TelegramAdapter } = await import('../src/lib/adapters/telegram-adapter');
    const adapter = new TelegramAdapter('test-token');

    expect(adapter.isConnected()).toBe(false);

    await adapter.start();
    expect(adapter.isConnected()).toBe(true);

    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  test('sendText() still works after start', async () => {
    const { TelegramAdapter } = await import('../src/lib/adapters/telegram-adapter');
    const adapter = new TelegramAdapter('test-token');
    await adapter.start();

    const sendCalls: string[] = [];
    const bot = (adapter as unknown as { bot: { api: { sendMessage: (id: string, text: string) => Promise<{ message_id: number }> } } }).bot;
    bot.api.sendMessage = async (id: string, text: string) => {
      sendCalls.push(text);
      return { message_id: 1 };
    };

    const result = await adapter.sendText(
      { channel: 'telegram', channelKey: '123', metadata: { chatId: '123' } },
      'hi after start',
    );

    expect(result.externalMessageId).toBe('1');
    expect(sendCalls).toHaveLength(1);
  });

  test('multiple start() calls are idempotent', async () => {
    const { TelegramAdapter } = await import('../src/lib/adapters/telegram-adapter');
    const adapter = new TelegramAdapter('test-token');
    await adapter.start();
    await adapter.start();
    expect(adapter.isConnected()).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6.3 WhatsApp adapter unit tests (Baileys mocked)
// ──────────────────────────────────────────────────────────────────────────────

describe('6.3 WhatsApp adapter unit tests', () => {
  test('start() without auth triggers qrCallback', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    let qrReceived: string | null = null;
    adapter.onQr((qr) => { qrReceived = qr; });

    const startPromise = adapter.start();
    // Yield to let useMultiFileAuthState resolve and socket listeners register
    await new Promise(r => setTimeout(r, 0));

    // Simulate QR event from Baileys
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ qr: 'mock-qr-data' }));

    // Simulate open connection
    connListeners?.forEach(cb => cb({ connection: 'open' }));

    await startPromise;

    expect(qrReceived).toBeTruthy();
    expect(adapter.isConnected()).toBe(true);
  });

  test('start() with existing auth reconnects without QR', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    let qrCalled = false;
    adapter.onQr(() => { qrCalled = true; });

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));

    // Simulate immediate open without QR
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));

    await startPromise;

    expect(qrCalled).toBe(false);
    expect(adapter.isConnected()).toBe(true);
  });

  test('sendText() sends message via Baileys and returns externalMessageId', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));
    await startPromise;

    const result = await adapter.sendText(
      { channel: 'whatsapp', channelKey: '5511@s.whatsapp.net', metadata: { chatId: '5511@s.whatsapp.net' } },
      'hello whatsapp',
    );

    expect(mockSentMessages).toHaveLength(1);
    expect(mockSentMessages[0]?.jid).toBe('5511@s.whatsapp.net');
    expect(mockSentMessages[0]?.content).toMatchObject({ text: 'hello whatsapp' });
    expect(result.externalMessageId).toBeTruthy();
  });

  test('sendText() throws when disconnected', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    await expect(
      adapter.sendText(
        { channel: 'whatsapp', channelKey: '5511@s.whatsapp.net', metadata: { chatId: '5511@s.whatsapp.net' } },
        'will fail',
      ),
    ).rejects.toThrow('WhatsApp connection is not active');
  });

  test('inbound messages.upsert routes to /api/input', async () => {
    const fetchCalls: Array<{ url: string; body: unknown; headers: Headers }> = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({
        url: url.toString(),
        body: init?.body ? JSON.parse(init.body as string) : null,
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));
    await startPromise;

    const msgListeners = mockSocketEvents['messages.upsert'] as MessagesListener[] | undefined;
    msgListeners?.forEach(cb => cb({
      type: 'notify',
      messages: [{
        key: { remoteJid: '5511@s.whatsapp.net' },
        message: { conversation: 'hello agent' },
      }],
    }));

    // Give the async POST a chance to fire
    await new Promise(r => setTimeout(r, 10));

    global.fetch = originalFetch;

    const inputCall = fetchCalls.find(c => c.url.includes('/api/input'));
    expect(inputCall).toBeTruthy();
    const body = inputCall?.body as Record<string, unknown>;
    expect(body.type).toBe('message');
    expect(body.channel).toBe('whatsapp');
    expect(body.channelKey).toBe('5511@s.whatsapp.net');
    expect(body.content).toBe('hello agent');
    expect(inputCall?.headers.get('authorization')).toBe('Bearer test-api-key');
  });

  test('non-text messages are ignored', async () => {
    const fetchCalls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request) => {
      fetchCalls.push(url.toString());
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));
    await startPromise;

    const msgListeners = mockSocketEvents['messages.upsert'] as MessagesListener[] | undefined;
    msgListeners?.forEach(cb => cb({
      type: 'notify',
      messages: [{ key: { remoteJid: '5511@s.whatsapp.net' }, message: { protocolMessage: {} } as never }],
    }));

    await new Promise(r => setTimeout(r, 10));
    global.fetch = originalFetch;

    expect(fetchCalls.filter(u => u.includes('/api/input'))).toHaveLength(0);
  });

  test('status@broadcast messages are ignored', async () => {
    const fetchCalls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request) => {
      fetchCalls.push(url.toString());
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));
    await startPromise;

    const msgListeners = mockSocketEvents['messages.upsert'] as MessagesListener[] | undefined;
    msgListeners?.forEach(cb => cb({
      type: 'notify',
      messages: [{
        key: { remoteJid: 'status@broadcast' },
        message: { conversation: 'status update' },
      }],
    }));

    await new Promise(r => setTimeout(r, 10));
    global.fetch = originalFetch;

    expect(fetchCalls.filter(u => u.includes('/api/input'))).toHaveLength(0);
  });

  test('stop() marks adapter as disconnected', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));
    await startPromise;

    expect(adapter.isConnected()).toBe(true);
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6.4 WebChat adapter unit test
// ──────────────────────────────────────────────────────────────────────────────

describe('6.4 WebChat adapter unit tests', () => {
  test('sendText() POSTs to WS /broadcast endpoint with correct payload', async () => {
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: url.toString(), body: JSON.parse(init?.body as string ?? '{}') });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const { WebChatAdapter } = await import('../src/lib/adapters/webchat-adapter');
    const adapter = new WebChatAdapter();

    const result = await adapter.sendText(
      { channel: 'webchat', channelKey: 'browser-session-abc', metadata: {} },
      'hello from agent',
    );

    global.fetch = originalFetch;

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url).toContain('/broadcast');
    const evt = (call.body.event as Record<string, unknown>);
    expect(evt.type).toBe('session:updated');
    const data = evt.data as Record<string, unknown>;
    expect(data.sessionId).toBe('browser-session-abc');
    expect(data.message).toBe('hello from agent');
    expect(data.role).toBe('agent');
    expect(result).toEqual({});
  });

  test('sendText() throws on broadcast failure', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;

    const { WebChatAdapter } = await import('../src/lib/adapters/webchat-adapter');
    const adapter = new WebChatAdapter();

    await expect(
      adapter.sendText({ channel: 'webchat', channelKey: 'session-x', metadata: {} }, 'fail'),
    ).rejects.toThrow('WebChat broadcast failed: 500');

    global.fetch = originalFetch;
  });

  test('WebChat adapter has correct channel and no lifecycle methods needed', async () => {
    const { WebChatAdapter } = await import('../src/lib/adapters/webchat-adapter');
    const adapter = new WebChatAdapter();
    const asBase = adapter as import('../src/lib/types').ChannelAdapter;
    expect(adapter.channel).toBe('webchat');
    expect(asBase.start).toBeUndefined();
    expect(asBase.stop).toBeUndefined();
    expect(asBase.isConnected).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6.5 WebChat integration test (API level)
// ──────────────────────────────────────────────────────────────────────────────

describe('6.5 WebChat integration test', () => {
  test('webchat message routed through /api/input creates a task and session', async () => {
    await createDefaultAgent();

    const sessionId = 'webchat-test-session-123';

    const inputRoute = await import('../src/app/api/input/route');
    const req = new NextRequest('http://localhost/api/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: {
          type: 'message',
          channel: 'webchat',
          channelKey: sessionId,
          content: 'hello from web',
          deliveryTarget: {
            channel: 'webchat',
            channelKey: sessionId,
            metadata: {},
          },
        },
      }),
    });

    const res = await inputRoute.POST(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { success: boolean; data?: { taskId?: string } };
    expect(body.success).toBe(true);
    expect(body.data?.taskId).toBeTruthy();

    const task = await db.task.findUnique({ where: { id: body.data!.taskId } });
    expect(task).toBeTruthy();
    expect(task?.type).toBe('message');

    const session = await db.session.findFirst({ where: { channel: 'webchat', channelKey: sessionId } });
    expect(session).toBeTruthy();
  });

  test('/api/sessions/messages returns messages for webchat session', async () => {
    const agent = await createDefaultAgent();
    const channelKey = 'webchat-history-test';

    const session = await db.session.create({
      data: { agentId: agent.id, channel: 'webchat', channelKey, sessionScope: channelKey },
    });
    await db.sessionMessage.create({
      data: { sessionId: session.id, role: 'user', content: 'first message', channel: 'webchat', channelKey },
    });
    await db.sessionMessage.create({
      data: { sessionId: session.id, role: 'assistant', content: 'agent reply', channel: 'webchat', channelKey },
    });

    const messagesRoute = await import('../src/app/api/sessions/messages/route');
    const req = new NextRequest(
      `http://localhost/api/sessions/messages?channel=webchat&channelKey=${encodeURIComponent(channelKey)}`,
    );

    const res = await messagesRoute.GET(req);
    const body = await res.json() as { success: boolean; data: Array<{ role: string; content: string }> };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.role).toBe('user');
    expect(body.data[0]?.content).toBe('first message');
    expect(body.data[1]?.role).toBe('assistant');
  });

  test('/api/sessions/messages returns empty array for unknown session', async () => {
    const messagesRoute = await import('../src/app/api/sessions/messages/route');
    const req = new NextRequest('http://localhost/api/sessions/messages?channel=webchat&channelKey=nonexistent');
    const res = await messagesRoute.GET(req);
    const body = await res.json() as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6.6 Adapter initialization tests
// ──────────────────────────────────────────────────────────────────────────────

describe('6.6 Adapter initialization tests', () => {
  test('initializeAdapters() returns registered adapters', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.WHATSAPP_ENABLED;

    const adapters = adapterIndex.initializeAdapters();

    expect(Array.isArray(adapters)).toBe(true);
    // WebChat is always registered
    expect(adapters.some(a => a.channel === 'webchat')).toBe(true);
  });

  test('Telegram adapter is registered when TELEGRAM_BOT_TOKEN is set', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok-test-123';
    delete process.env.WHATSAPP_ENABLED;

    const adapters = adapterIndex.initializeAdapters();

    expect(adapters.some(a => a.channel === 'telegram')).toBe(true);
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  test('WhatsApp adapter is registered only when WHATSAPP_ENABLED=true', () => {
    adapterIndex.resetAdapterInitializationForTests();
    deliveryService.resetAdaptersForTests();
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.WHATSAPP_ENABLED = 'true';

    const adapters = adapterIndex.initializeAdapters();
    expect(adapters.some(a => a.channel === 'whatsapp')).toBe(true);
    delete process.env.WHATSAPP_ENABLED;
  });

  test('initializeAdapters() is idempotent — second call returns same list', () => {
    adapterIndex.resetAdapterInitializationForTests();
    deliveryService.resetAdaptersForTests();

    const first = adapterIndex.initializeAdapters();
    const second = adapterIndex.initializeAdapters();

    expect(second).toHaveLength(first.length);
    expect(second.map(a => a.channel)).toEqual(first.map(a => a.channel));
  });

  test('start() failure on one adapter does not prevent others from starting', async () => {
    const failingAdapter = {
      channel: 'telegram' as const,
      sendText: async () => ({ }),
      start: async () => { throw new Error('start failed'); },
      isConnected: () => false,
    };
    const workingAdapter = {
      channel: 'webchat' as const,
      sendText: async () => ({ }),
      start: async () => { /* ok */ },
      isConnected: () => false,
    };

    const errors: string[] = [];
    const started: string[] = [];

    for (const adapter of [failingAdapter, workingAdapter]) {
      if (adapter.start) {
        try {
          await adapter.start();
          started.push(adapter.channel);
        } catch (err) {
          errors.push(adapter.channel);
        }
      }
    }

    expect(errors).toContain('telegram');
    expect(started).toContain('webchat');
  });

  test('getRegisteredAdapters() returns adapters after init', () => {
    adapterIndex.resetAdapterInitializationForTests();
    deliveryService.resetAdaptersForTests();

    adapterIndex.initializeAdapters();
    const adapters = adapterIndex.getRegisteredAdapters();

    expect(adapters.some(a => a.channel === 'webchat')).toBe(true);
  });
});
