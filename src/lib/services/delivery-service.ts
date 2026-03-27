import { Prisma, PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import type { ChannelAdapter, ChannelType, DeliveryTarget } from '@/lib/types';
import { isRetryableTelegramError } from '@/lib/adapters/telegram-adapter';
import { getRuntimeConfig } from '@/lib/config/runtime';

type DeliveryRecord = {
  id: string;
  channel: string;
  targetJson: string;
  text: string;
  deliveryType?: string;
  filePath?: string | null;
  attempts: number;
};

type DeliveryModel = {
  create(args: {
    data: {
      taskId: string;
      channel: string;
      channelKey: string;
      targetJson: string;
      text: string;
      status: string;
      dedupeKey: string;
      deliveryType?: string;
      filePath?: string | null;
    };
  }): Promise<unknown>;
  findMany(args: {
    where: {
      status: string;
      OR: Array<{ nextAttemptAt: null } | { nextAttemptAt: { lte: Date } }>;
    };
    orderBy: { createdAt: 'asc' | 'desc' };
    take: number;
  }): Promise<DeliveryRecord[]>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
};

type DbClient = PrismaClient | Prisma.TransactionClient;
type DeliveryClient = DbClient & { outboundDelivery: DeliveryModel };

type DispatchOutcome = 'sent' | 'failed' | 'retried';

export interface DeliveryProcessingStats {
  processed: number;
  sent: number;
  failed: number;
  retried: number;
}

const adapters = new Map<ChannelType, ChannelAdapter>();

export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function getAdapter(channel: ChannelType): ChannelAdapter | undefined {
  return adapters.get(channel);
}

export function resetAdaptersForTests(): void {
  adapters.clear();
}

export async function enqueueDelivery(
  taskId: string,
  channel: ChannelType,
  channelKey: string,
  targetJson: string,
  text: string,
  dedupeKey: string,
): Promise<void> {
  await enqueueDeliveryTx(db, taskId, channel, channelKey, targetJson, text, dedupeKey);
}

export async function enqueueDeliveryTx(
  tx: DbClient,
  taskId: string,
  channel: ChannelType,
  channelKey: string,
  targetJson: string,
  text: string,
  dedupeKey: string,
): Promise<void> {
  try {
    await getDeliveryModel(tx).create({
      data: {
        taskId,
        channel,
        channelKey,
        targetJson,
        text,
        status: 'pending',
        dedupeKey,
        deliveryType: 'text',
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return;
    }

    throw error;
  }
}

export async function enqueueFileDeliveryTx(
  tx: DbClient,
  taskId: string,
  channel: ChannelType,
  channelKey: string,
  targetJson: string,
  filePath: string,
  caption: string,
  dedupeKey: string,
): Promise<void> {
  try {
    await getDeliveryModel(tx).create({
      data: {
        taskId,
        channel,
        channelKey,
        targetJson,
        text: caption,
        status: 'pending',
        dedupeKey,
        deliveryType: 'file',
        filePath,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return;
    }

    throw error;
  }
}

export async function processPendingDeliveries(): Promise<DeliveryProcessingStats> {
  const now = new Date();
  const deliveries = await getDeliveryModel(db).findMany({
    where: {
      status: 'pending',
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: getRuntimeConfig().performance.deliveryBatchSize,
  });

  const stats: DeliveryProcessingStats = {
    processed: deliveries.length,
    sent: 0,
    failed: 0,
    retried: 0,
  };

  for (const delivery of deliveries) {
    const outcome = await dispatchDelivery(delivery);

    if (outcome === 'sent') {
      stats.sent += 1;
      continue;
    }

    if (outcome === 'failed') {
      stats.failed += 1;
      continue;
    }

    stats.retried += 1;
  }

  return stats;
}

export async function dispatchDelivery(delivery: DeliveryRecord): Promise<DispatchOutcome> {
  const adapter = getAdapter(delivery.channel as ChannelType);

  if (!adapter) {
    await markDeliveryFailed(delivery.id, `No adapter registered for channel: ${delivery.channel}`);
    return 'failed';
  }

  let target: DeliveryTarget;

  try {
    target = parseDeliveryTarget(delivery.targetJson);
  } catch (error) {
    await markDeliveryFailed(delivery.id, getErrorMessage(error));
    return 'failed';
  }

  if (adapter.isConnected?.() === false) {
    const attempts = delivery.attempts + 1;
    await getDeliveryModel(db).update({
      where: { id: delivery.id },
      data: {
        attempts,
        nextAttemptAt: calculateNextAttemptAt(attempts),
        lastError: `Adapter for channel ${delivery.channel} is not connected`,
      },
    });
    return 'retried';
  }

  try {
    if ((delivery.deliveryType ?? 'text') === 'file' && delivery.filePath) {
      if (!adapter.sendFile) {
        await markDeliveryFailed(delivery.id, `Channel adapter ${delivery.channel} does not support file delivery`);
        return 'failed';
      }
      const result = await adapter.sendFile(target, delivery.filePath, { caption: delivery.text });
      await getDeliveryModel(db).update({
        where: { id: delivery.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          externalMessageId: result.externalMessageId ?? null,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      return 'sent';
    }

    const result = await adapter.sendText(target, delivery.text);
    await getDeliveryModel(db).update({
      where: { id: delivery.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        externalMessageId: result.externalMessageId ?? null,
        lastError: null,
        nextAttemptAt: null,
      },
    });
    return 'sent';
  } catch (error) {
    const attempts = delivery.attempts + 1;
    const retryable = isRetryableDeliveryError(delivery.channel as ChannelType, error);

    if (!retryable || attempts >= getRuntimeConfig().safety.maxDeliveryRetries) {
      await markDeliveryFailed(delivery.id, getErrorMessage(error), attempts);
      return 'failed';
    }

    await getDeliveryModel(db).update({
      where: { id: delivery.id },
      data: {
        attempts,
        nextAttemptAt: calculateNextAttemptAt(attempts),
        lastError: getErrorMessage(error),
      },
    });
    return 'retried';
  }
}

function parseDeliveryTarget(targetJson: string): DeliveryTarget {
  const parsed = JSON.parse(targetJson) as DeliveryTarget;

  if (!parsed || typeof parsed !== 'object' || !parsed.channel || !parsed.channelKey || !parsed.metadata) {
    throw new Error('Invalid delivery target');
  }

  return parsed;
}

function isRetryableDeliveryError(channel: ChannelType, error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'retryable' in error) {
    const retryable = (error as { retryable?: unknown }).retryable;
    if (typeof retryable === 'boolean') {
      return retryable;
    }
  }

  if (channel === 'telegram') {
    return isRetryableTelegramError(error);
  }

  return true;
}

function calculateNextAttemptAt(attempt: number): Date {
  return new Date(Date.now() + attempt ** 3 * 2_000);
}

async function markDeliveryFailed(id: string, lastError: string, attempts?: number): Promise<void> {
  await getDeliveryModel(db).update({
    where: { id },
    data: {
      status: 'failed',
      attempts,
      lastError,
      nextAttemptAt: null,
    },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true;
  }

  return error instanceof Error && /Unique constraint failed on the fields:\s*\(`dedupeKey`\)/.test(error.message);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown delivery error';
}

 function getDeliveryModel(client: DbClient): DeliveryModel {
  return (client as DeliveryClient).outboundDelivery;
 }
