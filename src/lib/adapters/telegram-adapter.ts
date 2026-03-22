import { Bot, GrammyError, HttpError } from 'grammy';
import type { ChannelAdapter, DeliveryTarget } from '@/lib/types';

const TELEGRAM_MESSAGE_LIMIT = 4096;

export interface TelegramErrorClassification {
  retryable: boolean;
  statusCode?: number;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = 'telegram' as const;
  private readonly bot: Bot;
  private connected = false;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  async start(): Promise<void> {
    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendText(target: DeliveryTarget, text: string): Promise<{ externalMessageId?: string }> {
    const chatId = target.metadata.chatId ?? target.channelKey;

    if (!chatId) {
      throw new Error('Telegram delivery target is missing chatId');
    }

    const parts = splitTelegramMessage(text);
    let externalMessageId: string | undefined;

    for (const part of parts) {
      const response = await this.bot.api.sendMessage(chatId, part, {
        message_thread_id: parseOptionalInteger(target.metadata.threadId),
        reply_parameters: target.metadata.replyToMessageId
          ? { message_id: parseRequiredInteger(target.metadata.replyToMessageId, 'replyToMessageId') }
          : undefined,
      });
      externalMessageId = response.message_id.toString();
    }

    return { externalMessageId };
  }
}

export function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [text];
  }

  const parts: string[] = [];

  for (let start = 0; start < text.length; start += TELEGRAM_MESSAGE_LIMIT) {
    parts.push(text.slice(start, start + TELEGRAM_MESSAGE_LIMIT));
  }

  return parts;
}

export function classifyTelegramError(error: unknown): TelegramErrorClassification {
  if (error instanceof HttpError) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout') || message.includes('timed out')) {
      return { retryable: true };
    }

    return { retryable: true };
  }

  if (error instanceof GrammyError) {
    const statusCode = error.error_code;

    if (statusCode === 429 || statusCode >= 500) {
      return { retryable: true, statusCode };
    }

    if (statusCode === 400 || statusCode === 403 || statusCode === 404) {
      return { retryable: false, statusCode };
    }

    return { retryable: false, statusCode };
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout') || message.includes('timed out') || message.includes('network')) {
      return { retryable: true };
    }
  }

  return { retryable: false };
}

export function isRetryableTelegramError(error: unknown): boolean {
  return classifyTelegramError(error).retryable;
}

function parseOptionalInteger(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  return parseRequiredInteger(value, 'numeric metadata');
}

function parseRequiredInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Telegram ${label} must be a numeric string`);
  }

  return parsed;
}
