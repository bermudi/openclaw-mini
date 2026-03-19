import type { PrismaClient } from '@prisma/client';
import type { ChannelType } from '@/lib/types';

type Logger = {
  warn: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
};

type LegacySessionMessage = {
  role?: unknown;
  content?: unknown;
  sender?: unknown;
  channel?: unknown;
  channelKey?: unknown;
  timestamp?: unknown;
};

export interface SessionContextMigrationResult {
  sessionsProcessed: number;
  sessionsSkipped: number;
  messagesInserted: number;
  malformedSessions: string[];
}

function isChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && ['slack', 'discord', 'whatsapp', 'telegram', 'imessage', 'webhook', 'internal'].includes(value);
}

function parseLegacyMessages(context: string): LegacySessionMessage[] | null {
  try {
    const parsed = JSON.parse(context) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'messages' in parsed
      && Array.isArray((parsed as { messages?: unknown }).messages)
    ) {
      return (parsed as { messages: LegacySessionMessage[] }).messages;
    }
    return [];
  } catch {
    return null;
  }
}

function normalizeMessage(sessionId: string, message: LegacySessionMessage, fallbackDate: Date) {
  if (typeof message.role !== 'string' || typeof message.content !== 'string') {
    throw new Error(`Session ${sessionId} contains a message without string role/content`);
  }

  const timestamp = typeof message.timestamp === 'string' ? new Date(message.timestamp) : fallbackDate;
  const createdAt = Number.isNaN(timestamp.getTime()) ? fallbackDate : timestamp;

  return {
    sessionId,
    role: message.role,
    content: message.content,
    sender: typeof message.sender === 'string' ? message.sender : null,
    channel: isChannelType(message.channel) ? message.channel : null,
    channelKey: typeof message.channelKey === 'string' ? message.channelKey : null,
    createdAt,
  };
}

export async function migrateSessionContextToMessages(
  client: PrismaClient,
  logger: Logger = console,
): Promise<SessionContextMigrationResult> {
  const sessions = await client.session.findMany({
    select: {
      id: true,
      context: true,
      createdAt: true,
    },
  });

  let sessionsSkipped = 0;
  let messagesInserted = 0;
  const malformedSessions: string[] = [];

  for (const session of sessions) {
    const existingCount = await client.sessionMessage.count({
      where: { sessionId: session.id },
    });
    if (existingCount > 0) {
      sessionsSkipped += 1;
      continue;
    }

    const parsedMessages = parseLegacyMessages(session.context);
    if (parsedMessages === null) {
      malformedSessions.push(session.id);
      logger.warn(`[session-context-migration] Skipping malformed session context for ${session.id}`);
      continue;
    }

    if (parsedMessages.length === 0) {
      continue;
    }

    const rows = parsedMessages.map(message => normalizeMessage(session.id, message, session.createdAt));
    await client.sessionMessage.createMany({ data: rows });
    messagesInserted += rows.length;
  }

  return {
    sessionsProcessed: sessions.length,
    sessionsSkipped,
    messagesInserted,
    malformedSessions,
  };
}
