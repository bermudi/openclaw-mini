// OpenClaw Agent Runtime - Agent Executor
// Execute tasks using AI integration with tool support

import { generateText, stepCountIs } from 'ai';
import { taskQueue } from './task-queue';
import { agentService } from './agent-service';
import { memoryService } from './memory-service';
import { sessionService } from './session-service';
import { auditService } from './audit-service';
import { getLanguageModel } from './model-provider';
import { Task } from '@/lib/types';
import { getToolsForAgent, type ToolResult } from '@/lib/tools';

export interface ExecutionResult {
  success: boolean;
  response?: string;
  actions?: Record<string, unknown>[];
  toolCalls?: Array<{ tool: string; params: Record<string, unknown>; result: ToolResult }>;
  error?: string;
}

class AgentExecutorService {
  /**
   * Execute a task with tool support
   */
  async executeTask(taskId: string): Promise<ExecutionResult> {
    // Get task
    const task = await taskQueue.getTask(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Get agent
    const agent = await agentService.getAgent(task.agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Check if agent can accept tasks
    if (agent.status === 'disabled') {
      return { success: false, error: 'Agent is disabled' };
    }

    // Start task
    await taskQueue.startTask(taskId);
    await agentService.setAgentStatus(task.agentId, 'busy');

    // Log audit event
    await auditService.log({
      action: 'task_started',
      entityType: 'task',
      entityId: taskId,
      details: { agentId: task.agentId, type: task.type },
    });

    try {
      // Load agent context
      const context = await memoryService.loadAgentContext(task.agentId);

      // Load session context if available
      let sessionContext = '';
      if (task.sessionId) {
        sessionContext = await sessionService.getSessionContext(task.sessionId);
      }

      // Get available tools for this agent
      const tools = getToolsForAgent(agent.skills);

      // Build prompt based on task type
      const prompt = this.buildPrompt(task, context, sessionContext);

      // Execute with AI SDK
      const result = await generateText({
        model: getLanguageModel(),
        system: this.getSystemPrompt(agent, task),
        prompt,
        tools,
        stopWhen: stepCountIs(5),
      });

      const response = result.text;
      const toolCalls = result.steps.flatMap(step => step.toolCalls ?? []);
      const toolResults = result.steps.flatMap(step => step.toolResults ?? []);
      const toolResultMap = new Map(toolResults.map(toolResult => [toolResult.toolCallId, toolResult]));

      const executionToolCalls: ExecutionResult['toolCalls'] = toolCalls.map((toolCall) => {
        const toolResult = toolResultMap.get(toolCall.toolCallId);
        return {
          tool: toolCall.toolName,
          params: toolCall.input as Record<string, unknown>,
          result:
            (toolResult?.output as ToolResult | undefined) ??
            ({ success: false, error: 'Tool result missing' } satisfies ToolResult),
        };
      });

      const actions: Record<string, unknown>[] = toolResults.map((toolResult) => ({
        type: 'tool_call',
        tool: toolResult.toolName,
        success: (toolResult.output as ToolResult | undefined)?.success ?? false,
        data: (toolResult.output as ToolResult | undefined)?.data,
      }));

      // Update session context if this is a message
      if (task.sessionId && task.type === 'message') {
        const payload = task.payload as { content?: string; sender?: string };
        await sessionService.appendToContext(task.sessionId, {
          role: 'user',
          content: payload.content || '',
          sender: payload.sender,
        });
        await sessionService.appendToContext(task.sessionId, {
          role: 'assistant',
          content: response,
        });
      }

      // Update memory with this interaction
      await memoryService.appendHistory(
        task.agentId,
        `**Task ${task.id}** (${task.type}): ${JSON.stringify(task.payload).substring(0, 200)}...\n\n**Response:** ${response.substring(0, 500)}...${executionToolCalls.length > 0 ? `\n\n**Tool Calls:** ${executionToolCalls.length} tools executed` : ''}`
      );

      // Complete task
      await taskQueue.completeTask(taskId, {
        response,
        taskType: task.type,
        toolCalls: executionToolCalls.map(tc => ({ tool: tc.tool, success: tc.result.success })),
      });

      // Set agent back to idle
      await agentService.setAgentStatus(task.agentId, 'idle');

      // Log audit event
      await auditService.log({
        action: 'task_completed',
        entityType: 'task',
        entityId: taskId,
        details: { agentId: task.agentId, success: true, toolCallsCount: executionToolCalls.length },
      });

      return {
        success: true,
        response,
        actions,
        toolCalls: executionToolCalls,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Fail task
      await taskQueue.failTask(taskId, errorMessage);
      await agentService.setAgentStatus(task.agentId, 'error');

      // Log audit event
      await auditService.log({
        action: 'task_failed',
        entityType: 'task',
        entityId: taskId,
        details: { agentId: task.agentId, error: errorMessage },
        severity: 'error',
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Process next task for an agent
   */
  async processNextTask(agentId: string): Promise<ExecutionResult | null> {
    const task = await taskQueue.getNextTask(agentId);
    if (!task) {
      return null;
    }

    return this.executeTask(task.id);
  }

  /**
   * Get system prompt for agent
   */
  private getSystemPrompt(
    agent: { name: string; description?: string; skills: string[] },
    task: Task
  ): string {
    const skillsList = agent.skills.length > 0
      ? `Your available skills: ${agent.skills.join(', ')}`
      : 'You have no specific skills configured.';

    return `You are ${agent.name}, an AI agent in the OpenClaw runtime system.

${agent.description ? `Description: ${agent.description}` : ''}

${skillsList}

Current task type: ${task.type}
Your Agent ID: ${task.agentId}

You are an event-driven agent. You respond to inputs and perform tasks.
Be concise, helpful, and focused on the task at hand.
When processing messages, respond naturally.
When handling heartbeats, report status or perform maintenance.
When handling webhooks, process the incoming data appropriately.
When handling cron jobs, execute the scheduled task.

Always maintain awareness of your persistent memory and context.`;
  }

  /**
   * Build prompt based on task type
   */
  private buildPrompt(task: Task, context: string, sessionContext: string): string {
    const contextPreview = context.substring(0, 2000);
    const sessionPreview = sessionContext.substring(0, 1000);

    const sessionSection = sessionPreview 
      ? `\n\nCURRENT SESSION CONTEXT:\n${sessionPreview}`
      : '';

    switch (task.type) {
      case 'message':
        return `You have received a new message.

CONTEXT FROM MEMORY:
${contextPreview}${sessionSection}

MESSAGE DETAILS:
Channel: ${(task.payload as { channel?: string }).channel}
Sender: ${(task.payload as { sender?: string }).sender || 'Unknown'}
Content: ${(task.payload as { content?: string }).content}

Please respond appropriately to this message. Use tools if needed.`;

      case 'heartbeat':
        return `Heartbeat triggered at ${new Date().toISOString()}.

CONTEXT FROM MEMORY:
${contextPreview}

This is a scheduled check-in. Please:
1. Review any pending items or context
2. Report your current status
3. Perform any necessary maintenance tasks
4. Use tools if you need to update notes or communicate with other agents`;

      case 'cron':
        return `Cron job triggered.

CONTEXT FROM MEMORY:
${contextPreview}

SCHEDULED TIME: ${(task.payload as { scheduledTime?: Date }).scheduledTime}

This is a scheduled task. Execute the appropriate action for this time.`;

      case 'webhook':
        return `Webhook received.

CONTEXT FROM MEMORY:
${contextPreview}

SOURCE: ${(task.payload as { source?: string }).source}
PAYLOAD: ${JSON.stringify((task.payload as { payload?: unknown }).payload, null, 2)}

Process this webhook data. Use tools to take action if needed.`;

      case 'hook':
        return `Internal hook triggered.

CONTEXT FROM MEMORY:
${contextPreview}

EVENT: ${(task.payload as { event?: string }).event}
DATA: ${JSON.stringify((task.payload as { data?: unknown }).data, null, 2)}

Handle this system event appropriately.`;

      case 'a2a':
        return `Message from another agent.

CONTEXT FROM MEMORY:
${contextPreview}

FROM AGENT: ${(task.payload as { fromAgentId?: string }).fromAgentId}
MESSAGE: ${(task.payload as { message?: string }).message}
DATA: ${JSON.stringify((task.payload as { data?: unknown }).data, null, 2)}

Process this inter-agent communication. You can respond by using the send_message_to_agent tool.`;

      default:
        return `Task received: ${task.type}

CONTEXT FROM MEMORY:
${contextPreview}

PAYLOAD: ${JSON.stringify(task.payload, null, 2)}

Process this task appropriately.`;
    }
  }
}

export const agentExecutor = new AgentExecutorService();
