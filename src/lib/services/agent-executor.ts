// OpenClaw Agent Runtime - Agent Executor
// Execute tasks using AI integration

import ZAI from 'z-ai-web-dev-sdk';
import { taskQueue } from './task-queue';
import { agentService } from './agent-service';
import { memoryService } from './memory-service';
import { Task } from '@/lib/types';

export interface ExecutionResult {
  success: boolean;
  response?: string;
  actions?: Record<string, unknown>[];
  error?: string;
}

class AgentExecutorService {
  private zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;

  /**
   * Initialize the AI client
   */
  private async initAI() {
    if (!this.zai) {
      this.zai = await ZAI.create();
    }
    return this.zai;
  }

  /**
   * Execute a task
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

    try {
      // Load agent context
      const context = await memoryService.loadAgentContext(task.agentId);

      // Build prompt based on task type
      const prompt = this.buildPrompt(task, context);

      // Execute with AI
      const zai = await this.initAI();
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(agent, task),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const response = completion.choices[0]?.message?.content ?? '';

      // Update memory with this interaction
      await memoryService.appendHistory(task.agentId, 
        `**Task ${task.id}** (${task.type}): ${JSON.stringify(task.payload).substring(0, 200)}...\n\n**Response:** ${response.substring(0, 500)}...`
      );

      // Complete task
      await taskQueue.completeTask(taskId, { response, taskType: task.type });

      // Set agent back to idle
      await agentService.setAgentStatus(task.agentId, 'idle');

      return {
        success: true,
        response,
        actions: [{ type: 'response', content: response }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Fail task
      await taskQueue.failTask(taskId, errorMessage);
      await agentService.setAgentStatus(task.agentId, 'error');

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
  private getSystemPrompt(agent: { name: string; description?: string; skills: string[] }, task: Task): string {
    const skillsList = agent.skills.length > 0 
      ? `Your available skills: ${agent.skills.join(', ')}`
      : 'You have no specific skills configured.';

    return `You are ${agent.name}, an AI agent in the OpenClaw runtime system.

${agent.description ? `Description: ${agent.description}` : ''}

${skillsList}

Current task type: ${task.type}

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
  private buildPrompt(task: Task, context: string): string {
    const contextPreview = context.substring(0, 2000);

    switch (task.type) {
      case 'message':
        return `You have received a new message.

CONTEXT FROM MEMORY:
${contextPreview}

MESSAGE DETAILS:
Channel: ${(task.payload as { channel?: string }).channel}
Sender: ${(task.payload as { sender?: string }).sender || 'Unknown'}
Content: ${(task.payload as { content?: string }).content}

Please respond appropriately to this message.`;

      case 'heartbeat':
        return `Heartbeat triggered at ${new Date().toISOString()}.

CONTEXT FROM MEMORY:
${contextPreview}

This is a scheduled check-in. Please:
1. Review any pending items or context
2. Report your current status
3. Perform any necessary maintenance tasks`;

      case 'cron':
        return `Cron job triggered.

CONTEXT FROM MEMORY:
${contextPreview}

SCHEDULED TIME: ${(task.payload as { scheduledTime?: Date }).scheduledTime}

This is a scheduled task. Please execute the appropriate action for this time.`;

      case 'webhook':
        return `Webhook received.

CONTEXT FROM MEMORY:
${contextPreview}

SOURCE: ${(task.payload as { source?: string }).source}
PAYLOAD: ${JSON.stringify((task.payload as { payload?: unknown }).payload, null, 2)}

Please process this webhook data appropriately.`;

      case 'hook':
        return `Internal hook triggered.

CONTEXT FROM MEMORY:
${contextPreview}

EVENT: ${(task.payload as { event?: string }).event}
DATA: ${JSON.stringify((task.payload as { data?: unknown }).data, null, 2)}

Please handle this system event.`;

      case 'a2a':
        return `Message from another agent.

CONTEXT FROM MEMORY:
${contextPreview}

FROM AGENT: ${(task.payload as { fromAgentId?: string }).fromAgentId}
MESSAGE: ${(task.payload as { message?: string }).message}
DATA: ${JSON.stringify((task.payload as { data?: unknown }).data, null, 2)}

Please process this inter-agent communication.`;

      default:
        return `Task received: ${task.type}

CONTEXT FROM MEMORY:
${contextPreview}

PAYLOAD: ${JSON.stringify(task.payload, null, 2)}

Please process this task.`;
    }
  }
}

export const agentExecutor = new AgentExecutorService();
