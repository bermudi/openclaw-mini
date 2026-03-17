// OpenClaw Agent Runtime - Agent Executor
// Execute tasks using AI integration with tool support

import ZAI from 'z-ai-web-dev-sdk';
import { taskQueue } from './task-queue';
import { agentService } from './agent-service';
import { memoryService } from './memory-service';
import { sessionService } from './session-service';
import { auditService } from './audit-service';
import { Task } from '@/lib/types';
import { getTool, getAvailableTools, type ToolResult } from '@/lib/tools';

export interface ExecutionResult {
  success: boolean;
  response?: string;
  actions?: Record<string, unknown>[];
  toolCalls?: Array<{ tool: string; params: Record<string, unknown>; result: ToolResult }>;
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
      const tools = this.getAgentTools(agent.skills);
      const toolDescriptions = this.formatToolsForPrompt(tools);

      // Build prompt based on task type
      const prompt = this.buildPrompt(task, context, sessionContext, toolDescriptions);

      // Execute with AI
      const zai = await this.initAI();
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(agent, task, tools),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      let response = completion.choices[0]?.message?.content ?? '';
      const toolCalls: ExecutionResult['toolCalls'] = [];
      const actions: Record<string, unknown>[] = [];

      // Check if the response contains tool calls (in a specific format)
      const toolCallMatches = this.extractToolCalls(response);
      
      if (toolCallMatches.length > 0) {
        // Execute each tool call
        for (const match of toolCallMatches) {
          const tool = getTool(match.tool);
          if (tool) {
            try {
              const result = await tool.execute(match.params);
              toolCalls.push({
                tool: match.tool,
                params: match.params,
                result,
              });
              actions.push({
                type: 'tool_call',
                tool: match.tool,
                success: result.success,
                data: result.data,
              });
            } catch (error) {
              toolCalls.push({
                tool: match.tool,
                params: match.params,
                result: { success: false, error: String(error) },
              });
            }
          }
        }
      }

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
        `**Task ${task.id}** (${task.type}): ${JSON.stringify(task.payload).substring(0, 200)}...\n\n**Response:** ${response.substring(0, 500)}...${toolCalls.length > 0 ? `\n\n**Tool Calls:** ${toolCalls.length} tools executed` : ''}`
      );

      // Complete task
      await taskQueue.completeTask(taskId, { 
        response, 
        taskType: task.type,
        toolCalls: toolCalls.map(tc => ({ tool: tc.tool, success: tc.result.success })),
      });

      // Set agent back to idle
      await agentService.setAgentStatus(task.agentId, 'idle');

      // Log audit event
      await auditService.log({
        action: 'task_completed',
        entityType: 'task',
        entityId: taskId,
        details: { agentId: task.agentId, success: true, toolCallsCount: toolCalls.length },
      });

      return {
        success: true,
        response,
        actions,
        toolCalls,
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
   * Get tools available to an agent based on skills
   */
  private getAgentTools(skills: string[]): ReturnType<typeof getAvailableTools> {
    const allTools = getAvailableTools();
    
    if (skills.length === 0) {
      // If no skills specified, give basic tools
      return allTools.filter(t => t.riskLevel === 'low');
    }

    // Map skill names to tool names
    const skillToolMap: Record<string, string[]> = {
      'research': ['web_search', 'read_file', 'list_files'],
      'writing': ['write_note', 'read_file'],
      'coding': ['calculate', 'read_file', 'write_note'],
      'communication': ['send_message_to_agent', 'log_event'],
      'data': ['calculate', 'random', 'read_file', 'write_note'],
      'datetime': ['get_datetime', 'wait'],
      'general': ['get_datetime', 'calculate', 'random', 'read_file', 'write_note', 'list_files'],
    };

    const allowedTools = new Set<string>();
    allowedTools.add('get_datetime'); // Always available
    
    for (const skill of skills) {
      const toolsForSkill = skillToolMap[skill.toLowerCase()];
      if (toolsForSkill) {
        toolsForSkill.forEach(t => allowedTools.add(t));
      }
    }

    return allTools.filter(t => allowedTools.has(t.name));
  }

  /**
   * Format tools for inclusion in prompt
   */
  private formatToolsForPrompt(tools: ReturnType<typeof getAvailableTools>): string {
    if (tools.length === 0) return 'No tools available.';

    return tools.map(t => {
      const params = t.parameters.map(p => 
        `${p.name}${p.required ? '*' : ''} (${p.type}): ${p.description}`
      ).join(', ');
      return `- **${t.name}**: ${t.description}\n  Parameters: ${params || 'none'}`;
    }).join('\n');
  }

  /**
   * Extract tool calls from AI response
   * Format: [TOOL: tool_name(param1: value1, param2: value2)]
   */
  private extractToolCalls(response: string): Array<{ tool: string; params: Record<string, unknown> }> {
    const calls: Array<{ tool: string; params: Record<string, unknown> }> = [];
    const regex = /\[TOOL:\s*(\w+)\s*\(([\s\S]*?)\)\]/g;
    
    let match;
    while ((match = regex.exec(response)) !== null) {
      const toolName = match[1];
      const paramsStr = match[2];
      
      const params: Record<string, unknown> = {};
      
      // Parse parameters (simple key: value format)
      const paramRegex = /(\w+)\s*:\s*("[^"]*"|'[^']*'|\[[^\]]*\]|\{[^}]*\}|[^,)]+)/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
        const key = paramMatch[1];
        let value: unknown = paramMatch[2].trim();
        
        // Try to parse as JSON for objects/arrays
        if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
          try {
            value = JSON.parse(value);
          } catch {
            // Keep as string
          }
        } else if (typeof value === 'string') {
          // Remove quotes
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          // Try to parse as number
          const num = Number(value);
          if (!isNaN(num)) {
            value = num;
          }
          // Parse boolean
          if (value === 'true') value = true;
          if (value === 'false') value = false;
        }
        
        params[key] = value;
      }
      
      calls.push({ tool: toolName, params });
    }
    
    return calls;
  }

  /**
   * Get system prompt for agent
   */
  private getSystemPrompt(
    agent: { name: string; description?: string; skills: string[] }, 
    task: Task,
    tools: ReturnType<typeof getAvailableTools>
  ): string {
    const skillsList = agent.skills.length > 0 
      ? `Your available skills: ${agent.skills.join(', ')}`
      : 'You have no specific skills configured.';

    const toolInstructions = tools.length > 0
      ? `

You have access to tools. To use a tool, include it in your response in this format:
[TOOL: tool_name(param1: value1, param2: value2)]

For example:
- [TOOL: get_datetime()]
- [TOOL: calculate(expression: "2 + 2")]
- [TOOL: write_note(agentId: "your_agent_id", title: "My Note", content: "Note content")]

Available tools:
${this.formatToolsForPrompt(tools)}`
      : '';

    return `You are ${agent.name}, an AI agent in the OpenClaw runtime system.

${agent.description ? `Description: ${agent.description}` : ''}

${skillsList}
${toolInstructions}

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
  private buildPrompt(task: Task, context: string, sessionContext: string, toolDescriptions: string): string {
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
