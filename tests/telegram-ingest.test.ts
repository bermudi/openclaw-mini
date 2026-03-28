/// <reference types="bun-types" />

import { afterAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { processTelegramUpdate } from '../src/lib/adapters/telegram-ingest';
import { resolveTelegramTransport } from '../src/lib/adapters/telegram-transport';
import { setInboundRootForTests } from '../src/lib/services/inbound-file-service';
import type { MessageInput } from '../src/lib/types';

const inboundRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-mini-telegram-ingest-'));

setInboundRootForTests(inboundRoot);

afterAll(() => {
  setInboundRootForTests(null);
  fs.rmSync(inboundRoot, { recursive: true, force: true });
});

test('telegram transport helper defaults to webhook', () => {
  expect(resolveTelegramTransport()).toBe('webhook');
  expect(resolveTelegramTransport('webhook')).toBe('webhook');
  expect(resolveTelegramTransport('polling')).toBe('polling');
  expect(resolveTelegramTransport('unknown')).toBe('webhook');
});

test('telegram ingest normalizes text updates with delivery targets', async () => {
  const capturedInputs: MessageInput[] = [];

  const result = await processTelegramUpdate(
    {
      message: {
        message_id: 10,
        message_thread_id: 7,
        chat: { id: 12345 },
        from: { id: 999, username: 'bermudi', first_name: 'Bermudi' },
        text: 'hello from telegram',
      },
    },
    {
      processInput: async (input) => {
        capturedInputs.push(input);
        return { success: true, taskId: 'task-1', sessionId: 'session-1' };
      },
    },
  );

  expect(result).toEqual({ status: 'processed', taskId: 'task-1', sessionId: 'session-1' });
  expect(capturedInputs).toHaveLength(1);
  expect(capturedInputs[0]).toMatchObject({
    type: 'message',
    channel: 'telegram',
    channelKey: '12345',
    content: 'hello from telegram',
    sender: 'bermudi',
    deliveryTarget: {
      channel: 'telegram',
      channelKey: '12345',
      metadata: {
        chatId: '12345',
        threadId: '7',
        userId: '999',
        replyToMessageId: '10',
      },
    },
  });
});

test('telegram ingest normalizes photo, document, and animation media', async () => {
  const capturedInputs: MessageInput[] = [];
  const downloads: Array<{ fileId: string; filename?: string }> = [];

  const processInput = async (input: MessageInput) => {
    capturedInputs.push(input);
    return { success: true, taskId: 'task-1', sessionId: 'session-1' };
  };

  const downloadFile = async (fileId: string, destDir: string, filename?: string) => {
    downloads.push({ fileId, filename });
    return {
      localPath: `${destDir}/${filename ?? fileId}`,
      mimeType: filename?.endsWith('.pdf') ? 'application/pdf' : filename?.endsWith('.gif') ? 'image/gif' : 'image/jpeg',
    };
  };

  await processTelegramUpdate(
    {
      message: {
        message_id: 20,
        chat: { id: '12345' },
        from: { id: 999 },
        photo: [
          { file_id: 'small-photo', width: 100, height: 100 },
          { file_id: 'large-photo', width: 800, height: 600 },
        ],
        caption: 'photo caption',
      },
    },
    { processInput, downloadFile },
  );

  await processTelegramUpdate(
    {
      message: {
        message_id: 21,
        chat: { id: '12345' },
        from: { id: 999, username: 'bermudi' },
        document: {
          file_id: 'doc-1',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
        },
        caption: 'document caption',
      },
    },
    { processInput, downloadFile },
  );

  await processTelegramUpdate(
    {
      message: {
        message_id: 22,
        chat: { id: '12345' },
        from: { id: 999 },
        animation: {
          file_id: 'anim-1',
          file_name: 'funny.gif',
          mime_type: 'image/gif',
        },
      },
    },
    { processInput, downloadFile },
  );

  expect(downloads.map(entry => entry.fileId)).toEqual(['large-photo', 'doc-1', 'anim-1']);
  expect(capturedInputs).toHaveLength(3);

  expect(capturedInputs[0]).toMatchObject({
    content: 'photo caption',
    visionInputs: [{ channelFileId: 'large-photo', localPath: expect.any(String), mimeType: 'image/jpeg' }],
    attachments: undefined,
  });

  expect(capturedInputs[1]).toMatchObject({
    content: 'document caption',
    attachments: [{ channelFileId: 'doc-1', filename: 'report.pdf', mimeType: 'application/pdf', localPath: expect.any(String), size: 1024 }],
    visionInputs: undefined,
  });

  expect(capturedInputs[2]).toMatchObject({
    content: '',
    attachments: [{ channelFileId: 'anim-1', filename: 'funny.gif', mimeType: 'image/gif', localPath: expect.any(String) }],
    visionInputs: undefined,
  });
});
