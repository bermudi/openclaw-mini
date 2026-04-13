// OpenClaw Agent Runtime - Input Manager
// Unified interface for processing diverse input types

import { db } from '@/lib/db';
import { taskQueue } from './task-queue';
import { agentService } from './agent-service';
import { 
  DeliveryTarget,
  Input, 
  MessageInput, 
  WebhookInput, 
  HookInput, 
  A2AInput,
  ChannelType,
} from '@/lib/types';

export interface ProcessInputResult {
  success: boolean;
  taskId?: string;
  sessionId?: string;
  error?: string;
}

class InputManagerService {
  /**
   * Process any input type and route to appropriate agent
   */
  async processInput(input: Input, targetAgentId?: string): Promise<ProcessInputResult> {
    switch (input.type) {
      case 'message':
        return this.processMessage(input, targetAgentId);
      case 'webhook':
        return this.processWebhook(input, targetAgentId);
      case 'hook':
        return this.processHook(input, targetAgentId);
      case 'a2a':
        return this.processA2A(input);
      default:
        return { success: false, error: 'Unknown input type' };
    }
  }

  /**
   * Process message input from messaging platforms
   */
  private async processMessage(input: MessageInput, targetAgentId?: string): Promise<ProcessInputResult> {
    let resolvedAgentId = targetAgentId;
    if (!resolvedAgentId) {
      const resolved = await this.resolveAgent(input.channel, input.channelKey);
      if (!resolved.agentId) {
        return { success: false, error: resolved.error ?? 'No default agent configured' };
      }
      resolvedAgentId = resolved.agentId;
    }

    const agent = await agentService.getAgent(resolvedAgentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    if (agent.status === 'disabled') {
      return { success: false, error: 'Agent is disabled' };
    }

    // Find or create session
    const session = await this.getOrCreateSession(
      resolvedAgentId,
      'main',
      input.channel,
      input.channelKey
    );

    // Update session activity
    await db.session.update({
      where: { id: session.id },
      data: { lastActive: new Date() },
    });

    const deliveryTarget: DeliveryTarget = input.deliveryTarget ?? {
      channel: input.channel,
      channelKey: input.channelKey,
      metadata: {},
    };

    // Create task
    const task = await taskQueue.createTask({
      agentId: resolvedAgentId,
      sessionId: session.id,
      type: 'message',
      priority: 3, // Messages have higher priority
      payload: {
        content: input.content,
        sender: input.sender,
        channel: input.channel,
        channelKey: input.channelKey,
        deliveryTarget,
        metadata: input.metadata,
        attachments: input.attachments,
        visionInputs: input.visionInputs,
      },
      source: `${input.channel}:${input.channelKey}`,
    });

    return { success: true, taskId: task.id, sessionId: session.id };
  }

  /**
   * Process webhook input
   */
  private async processWebhook(input: WebhookInput, targetAgentId?: string): Promise<ProcessInputResult> {
    let resolvedAgentId = targetAgentId;
    if (!resolvedAgentId) {
      const resolved = await this.resolveAgent('webhook', input.source);
      if (!resolved.agentId) {
        return { success: false, error: resolved.error ?? 'No default agent configured' };
      }
      resolvedAgentId = resolved.agentId;
    }

    const agent = await agentService.getAgent(resolvedAgentId);
    if (!agent || agent.status === 'disabled') {
      return { success: false, error: 'Agent not found or disabled' };
    }

    // Log the webhook after validating the agent
    const webhookLog = await db.webhookLog.create({
      data: {
        source: input.source,
        payload: JSON.stringify(input.payload),
        processed: false,
      },
    });

    // Create task
    const task = await taskQueue.createTask({
      agentId: resolvedAgentId,
      type: 'webhook',
      priority: 4,
      payload: {
        source: input.source,
        payload: input.payload,
        headers: input.headers,
        webhookLogId: webhookLog.id,
      },
      source: `webhook:${input.source}`,
    });

    // Mark webhook as processed
    await db.webhookLog.update({
      where: { id: webhookLog.id },
      data: { processed: true, taskId: task.id },
    });

    return { success: true, taskId: task.id };
  }

  /**
   * Process internal hook
   */
  async processHook(input: HookInput, targetAgentId?: string): Promise<ProcessInputResult> {
    let resolvedAgentId = targetAgentId;
    if (!resolvedAgentId) {
      const resolved = await this.resolveAgent('internal', input.event);
      if (!resolved.agentId) {
        return { success: false, error: resolved.error ?? 'No default agent configured' };
      }
      resolvedAgentId = resolved.agentId;
    }

    const agent = await agentService.getAgent(resolvedAgentId);
    if (!agent || agent.status === 'disabled') {
      return { success: false, error: 'Agent not found or disabled' };
    }

    const task = await taskQueue.createTask({
      agentId: resolvedAgentId,
      type: 'hook',
      priority: 2, // Hooks have high priority
      payload: {
        event: input.event,
        data: input.data,
      },
      source: `hook:${input.event}`,
    });

    return { success: true, taskId: task.id };
  }

  /**
   * Process agent-to-agent message
   */
  private async processA2A(input: A2AInput): Promise<ProcessInputResult> {
    const targetAgent = await agentService.getAgent(input.toAgentId);
    if (!targetAgent) {
      return { success: false, error: 'Target agent not found' };
    }

    if (targetAgent.status === 'disabled') {
      return { success: false, error: 'Target agent is disabled' };
    }

    const task = await taskQueue.createTask({
      agentId: input.toAgentId,
      type: 'a2a',
      priority: 4,
      payload: {
        fromAgentId: input.fromAgentId,
        message: input.message,
        data: input.data,
      },
      source: `agent:${input.fromAgentId}`,
    });

    return { success: true, taskId: task.id };
  }

  /**
   * Resolve agent by channel binding with default fallback
   */
  private async resolveAgent(
    channel: ChannelType,
    channelKey: string
  ): Promise<{ agentId?: string; error?: string }> {
    const exact = await db.channelBinding.findFirst({
      where: { channel, channelKey },
    });

    if (exact) {
      return { agentId: exact.agentId };
    }

    const wildcard = await db.channelBinding.findFirst({
      where: { channel, channelKey: '*' },
    });

    if (wildcard) {
      return { agentId: wildcard.agentId };
    }

    const defaultAgent = await agentService.getDefaultAgent();
    if (defaultAgent && defaultAgent.status !== 'disabled') {
      return { agentId: defaultAgent.id };
    }

    const fallbackAgent = await agentService.getFallbackRoutingAgent();
    if (fallbackAgent) {
      console.warn(`[InputManager] Routing ${channel}:${channelKey} to fallback agent '${fallbackAgent.id}' because no explicit default agent is configured`);
      return { agentId: fallbackAgent.id };
    }

    const usableAgents = await agentService.getUsableAgents();
    if (usableAgents.length > 1) {
      return { error: 'No default agent configured; multiple usable agents exist, so automatic routing is ambiguous' };
    }

    return { error: 'No default agent configured' };
  }

  /**
   * Get or create a session for a channel
   */
  private async getOrCreateSession(
    agentId: string,
    sessionScope: string,
    channel: ChannelType,
    channelKey: string
  ): Promise<{ id: string }> {
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

    return session;
  }

}

export const inputManager = new InputManagerService();
