// OpenClaw Agent Runtime - Session Service
// Manage communication channel contexts and conversation history

import { generateText } from 'ai';
import { db } from '@/lib/db';
import { AsyncTaskRecord, ChannelType } from '@/lib/types';
import { parseAsyncTaskRegistry, serializeAsyncTaskRegistry, type AsyncTaskRecordValidated } from '@/lib/storage-boundary';
import { countTokens } from '@/lib/utils/token-counter';
import { memoryService } from './memory-service';
import { reflectOnContent } from './memory-reflector';
import { eventBus } from './event-bus';
import { resolveAgentContextWindow, resolveCompactionThreshold, runWithModelFallback } from './model-provider';
import { auditService } from './audit-service';
import { getSessionConfig } from '@/lib/config/runtime';

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

type SessionAgentConfig = {
  id: string;
  model: string | null;
  contextWindowOverride: number | null;
  compactionThreshold: number | null;
};

function normalizeSessionAgentConfig(agent: { id: string } & Record<string, unknown>): SessionAgentConfig {
  const model = typeof agent.model === 'string' ? agent.model : null;
  const contextWindowOverride = typeof agent.contextWindowOverride === 'number'
    ? agent.contextWindowOverride
    : null;
  const compactionThreshold = typeof agent.compactionThreshold === 'number'
    ? agent.compactionThreshold
    : null;

  return {
    id: agent.id,
    model,
    contextWindowOverride,
    compactionThreshold,
  };
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
    // Input validation
    if (!agentId || agentId.trim().length === 0) {
      throw new Error('agentId must be non-empty');
    }
    if (!sessionScope || sessionScope.trim().length === 0) {
      throw new Error('sessionScope must be non-empty');
    }
    if (!channelKey || channelKey.trim().length === 0) {
      throw new Error('channelKey must be non-empty');
    }
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
      void eventBus.emit('session:created', { sessionId: session.id, agentId, channel, channelKey });
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
    // Input validation
    if (!message.content || message.content.length === 0) {
      throw new Error('Message content must be non-empty');
    }
    if (message.content.length > 100000) {
      throw new Error(`Message content exceeds maximum length of 100000 characters (got ${message.content.length})`);
    }

    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        agentId: true,
      },
    });
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const rawAgent = await db.agent.findUnique({
      where: { id: session.agentId },
    });
    if (!rawAgent) {
      throw new Error(`Agent not found for session ${sessionId}`);
    }

    const agentConfig = normalizeSessionAgentConfig(rawAgent as { id: string } & Record<string, unknown>);

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

    const shouldCompact = await this.shouldCompact(sessionId, agentConfig, message.role);
    if (shouldCompact) {
      try {
        await this.compactSession(sessionId, { force: true });
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
    void sessionId;
    void metadata;
    throw new Error('Session metadata updates are no longer supported because Session.context is reserved for legacy migration only.');
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

    if (result.count > 0) {
      void auditService.log({
        action: 'sessions_cleaned',
        entityType: 'session',
        entityId: 'batch',
        details: { count: result.count, cutoffDate: cutoff.toISOString() },
        severity: 'info',
      });
    }

    return result.count;
  }

  /**
   * Read the async task registry for a session.
   * Returns an empty map if the column is null or unparseable.
   */
  async getAsyncTaskRegistry(sessionId: string): Promise<Map<string, AsyncTaskRecord>> {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { asyncTaskRegistry: true },
    });
    if (!session?.asyncTaskRegistry) {
      return new Map();
    }
    try {
      return parseAsyncTaskRegistry(session.asyncTaskRegistry) as Map<string, AsyncTaskRecord>;
    } catch (error) {
      console.warn(`[SessionService] Failed to parse async task registry for session ${sessionId}:`, error instanceof Error ? error.message : error);
      return new Map();
    }
  }

  /**
   * Persist the async task registry for a session.
   */
  async setAsyncTaskRegistry(sessionId: string, registry: Map<string, AsyncTaskRecord>): Promise<void> {
    await db.session.update({
      where: { id: sessionId },
      data: { asyncTaskRegistry: serializeAsyncTaskRegistry(registry as Map<string, AsyncTaskRecordValidated>) },
    });
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

    void auditService.log({
      action: 'session_deleted',
      entityType: 'session',
      entityId: sessionId,
      details: { sessionId },
      severity: 'info',
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

    const retainCount = options?.retainCount ?? getSessionConfig().retainCount;
    const threshold = options?.threshold ?? getSessionConfig().compactionThreshold;

    // Input validation
    if (retainCount <= 0) {
      throw new Error('retainCount must be a positive integer');
    }
    if (threshold <= 0) {
      throw new Error('threshold must be a positive integer');
    }
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

    let summaryText: string;
    let usedModel = '';
    try {
      const summary = await runWithModelFallback(({ model, config }) => {
        usedModel = `${config.provider}/${config.model}`;
        return generateText({
          model,
          system: 'You are summarizing a conversation session. The summary will replace the full message history as the agent\'s working memory. Produce a structured summary with these sections:\n\n1. Session Intent: What the user is trying to accomplish\n2. Key Decisions: Choices made or confirmed\n3. Artifacts: Files, configurations, or outputs created\n4. Open Questions: Unresolved items\n5. Next Steps: What the agent should do next\n\nRespond with concise plain text. Include all sections that are relevant; omit any that are not applicable.',
          prompt: historyDump,
        });
      });
      summaryText = summary.text.trim();
    } catch (error) {
      console.warn(
        `[SessionService] Compaction LLM call failed for session ${sessionId}, agent ${session.agentId}:`,
        error instanceof Error ? error.message : error,
      );
      void auditService.log({
        action: 'session_compaction_failed',
        entityType: 'session',
        entityId: sessionId,
        details: { sessionId, agentId: session.agentId, error: error instanceof Error ? error.message : String(error), reason: 'llm_call_failed' },
        severity: 'warning',
      });
      return { summarized: 0, remaining: snapshot.length };
    }

    if (!summaryText) {
      console.warn(
        `[SessionService] Compaction LLM returned empty response for session ${sessionId}, agent ${session.agentId}. Aborting compaction.`,
      );
      void auditService.log({
        action: 'session_compaction_failed',
        entityType: 'session',
        entityId: sessionId,
        details: { sessionId, agentId: session.agentId, reason: 'empty_llm_response' },
        severity: 'warning',
      });
      return { summarized: 0, remaining: snapshot.length };
    }

    const summaryContent = `[Session Summary] ${summaryText}`;

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

    void auditService.log({
      action: 'session_compacted',
      entityType: 'session',
      entityId: sessionId,
      details: { sessionId, agentId: session.agentId, summarized: messagesToSummarize.length, remaining, model: usedModel },
      severity: 'info',
    });

    const compactionResult = {
      summarized: messagesToSummarize.length,
      remaining,
    };

    reflectOnContent(session.agentId, summaryText).catch((error) => {
      console.error('[SessionService] Memory reflector failed after compaction:', error);
    });

    return compactionResult;
  }

  private async shouldCompact(
    sessionId: string,
    agent: SessionAgentConfig,
    appendedRole: 'user' | 'assistant' | 'system',
  ): Promise<boolean> {
    if (appendedRole !== 'user') {
      return false;
    }

    const messageCountThreshold = getSessionConfig().compactionThreshold;
    const messageCount = await db.sessionMessage.count({ where: { sessionId } });

    try {
      const snapshot = await db.sessionMessage.findMany({
        where: { sessionId },
        select: { content: true },
        orderBy: [
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
      });
      const sessionText = snapshot.map(message => message.content).join('\n\n');
      const sessionTokens = countTokens(sessionText);
      const contextWindow = await resolveAgentContextWindow(agent);
      const compactionThreshold = resolveCompactionThreshold(agent);

      if (sessionTokens > contextWindow * compactionThreshold) {
        return true;
      }

      return messageCount > messageCountThreshold;
    } catch (error) {
      console.warn(`[SessionService] Token-based compaction evaluation failed for session ${sessionId}; falling back to message-count threshold.`, error);
      return messageCount > messageCountThreshold;
    }
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
