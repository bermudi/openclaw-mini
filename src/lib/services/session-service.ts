// OpenClaw Agent Runtime - Session Service
// Manage communication channel contexts and conversation history

import { db } from '@/lib/db';
import { ChannelType } from '@/lib/types';

export interface SessionContext {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    sender?: string;
    timestamp: string;
  }>;
  metadata: Record<string, unknown>;
}

class SessionService {
  /**
   * Get or create a session for a channel
   */
  async getOrCreateSession(
    agentId: string,
    channel: ChannelType,
    channelKey: string
  ): Promise<{ id: string; context: SessionContext }> {
    let session = await db.session.findUnique({
      where: {
        channel_channelKey: {
          channel,
          channelKey,
        },
      },
    });

    if (!session) {
      session = await db.session.create({
        data: {
          agentId,
          channel,
          channelKey,
          context: JSON.stringify({ messages: [], metadata: {} }),
        },
      });
    }

    return {
      id: session.id,
      context: this.parseContext(session.context),
    };
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<{ id: string; context: SessionContext } | null> {
    const session = await db.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) return null;

    return {
      id: session.id,
      context: this.parseContext(session.context),
    };
  }

  /**
   * Get session context as formatted string
   */
  async getSessionContext(sessionId: string): Promise<string> {
    const session = await this.getSession(sessionId);
    if (!session) return '';

    const messages = session.context.messages;
    if (messages.length === 0) return '';

    return messages.map(msg => {
      const sender = msg.sender ? ` (${msg.sender})` : '';
      return `${msg.role}${sender}: ${msg.content}`;
    }).join('\n\n');
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
    }
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const context = session.context;
    context.messages.push({
      ...message,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 50 messages to prevent context from growing too large
    if (context.messages.length > 50) {
      context.messages = context.messages.slice(-50);
    }

    await db.session.update({
      where: { id: sessionId },
      data: {
        context: JSON.stringify(context),
        lastActive: new Date(),
      },
    });
  }

  /**
   * Update session metadata
   */
  async updateMetadata(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const context = session.context;
    context.metadata = { ...context.metadata, ...metadata };

    await db.session.update({
      where: { id: sessionId },
      data: { context: JSON.stringify(context) },
    });
  }

  /**
   * Clear session history
   */
  async clearHistory(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const context = session.context;
    context.messages = [];

    await db.session.update({
      where: { id: sessionId },
      data: { context: JSON.stringify(context) },
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

    return sessions.map(session => {
      const context = this.parseContext(session.context);
      return {
        id: session.id,
        channel: session.channel,
        channelKey: session.channelKey,
        lastActive: session.lastActive,
        messageCount: context.messages.length,
      };
    });
  }

  /**
   * Parse context JSON
   */
  private parseContext(contextStr: string): SessionContext {
    try {
      return JSON.parse(contextStr);
    } catch {
      return { messages: [], metadata: {} };
    }
  }
}

export const sessionService = new SessionService();
