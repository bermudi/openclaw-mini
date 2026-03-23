/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

// Must be set BEFORE any module imports that use them
process.env.TELEGRAM_WEBHOOK_SECRET = '';

// Track generateText calls for vision tests
let capturedGenerateTextArgs: unknown = null;

mock.module('ai', () => ({
  generateText: async (args: unknown) => {
    capturedGenerateTextArgs = args;
    return { text: 'stub response', steps: [] };
  },
  stepCountIs: () => () => true,
}));

// ──────────────────────────────────────────────────────────────────────────────
// Grammy mock — must happen before any import of telegram-adapter/webhook
// ──────────────────────────────────────────────────────────────────────────────

const mockGetFileResult = { file_path: 'photos/test.jpg' };
let mockGetFileCalls: string[] = [];

mock.module('grammy', () => ({
  Bot: class {
    api = {
      getFile: async (fileId: string) => {
        mockGetFileCalls.push(fileId);
        return mockGetFileResult;
      },
      sendMessage: async () => ({ message_id: 1 }),
      sendDocument: async () => ({ message_id: 2 }),
    };
    token = 'test-telegram-token';
  },
  GrammyError: class extends Error {
    constructor(message: string) { super(message); }
  },
  HttpError: class extends Error {
    constructor(message: string) { super(message); }
  },
  InputFile: class {
    constructor(public path: string) {}
  },
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
  logout: async () => {},
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

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'attachments.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const MEMORY_ROOT = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-attachments-memories-'));
const INBOUND_ROOT = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-attachments-inbound-'));
const createdTempDirs = new Set<string>([MEMORY_ROOT, INBOUND_ROOT]);

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), prefix));
  createdTempDirs.add(dir);
  return dir;
}

let db: PrismaClient;
let deliveryService: typeof import('../src/lib/services/delivery-service');
let adapterIndex: typeof import('../src/lib/adapters');
let agentService: typeof import('../src/lib/services/agent-service');
let inputManager: typeof import('../src/lib/services/input-manager');
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
  deliveryType?: string;
  filePath?: string | null;
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
  process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-attachments-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_MEMORY_DIR = MEMORY_ROOT;
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare attachments test DB: ${dbPush.stderr.toString()}`);
  }

  db = (await import('../src/lib/db')).db;
  deliveryService = await import('../src/lib/services/delivery-service');
  adapterIndex = await import('../src/lib/adapters');
  agentService = await import('../src/lib/services/agent-service');
  inputManager = await import('../src/lib/services/input-manager');

  // Set inbound root to temp dir for tests
  const { setInboundRootForTests } = await import('../src/lib/services/inbound-file-service');
  setInboundRootForTests(INBOUND_ROOT);

  await resetDb();
});

beforeEach(async () => {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  deliveryService.resetAdaptersForTests();
  adapterIndex.resetAdapterInitializationForTests();
  mockSentMessages.length = 0;
  mockDownloadedMedia.length = 0;
  mockGetFileCalls = [];
  capturedGenerateTextArgs = null;
  for (const key of Object.keys(mockSocketEvents)) delete mockSocketEvents[key];
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  if (fs.existsSync(TEST_DB_PATH)) fs.rmSync(TEST_DB_PATH, { force: true });
  delete process.env.OPENCLAW_MEMORY_DIR;
  delete process.env.TELEGRAM_BOT_TOKEN;

  // Reset inbound root override
  const { setInboundRootForTests } = await import('../src/lib/services/inbound-file-service');
  setInboundRootForTests(null);

  // Clean up all created temp dirs
  for (const dir of createdTempDirs) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 2.7 Telegram webhook route tests — photo/document/animation handling
// ──────────────────────────────────────────────────────────────────────────────

describe('2.7 Telegram webhook attachment handling', () => {
  test('photo message creates vision input', async () => {
    await createDefaultAgent();

    // Mock fetch for file download
    const originalFetch = global.fetch;
    const fetchCalls: string[] = [];
    global.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      fetchCalls.push(urlStr);
      if (urlStr.includes('api.telegram.org/file')) {
        return new Response(new ArrayBuffer(10), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const webhookRoute = await import('../src/app/api/channels/telegram/webhook/route');
    const req = new NextRequest('http://localhost/api/channels/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          message_id: 1,
          chat: { id: '12345' },
          from: { id: 999, username: 'testuser' },
          photo: [
            { file_id: 'small', width: 100, height: 100 },
            { file_id: 'large', width: 800, height: 600 },
          ],
          caption: 'Check this out',
        },
      }),
    });

    const res = await webhookRoute.POST(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { success: boolean; data?: { taskId?: string } };
    expect(body.success).toBe(true);
    expect(body.data?.taskId).toBeTruthy();

    // Verify getFile was called with largest photo
    expect(mockGetFileCalls).toContain('large');

    // Verify file was downloaded
    expect(fetchCalls.some(u => u.includes('api.telegram.org/file'))).toBe(true);

    global.fetch = originalFetch;
  });

  test('document message creates attachment', async () => {
    await createDefaultAgent();

    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('api.telegram.org/file')) {
        return new Response(new ArrayBuffer(100), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const webhookRoute = await import('../src/app/api/channels/telegram/webhook/route');
    const req = new NextRequest('http://localhost/api/channels/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          message_id: 2,
          chat: { id: '12345' },
          from: { id: 999, username: 'testuser' },
          document: {
            file_id: 'doc123',
            file_name: 'report.pdf',
            mime_type: 'application/pdf',
            file_size: 1024,
          },
          caption: 'Here is the report',
        },
      }),
    });

    const res = await webhookRoute.POST(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);

    global.fetch = originalFetch;
  });

  test('animation is treated as attachment (not vision input)', async () => {
    await createDefaultAgent();

    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('api.telegram.org/file')) {
        return new Response(new ArrayBuffer(50), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const webhookRoute = await import('../src/app/api/channels/telegram/webhook/route');
    const req = new NextRequest('http://localhost/api/channels/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          message_id: 3,
          chat: { id: '12345' },
          from: { id: 999 },
          animation: {
            file_id: 'anim456',
            file_name: 'funny.gif',
            mime_type: 'image/gif',
          },
        },
      }),
    });

    const res = await webhookRoute.POST(req);
    expect(res.status).toBe(200);

    global.fetch = originalFetch;
  });

  test('text-only message is unchanged', async () => {
    await createDefaultAgent();

    const webhookRoute = await import('../src/app/api/channels/telegram/webhook/route');
    const req = new NextRequest('http://localhost/api/channels/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          message_id: 4,
          chat: { id: '12345' },
          from: { id: 999, username: 'testuser' },
          text: 'Hello world',
        },
      }),
    });

    const res = await webhookRoute.POST(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { success: boolean; data?: { taskId?: string } };
    expect(body.success).toBe(true);
    expect(body.data?.taskId).toBeTruthy();
  });

  test('download failure does not block text processing', async () => {
    await createDefaultAgent();

    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('api.telegram.org/file')) {
        throw new Error('Download failed');
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const webhookRoute = await import('../src/app/api/channels/telegram/webhook/route');
    const req = new NextRequest('http://localhost/api/channels/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          message_id: 5,
          chat: { id: '12345' },
          from: { id: 999 },
          photo: [{ file_id: 'photo1', width: 100, height: 100 }],
          caption: 'This caption should still work',
        },
      }),
    });

    const res = await webhookRoute.POST(req);
    expect(res.status).toBe(200);

    // Even though download failed, caption text should be processed
    const body = await res.json() as { success: boolean; data?: { taskId?: string } };
    expect(body.success).toBe(true);
    expect(body.data?.taskId).toBeTruthy();

    global.fetch = originalFetch;
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3.6 Vision handling in agent executor
// ──────────────────────────────────────────────────────────────────────────────

describe('3.6 Vision handling in agent executor', () => {
  test('vision model gets image content parts', async () => {
    const agent = await createDefaultAgent();
    await db.agent.update({
      where: { id: agent.id },
      data: { model: 'gpt-4o' }, // Known vision model
    });

    // Create test image file
    const testDir = createTempDir('openclaw-vision-test-');
    const imagePath = path.join(testDir, 'test.png');
    fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG header

    const session = await db.session.create({
      data: { agentId: agent.id, channel: 'telegram', channelKey: '123', sessionScope: '123' },
    });

    const task = await db.task.create({
      data: {
        agentId: agent.id,
        sessionId: session.id,
        type: 'message',
        priority: 3,
        status: 'pending',
        payload: JSON.stringify({
          content: 'What is in this image?',
          channel: 'telegram',
          channelKey: '123',
          deliveryTarget: { channel: 'telegram', channelKey: '123', metadata: { chatId: '123' } },
          visionInputs: [{ channelFileId: 'photo1', localPath: imagePath, mimeType: 'image/png' }],
        }),
      },
    });

    const { agentExecutor } = await import('../src/lib/services/agent-executor');
    await agentExecutor.executeTask(task.id);

    // Verify multi-part content was used (captured via top-level mock)
    expect(capturedGenerateTextArgs).toBeTruthy();
    const args = capturedGenerateTextArgs as { messages?: Array<{ content: unknown }> };
    expect(args.messages).toBeTruthy();
    expect(args.messages?.[0]?.content).toBeInstanceOf(Array);

    const contentParts = args.messages?.[0]?.content as Array<{ type: string }>;
    expect(contentParts.some(p => p.type === 'text')).toBe(true);
    expect(contentParts.some(p => p.type === 'image')).toBe(true);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('non-vision model with text gets warning', async () => {
    // Mock supportsVision to return false for our test model
    mock.module('../src/lib/services/model-catalog', () => ({
      supportsVision: (modelId: string) => modelId === 'gpt-4o', // Only gpt-4o is vision-capable in this mock
      MODEL_CONTEXT_WINDOWS: {},
      modelCatalog: { getModels: () => [], getContextWindowSize: () => 128000 },
    }));

    const agent = await createDefaultAgent();
    // Use a model NOT in KNOWN_VISION_MODELS
    await db.agent.update({
      where: { id: agent.id },
      data: { model: 'text-davinci-003' }, // Definitely not a vision model
    });

    const testDir = createTempDir('openclaw-vision-test2-');
    const imagePath = path.join(testDir, 'test.jpg');
    fs.writeFileSync(imagePath, Buffer.from([0xFF, 0xD8, 0xFF]));

    const session = await db.session.create({
      data: { agentId: agent.id, channel: 'telegram', channelKey: '456', sessionScope: '456' },
    });

    const task = await db.task.create({
      data: {
        agentId: agent.id,
        sessionId: session.id,
        type: 'message',
        priority: 3,
        status: 'pending',
        payload: JSON.stringify({
          content: 'Describe this',
          channel: 'telegram',
          channelKey: '456',
          deliveryTarget: { channel: 'telegram', channelKey: '456', metadata: { chatId: '456' } },
          visionInputs: [{ channelFileId: 'photo2', localPath: imagePath, mimeType: 'image/jpeg' }],
        }),
      },
    });

    const { agentExecutor } = await import('../src/lib/services/agent-executor');
    await agentExecutor.executeTask(task.id);

    // Should have two deliveries: response + warning
    const deliveries = await deliveryModel().findMany();
    expect(deliveries.length).toBe(2);

    const warningDelivery = deliveries.find(d => d.dedupeKey.includes('warning'));
    expect(warningDelivery).toBeTruthy();
    expect(warningDelivery?.text).toContain("doesn't support vision");

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('non-vision model image-only gets error', async () => {
    // Mock supportsVision to return false for our test model
    mock.module('../src/lib/services/model-catalog', () => ({
      supportsVision: (modelId: string) => modelId === 'gpt-4o', // Only gpt-4o is vision-capable in this mock
      MODEL_CONTEXT_WINDOWS: {},
      modelCatalog: { getModels: () => [], getContextWindowSize: () => 128000 },
    }));

    const agent = await createDefaultAgent();
    // Use a model NOT in KNOWN_VISION_MODELS
    await db.agent.update({
      where: { id: agent.id },
      data: { model: 'text-davinci-003' }, // Definitely not a vision model
    });

    const testDir = createTempDir('openclaw-vision-test3-');
    const imagePath = path.join(testDir, 'test.png');
    fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

    const session = await db.session.create({
      data: { agentId: agent.id, channel: 'telegram', channelKey: '789', sessionScope: '789' },
    });

    const task = await db.task.create({
      data: {
        agentId: agent.id,
        sessionId: session.id,
        type: 'message',
        priority: 3,
        status: 'pending',
        payload: JSON.stringify({
          content: '', // No text, only image
          channel: 'telegram',
          channelKey: '789',
          deliveryTarget: { channel: 'telegram', channelKey: '789', metadata: { chatId: '789' } },
          visionInputs: [{ channelFileId: 'photo3', localPath: imagePath, mimeType: 'image/png' }],
        }),
      },
    });

    const { agentExecutor } = await import('../src/lib/services/agent-executor');
    const result = await agentExecutor.executeTask(task.id);

    expect(result.success).toBe(true);
    expect(result.response).toContain("doesn't support vision");

    // Should have one delivery with error message
    const deliveries = await deliveryModel().findMany();
    expect(deliveries.length).toBe(1);
    expect(deliveries[0]?.text).toContain("doesn't support vision");

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4.2 Telegram sendFile tests
// ──────────────────────────────────────────────────────────────────────────────

describe('4.2 Telegram sendFile', () => {
  test('sends document with caption', async () => {
    const { TelegramAdapter } = await import('../src/lib/adapters/telegram-adapter');
    const adapter = new TelegramAdapter('test-token');
    await adapter.start();

    const sendDocCalls: Array<{ chatId: string; opts: { caption?: string } }> = [];
    const bot = (adapter as unknown as { bot: { api: { sendDocument: (chatId: string, file: unknown, opts?: { caption?: string }) => Promise<{ message_id: number }> } } }).bot;
    bot.api.sendDocument = async (chatId: string, _file: unknown, opts?: { caption?: string }) => {
      sendDocCalls.push({ chatId, opts: { caption: opts?.caption } });
      return { message_id: 42 };
    };

    // Create test file
    const testDir = createTempDir('telegram-sendfile-test-');
    const testFile = path.join(testDir, 'report.pdf');
    fs.writeFileSync(testFile, 'test content');

    const result = await adapter.sendFile(
      { channel: 'telegram', channelKey: '123', metadata: { chatId: '123' } },
      testFile,
      { caption: 'Here is the report', filename: 'report.pdf' },
    );

    expect(result.externalMessageId).toBe('42');
    expect(sendDocCalls).toHaveLength(1);
    expect(sendDocCalls[0]?.chatId).toBe('123');
    expect(sendDocCalls[0]?.opts.caption).toBe('Here is the report');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('handles missing chatId', async () => {
    const { TelegramAdapter } = await import('../src/lib/adapters/telegram-adapter');
    const adapter = new TelegramAdapter('test-token');
    await adapter.start();

    const testFile = path.join(createTempDir('telegram-missing-chatid-'), 'test.txt');
    fs.writeFileSync(testFile, 'test');

    await expect(
      adapter.sendFile(
        { channel: 'telegram', channelKey: '', metadata: {} },
        testFile,
      ),
    ).rejects.toThrow('missing chatId');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5.3 WhatsApp attachment tests
// ──────────────────────────────────────────────────────────────────────────────

describe('5.3 WhatsApp attachment handling', () => {
  test('sendFile sends document via socket', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));
    await startPromise;

    const testFile = path.join(createTempDir('whatsapp-doc-'), 'whatsapp-doc.pdf');
    fs.writeFileSync(testFile, 'pdf content');

    const result = await adapter.sendFile(
      { channel: 'whatsapp', channelKey: '5511@s.whatsapp.net', metadata: { chatId: '5511@s.whatsapp.net' } },
      testFile,
      { filename: 'doc.pdf', mimeType: 'application/pdf', caption: 'See attached' },
    );

    expect(result.externalMessageId).toBeTruthy();
    expect(mockSentMessages).toHaveLength(1);
    expect(mockSentMessages[0]?.jid).toBe('5511@s.whatsapp.net');
    expect(mockSentMessages[0]?.content).toMatchObject({
      document: { url: testFile },
      mimetype: 'application/pdf',
      fileName: 'doc.pdf',
      caption: 'See attached',
    });

    fs.rmSync(testFile, { force: true });
  });

  test('sendFile throws when disconnected', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    const testFile = path.join(createTempDir('whatsapp-disconnected-'), 'test.txt');
    fs.writeFileSync(testFile, 'test');

    await expect(
      adapter.sendFile(
        { channel: 'whatsapp', channelKey: '5511@s.whatsapp.net', metadata: { chatId: '5511@s.whatsapp.net' } },
        testFile,
      ),
    ).rejects.toThrow('WhatsApp connection is not active');
  });

  test('inbound image message creates vision input', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    // Setup mock downloaded media
    mockDownloadedMedia.push({
      msgId: 'img-msg-123',
      buffer: Buffer.from([0xFF, 0xD8, 0xFF]),
      ext: 'jpg',
    });

    const fetchCalls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));
    await startPromise;

    // Simulate image message
    const msgListeners = mockSocketEvents['messages.upsert'] as MessagesListener[] | undefined;
    msgListeners?.forEach(cb => cb({
      type: 'notify',
      messages: [{
        key: { remoteJid: 'img-msg-123' }, // Using as msgId for mock lookup
        message: {
          imageMessage: {
            mediaKey: new Uint8Array([1, 2, 3]),
            mimetype: 'image/jpeg',
            caption: 'Look at this',
          },
        } as never,
      }],
    }));

    await new Promise(r => setTimeout(r, 50));

    global.fetch = originalFetch;

    const inputCall = fetchCalls.find(c => c.url.includes('/api/input'));
    expect(inputCall).toBeTruthy();
    const body = inputCall?.body as Record<string, unknown>;
    expect(body.visionInputs).toBeTruthy();
    expect((body.visionInputs as Array<{ mimeType: string }>)[0]?.mimeType).toBe('image/jpeg');
    expect(body.content).toBe('Look at this');
  });

  test('inbound document message creates attachment', async () => {
    const { WhatsAppAdapter } = await import('../src/lib/adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    mockDownloadedMedia.push({
      msgId: 'doc-msg-456',
      buffer: Buffer.from('pdf content'),
      ext: 'pdf',
    });

    const fetchCalls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const startPromise = adapter.start();
    await new Promise(r => setTimeout(r, 0));
    const connListeners = mockSocketEvents['connection.update'] as ConnectionListener[] | undefined;
    connListeners?.forEach(cb => cb({ connection: 'open' }));
    await startPromise;

    const msgListeners = mockSocketEvents['messages.upsert'] as MessagesListener[] | undefined;
    msgListeners?.forEach(cb => cb({
      type: 'notify',
      messages: [{
        key: { remoteJid: 'doc-msg-456' },
        message: {
          documentMessage: {
            mediaKey: new Uint8Array([4, 5, 6]),
            mimetype: 'application/pdf',
            fileName: 'contract.pdf',
            caption: 'Signed contract',
          },
        } as never,
      }],
    }));

    await new Promise(r => setTimeout(r, 50));

    global.fetch = originalFetch;

    const inputCall = fetchCalls.find(c => c.url.includes('/api/input'));
    expect(inputCall).toBeTruthy();
    const body = inputCall?.body as Record<string, unknown>;
    expect(body.attachments).toBeTruthy();
    expect((body.attachments as Array<{ filename: string }>)[0]?.filename).toBe('contract.pdf');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6.4 File delivery dispatch tests
// ──────────────────────────────────────────────────────────────────────────────

describe('6.4 File delivery dispatch', () => {
  test('file delivery calls sendFile on adapter', async () => {
    const agent = await createDefaultAgent();
    const task = await db.task.create({
      data: { agentId: agent.id, type: 'message', priority: 3, status: 'pending', payload: '{}' },
    });

    const sendFileCalls: Array<{ target: unknown; filePath: string; opts: unknown }> = [];
    deliveryService.registerAdapter({
      channel: 'telegram',
      sendText: async () => ({ externalMessageId: 'msg-ok' }),
      sendFile: async (target, filePath, opts) => {
        sendFileCalls.push({ target, filePath, opts });
        return { externalMessageId: 'file-ok' };
      },
      isConnected: () => true,
    });

    const delivery = await deliveryModel().create({
      data: {
        taskId: task.id,
        channel: 'telegram',
        channelKey: 'chat-1',
        targetJson: JSON.stringify({ channel: 'telegram', channelKey: 'chat-1', metadata: { chatId: 'chat-1' } }),
        text: 'File caption',
        dedupeKey: `task:${task.id}:file`,
        deliveryType: 'file',
        filePath: '/tmp/test.pdf',
      },
    });

    const outcome = await deliveryService.dispatchDelivery(delivery);

    expect(outcome).toBe('sent');
    expect(sendFileCalls).toHaveLength(1);
    expect(sendFileCalls[0]?.filePath).toBe('/tmp/test.pdf');
    expect(sendFileCalls[0]?.opts).toMatchObject({ caption: 'File caption' });
  });

  test('adapter without sendFile fails gracefully', async () => {
    const agent = await createDefaultAgent();
    const task = await db.task.create({
      data: { agentId: agent.id, type: 'message', priority: 3, status: 'pending', payload: '{}' },
    });

    deliveryService.registerAdapter({
      channel: 'webchat',
      sendText: async () => ({ }),
      // No sendFile method
      isConnected: () => true,
    });

    const delivery = await deliveryModel().create({
      data: {
        taskId: task.id,
        channel: 'webchat',
        channelKey: 'session-1',
        targetJson: JSON.stringify({ channel: 'webchat', channelKey: 'session-1', metadata: {} }),
        text: 'File caption',
        dedupeKey: `task:${task.id}:file2`,
        deliveryType: 'file',
        filePath: '/tmp/test.pdf',
      },
    });

    const outcome = await deliveryService.dispatchDelivery(delivery);

    expect(outcome).toBe('failed');

    const updated = await deliveryModel().findUnique({ where: { id: delivery.id } });
    expect(updated?.status).toBe('failed');
    expect(updated?.lastError).toContain('does not support file delivery');
  });

  test('text delivery still works alongside file support', async () => {
    const agent = await createDefaultAgent();
    const task = await db.task.create({
      data: { agentId: agent.id, type: 'message', priority: 3, status: 'pending', payload: '{}' },
    });

    const sendTextCalls: string[] = [];
    deliveryService.registerAdapter({
      channel: 'telegram',
      sendText: async (_target, text) => {
        sendTextCalls.push(text);
        return { externalMessageId: 'text-ok' };
      },
      sendFile: async () => ({ externalMessageId: 'file-ok' }),
      isConnected: () => true,
    });

    const delivery = await deliveryModel().create({
      data: {
        taskId: task.id,
        channel: 'telegram',
        channelKey: 'chat-2',
        targetJson: JSON.stringify({ channel: 'telegram', channelKey: 'chat-2', metadata: { chatId: 'chat-2' } }),
        text: 'Hello world',
        dedupeKey: `task:${task.id}:text`,
        deliveryType: 'text', // Explicit text type
      },
    });

    const outcome = await deliveryService.dispatchDelivery(delivery);

    expect(outcome).toBe('sent');
    expect(sendTextCalls).toHaveLength(1);
    expect(sendTextCalls[0]).toBe('Hello world');
  });
});
