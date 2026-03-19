// OpenClaw Agent Runtime - Session Service
// Manage communication channel contexts and conversation history

import { generateText } from 'ai';
import { db } from '@/lib/db';
import { ChannelType } from '@/lib/types';
import { memoryService } from './memory-service';
import { getLanguageModel } from './model-provider';

export interface SessionContext {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    sender?: string;
    channel?: ChannelType;
    channelKey?: string;
    timestamp: string;
  }>;
  metadata: Record<string, unknown>;
}

export interface CompactSessionResult {
  summarized: number;
  remaining: number;
}

type StoredSessionMessage = {
  id: string;
  role: string;
  content: string;
  sender: string | null;
  channel: string | null;
  channelKey: string | null;
  createdAt: Date;
};

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class SessionService {
  private readonly compactingSessions = new Map<string, Promise<CompactSessionResult>>();

  /**
   * Get or create a session for a channel
   */
  async getOrCreateSession(
    agentId: string,
    sessionScope: string,
    channel: ChannelType,
    channelKey: string
  ): Promise<{ id: string; context: SessionContext }> {
    let session = await db.session.findUnique({
      where: {
        agentId_sessionScope: {
          agentId,
          sessionScope,
        }
      },
    });

    if (!session) {
      session = await db.session.create({
        data: {
          agentId,
          channel,
          channelKey,
          sessionScope,
        },
      });
    }

    const messages = await this.getSessionMessages(session.id);

    return {
      id: session.id,
      context: { messages, metadata: {} },
    };
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<{ id: string; context: SessionContext } | null> {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });

    if (!session) return null;

    const messages = await this.getSessionMessages(sessionId);

    return {
      id: session.id,
      context: { messages, metadata: {} },
    };
  }

  async getSessionMessages(sessionId: string): Promise<SessionContext['messages']> {
    const messages = await db.sessionMessage.findMany({
      where: { sessionId },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    return messages.map(message => this.mapSessionMessage(message));
  }

  /**
   * Get session context as formatted string
   */
  async getSessionContext(sessionId: string): Promise<string> {
    const messages = await this.getSessionMessages(sessionId);
    if (messages.length === 0) return '';

    return messages.map(message => this.formatMessage(message, false)).join('\n\n');
  }

  /**
   * Append a message to session context
   */
  async appendToContext(
    sessionId: string,
    message: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      sender?: string;
      channel?: ChannelType;
      channelKey?: string;
    }
  ): Promise<void> {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) return;

    const createdAt = new Date();

    await db.$transaction(async (tx) => {
      await tx.sessionMessage.create({
        data: {
          sessionId,
          role: message.role,
          content: message.content,
          sender: message.sender,
          channel: message.channel,
          channelKey: message.channelKey,
          createdAt,
        },
      });

      await tx.session.update({
        where: { id: sessionId },
        data: { lastActive: createdAt },
      });
    });

    const threshold = getPositiveIntegerEnv('OPENCLAW_SESSION_COMPACTION_THRESHOLD', 40);
    const messageCount = await db.sessionMessage.count({ where: { sessionId } });
    if (messageCount > threshold) {
      try {
        await this.compactSession(sessionId);
      } catch (error) {
        console.error(`[SessionService] Failed to compact session ${sessionId}:`, error);
      }
    }
  }

  /**
   * Update session metadata
   */
  async updateMetadata(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { context: true },
    });
    if (!session) return;

    const parsedContext = this.parseContext(session.context);
    parsedContext.metadata = { ...parsedContext.metadata, ...metadata };

    await db.session.update({
      where: { id: sessionId },
      data: { context: JSON.stringify(parsedContext) },
    });
  }

  /**
   * Clear session history
   */
  async clearHistory(sessionId: string): Promise<void> {
    await db.$transaction(async (tx) => {
      await tx.sessionMessage.deleteMany({
        where: { sessionId },
      });

      await tx.session.update({
        where: { id: sessionId },
        data: { lastActive: new Date() },
      });
    });
  }

  /**
   * Delete old inactive sessions
   */
  async cleanupOldSessions(daysOld: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await db.session.deleteMany({
      where: {
        lastActive: { lt: cutoff },
      },
    });

    return result.count;
  }

  /**
   * Delete a session by ID
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });

    if (!session) {
      return false;
    }

    await db.session.delete({
      where: { id: sessionId },
    });

    return true;
  }

  /**
   * Get all sessions for an agent
   */
  async getAgentSessions(agentId: string): Promise<Array<{
    id: string;
    channel: string;
    channelKey: string;
    lastActive: Date;
    messageCount: number;
  }>> {
    const sessions = await db.session.findMany({
      where: { agentId },
      orderBy: { lastActive: 'desc' },
    });

    const messageCountEntries = await Promise.all(
      sessions.map(async (session) => {
        const count = await db.sessionMessage.count({
          where: { sessionId: session.id },
        });
        return [session.id, count] as const;
      }),
    );

    const messageCountBySessionId = new Map<string, number>(messageCountEntries);

    return sessions.map(session => ({
      id: session.id,
      channel: session.channel,
      channelKey: session.channelKey,
      lastActive: session.lastActive,
      messageCount: messageCountBySessionId.get(session.id) ?? 0,
    }));
  }

  async compactSession(
    sessionId: string,
    options?: {
      force?: boolean;
      retainCount?: number;
      threshold?: number;
    },
  ): Promise<CompactSessionResult> {
    const inFlight = this.compactingSessions.get(sessionId);
    if (inFlight) {
      return inFlight;
    }

    const compaction = this.compactSessionInternal(sessionId, options)
      .finally(() => {
        this.compactingSessions.delete(sessionId);
      });

    this.compactingSessions.set(sessionId, compaction);
    return compaction;
  }

  /**
   * Parse context JSON
   */
  private parseContext(contextStr: string): SessionContext {
    try {
      return JSON.parse(contextStr) as SessionContext;
    } catch {
      return { messages: [], metadata: {} };
    }
  }

  private async compactSessionInternal(
    sessionId: string,
    options?: {
      force?: boolean;
      retainCount?: number;
      threshold?: number;
    },
  ): Promise<CompactSessionResult> {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { id: true, agentId: true },
    });

    if (!session) {
      return { summarized: 0, remaining: 0 };
    }

    const retainCount = options?.retainCount ?? getPositiveIntegerEnv('OPENCLAW_SESSION_RETAIN_COUNT', 10);
    const threshold = options?.threshold ?? getPositiveIntegerEnv('OPENCLAW_SESSION_COMPACTION_THRESHOLD', 40);
    const snapshot = await db.sessionMessage.findMany({
      where: { sessionId },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    if (snapshot.length <= retainCount) {
      return { summarized: 0, remaining: snapshot.length };
    }

    if (!options?.force && snapshot.length <= threshold) {
      return { summarized: 0, remaining: snapshot.length };
    }

    const summarizeCount = snapshot.length - retainCount;
    const messagesToSummarize = snapshot.slice(0, summarizeCount);
    if (messagesToSummarize.length === 0) {
      return { summarized: 0, remaining: snapshot.length };
    }

    const historyDump = messagesToSummarize
      .map(message => this.formatMessage(this.mapSessionMessage(message), true))
      .join('\n\n');

    const summary = await generateText({
      model: getLanguageModel(),
      system: 'Summarize the earlier conversation faithfully. Preserve requests, decisions, commitments, unresolved items, and important facts. Respond with concise plain text.',
      prompt: historyDump,
    });

    const summaryText = summary.text.trim();
    const summaryContent = summaryText.length > 0
      ? `[Session Summary] ${summaryText}`
      : '[Session Summary] Summary unavailable.';

    await memoryService.appendHistory(session.agentId, historyDump);

    await db.$transaction(async (tx) => {
      await tx.sessionMessage.deleteMany({
        where: {
          id: {
            in: messagesToSummarize.map(message => message.id),
          },
        },
      });

      await tx.sessionMessage.create({
        data: {
          sessionId,
          role: 'system',
          content: summaryContent,
          createdAt: messagesToSummarize[0]!.createdAt,
        },
      });
    });

    const remaining = await db.sessionMessage.count({ where: { sessionId } });
    return {
      summarized: messagesToSummarize.length,
      remaining,
    };
  }

  private mapSessionMessage(message: StoredSessionMessage): SessionContext['messages'][number] {
    return {
      role: message.role as 'user' | 'assistant' | 'system',
      content: message.content,
      sender: message.sender ?? undefined,
      channel: (message.channel as ChannelType | null) ?? undefined,
      channelKey: message.channelKey ?? undefined,
      timestamp: message.createdAt.toISOString(),
    };
  }

  private formatMessage(
    message: SessionContext['messages'][number],
    includeTimestamp: boolean,
  ): string {
    const sender = message.sender ? ` (${message.sender})` : '';
    const channelTag = message.channel
      ? ` [${message.channel}${message.channelKey ? `:${message.channelKey}` : ''}]`
      : '';
    const timestamp = includeTimestamp ? ` @ ${message.timestamp}` : '';
    return `${message.role}${sender}${channelTag}${timestamp}: ${message.content}`;
  }
}

export const sessionService = new SessionService();
