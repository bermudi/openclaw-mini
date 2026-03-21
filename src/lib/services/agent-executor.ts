// OpenClaw Agent Runtime - Agent Executor
// Execute tasks using AI integration with tool support

import { generateText, stepCountIs } from 'ai';
import { db } from '@/lib/db';
import { taskQueue } from './task-queue';
import { agentService } from './agent-service';
import { memoryService } from './memory-service';
import { sessionService, type SessionContext } from './session-service';
import { auditService } from './audit-service';
import { enqueueDeliveryTx } from './delivery-service';
import { getModelConfig, resolveAgentContextWindow, runWithModelFallback } from './model-provider';
import { parseCommand, type ParsedCommand } from './command-parser';
import { sessionProviderState } from './session-provider-state';
import { ChannelType, DeliveryTarget, Task } from '@/lib/types';
import { getLowRiskTools, getToolsByNames, getToolsForAgent, type ToolResult, withSpawnSubagentContext } from '@/lib/tools';
import { getSkillForSubAgent, getSkillSummaries } from './skill-service';
import { type SubAgentOverrides, resolveSubAgentConfig } from '@/lib/subagent-config';
import { loadBootstrapContext, loadHeartbeatContext } from './workspace-service';
import { countTokens } from '@/lib/utils/token-counter';
import { eventBus } from './event-bus';

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
      let sessionMessages: SessionContext['messages'] = [];
      if (task.sessionId) {
        sessionMessages = await sessionService.getSessionMessages(task.sessionId);
      }

      const isSubagent = task.type === 'subagent';

      // Handle inline slash commands for message tasks before AI execution
      if (!isSubagent && task.type === 'message' && task.sessionId) {
        const msgPayload = task.payload as {
          content?: string;
          sender?: string;
          channel?: ChannelType;
          channelKey?: string;
          deliveryTarget?: DeliveryTarget;
        };
        const command = parseCommand(msgPayload.content ?? '');
        if (command.type !== 'not-command') {
          return await this.executeCommand(taskId, task, command, msgPayload);
        }
      }

      const subagentPayload = task.payload as {
        skill?: string;
        skillTools?: string[];
        systemPrompt?: string;
        overrides?: SubAgentOverrides;
      };
      const skillName = task.skillName ?? subagentPayload.skill;
      const skill = isSubagent && skillName ? await getSkillForSubAgent(skillName) : undefined;

      if (isSubagent && (!skill || !skill.skill)) {
        throw new Error(skill?.error ?? `Skill '${skillName ?? 'unknown'}' not found or disabled`);
      }

      const defaultSubagentSystemPrompt = subagentPayload.systemPrompt
        ?? skill?.skill?.instructions
        ?? 'You are a sub-agent executing a focused task.';
      const defaultSubagentToolNames = subagentPayload.skillTools && subagentPayload.skillTools.length > 0
        ? subagentPayload.skillTools
        : (skill?.skill?.tools && skill.skill.tools.length > 0
            ? skill.skill.tools
            : Object.keys(getLowRiskTools()));
      const resolvedSubagentConfig = isSubagent
        ? resolveSubAgentConfig({
            baseConfig: {
              ...getModelConfig(),
              agentSkills: agent.skills,
              defaultSystemPrompt: defaultSubagentSystemPrompt,
              defaultToolNames: defaultSubagentToolNames,
            },
            overrides: subagentPayload.overrides ?? skill?.skill?.overrides,
          })
        : undefined;

      const tools = isSubagent
        ? getToolsByNames(resolvedSubagentConfig?.allowedTools ?? defaultSubagentToolNames)
        : getToolsForAgent(agent.skills);

      const systemPrompt = isSubagent
        ? (resolvedSubagentConfig?.systemPrompt ?? defaultSubagentSystemPrompt)
        : await this.getSystemPrompt(agent, task);

      const prompt = await this.buildPrompt(task, {
        context,
        sessionMessages,
        systemPrompt,
        agent: {
          model: resolvedSubagentConfig?.model ?? agent.model ?? null,
          contextWindowOverride: agent.contextWindowOverride ?? null,
        },
      });

      if (isSubagent && resolvedSubagentConfig) {
        await auditService.log({
          action: 'subagent_overrides_applied',
          entityType: 'task',
          entityId: task.id,
          details: {
            agentId: task.agentId,
            skill: skillName,
            overrideFieldsApplied: resolvedSubagentConfig.overrideFieldsApplied,
          },
        });
      }

      // Execute with AI SDK
      const sessionProviderOverrides = (!isSubagent && task.sessionId)
        ? sessionProviderState.getOrInit(task.sessionId)
        : undefined;

      const executeGeneration = () =>
        runWithModelFallback(
          ({ model }) =>
            generateText({
              model,
              system: systemPrompt,
              prompt,
              tools,
              stopWhen: stepCountIs(resolvedSubagentConfig?.maxIterations ?? 5),
            }),
          resolvedSubagentConfig
            ? {
                provider: resolvedSubagentConfig.provider,
                model: resolvedSubagentConfig.model,
                baseURL: resolvedSubagentConfig.baseURL,
                apiKey: resolvedSubagentConfig.apiKey,
                credentialRef: resolvedSubagentConfig.credentialRef,
              }
            : sessionProviderOverrides
              ? {
                  provider: sessionProviderOverrides.activeProvider,
                  model: sessionProviderOverrides.activeModel,
                }
              : undefined,
        );

      const result = await withSpawnSubagentContext(
        {
          agentId: task.agentId,
          parentTaskId: task.id,
          spawnDepth: task.spawnDepth ?? 0,
          allowedSkills: resolvedSubagentConfig?.allowedSkills,
          allowedTools: resolvedSubagentConfig?.allowedTools,
          maxToolInvocations: resolvedSubagentConfig?.maxToolInvocations,
          toolInvocationCount: { count: 0 },
        },
        executeGeneration,
      );

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

      const payload = task.payload as {
        content?: string;
        sender?: string;
        channel?: ChannelType;
        channelKey?: string;
        deliveryTarget?: DeliveryTarget;
      };
      const deliveryTarget = task.type === 'message'
        ? payload.deliveryTarget ?? this.buildFallbackDeliveryTarget(payload)
        : undefined;
      const taskResult = {
        response,
        taskType: task.type,
        toolCalls: executionToolCalls.map(tc => ({ tool: tc.tool, success: tc.result.success })),
      };
      const shouldAutoDeliver = task.type === 'message' && response.trim().length > 0 && !!deliveryTarget;

      if (task.sessionId && task.type === 'message') {
        await sessionService.appendToContext(task.sessionId, {
          role: 'user',
          content: payload.content || '',
          sender: payload.sender,
          channel: payload.channel,
          channelKey: payload.channelKey,
        });
        await sessionService.appendToContext(task.sessionId, {
          role: 'assistant',
          content: response,
          channel: payload.channel,
          channelKey: payload.channelKey,
        });
      }

      if (shouldAutoDeliver && deliveryTarget) {
        // Delivery semantics are at-least-once: a crash after channel API success but before DB status update can duplicate sends.
        await db.$transaction(async (tx) => {
          await taskQueue.completeTaskTx(tx, taskId, taskResult);
          await enqueueDeliveryTx(
            tx,
            taskId,
            deliveryTarget.channel,
            deliveryTarget.channelKey,
            JSON.stringify(deliveryTarget),
            response,
            `task:${taskId}`,
          );
        });
        taskQueue.completeTaskSideEffects(task.agentId, taskId, task.type, taskResult);
      } else {
        await taskQueue.completeTask(taskId, taskResult);
      }

      await this.runPostCommitSideEffects(task.agentId, taskId, task, response, executionToolCalls);

      return {
        success: true,
        response,
        actions,
        toolCalls: executionToolCalls,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Fail task (failTask internally cascades via failChildTasks; 4.2 adds an explicit belt-and-suspenders call)
      await taskQueue.failTask(taskId, errorMessage);
      await taskQueue.failChildTasks(taskId, 'Parent task failed');
      await agentService.setAgentStatus(task.agentId, 'error');

      if (task.type === 'subagent' && task.parentTaskId) {
        eventBus.emit('subagent:failed', {
          taskId,
          parentTaskId: task.parentTaskId,
          skillName: task.skillName ?? 'unknown',
          agentId: task.agentId,
          error: errorMessage,
        });
      }

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

  private async executeCommand(
    taskId: string,
    task: Task,
    command: ParsedCommand,
    payload: {
      content?: string;
      sender?: string;
      channel?: ChannelType;
      channelKey?: string;
      deliveryTarget?: DeliveryTarget;
    },
  ): Promise<ExecutionResult> {
    const sessionId = task.sessionId!;
    const commandResponse = this.buildCommandResponse(command, sessionId);

    if (task.sessionId) {
      await sessionService.appendToContext(task.sessionId, {
        role: 'user',
        content: payload.content ?? '',
        sender: payload.sender,
        channel: payload.channel,
        channelKey: payload.channelKey,
      });
      await sessionService.appendToContext(task.sessionId, {
        role: 'assistant',
        content: commandResponse,
        channel: payload.channel,
        channelKey: payload.channelKey,
      });
    }

    const taskResult = {
      response: commandResponse,
      taskType: task.type,
      toolCalls: [] as { tool: string; success: boolean }[],
    };
    const deliveryTarget = payload.deliveryTarget ?? this.buildFallbackDeliveryTarget(payload);
    const shouldAutoDeliver = commandResponse.trim().length > 0 && !!deliveryTarget;

    if (shouldAutoDeliver && deliveryTarget) {
      await db.$transaction(async (tx) => {
        await taskQueue.completeTaskTx(tx, taskId, taskResult);
        await enqueueDeliveryTx(
          tx,
          taskId,
          deliveryTarget.channel,
          deliveryTarget.channelKey,
          JSON.stringify(deliveryTarget),
          commandResponse,
          `task:${taskId}`,
        );
      });
      taskQueue.completeTaskSideEffects(task.agentId, taskId, task.type, taskResult);
    } else {
      await taskQueue.completeTask(taskId, taskResult);
    }

    await this.runPostCommitSideEffects(task.agentId, taskId, task, commandResponse, []);

    return { success: true, response: commandResponse, actions: [], toolCalls: [] };
  }

  private buildCommandResponse(command: ParsedCommand, sessionId: string): string {
    switch (command.type) {
      case 'list-providers': {
        const providers = sessionProviderState.listProviders();
        return `Available providers: ${providers.join(', ')}`;
      }
      case 'switch-provider': {
        const result = sessionProviderState.switchProvider(sessionId, command.providerName);
        if (!result.success) {
          return `${result.error}\nAvailable providers: ${result.available.join(', ')}`;
        }
        return `Switched to provider: ${command.providerName}`;
      }
      case 'switch-model': {
        sessionProviderState.switchModel(sessionId, command.modelName);
        return `Switched to model: ${command.modelName}`;
      }
      case 'invalid-command': {
        return command.error;
      }
      default:
        return 'Unknown command';
    }
  }

  private buildFallbackDeliveryTarget(payload: {
    channel?: ChannelType;
    channelKey?: string;
  }): DeliveryTarget | undefined {
    if (!payload.channel || !payload.channelKey) {
      return undefined;
    }

    return {
      channel: payload.channel,
      channelKey: payload.channelKey,
      metadata: {},
    };
  }

  private async runPostCommitSideEffects(
    agentId: string,
    taskId: string,
    task: Task,
    response: string,
    executionToolCalls: NonNullable<ExecutionResult['toolCalls']>,
  ): Promise<void> {
    if (task.type === 'subagent' && task.parentTaskId) {
      eventBus.emit('subagent:completed', {
        taskId,
        parentTaskId: task.parentTaskId,
        skillName: task.skillName ?? 'unknown',
        agentId,
      });
    }

    try {
      await memoryService.appendHistory(
        agentId,
        `**Task ${task.id}** (${task.type}): ${JSON.stringify(task.payload).substring(0, 200)}...\n\n**Response:** ${response.substring(0, 500)}...${executionToolCalls.length > 0 ? `\n\n**Tool Calls:** ${executionToolCalls.length} tools executed` : ''}`
      );
    } catch (error) {
      console.error('[AgentExecutor] Failed to append task history after commit:', error);
    }

    try {
      await agentService.setAgentStatus(agentId, 'idle');
    } catch (error) {
      console.error(`[AgentExecutor] Failed to set agent ${agentId} to idle after task ${taskId}:`, error);
    }

    try {
      await auditService.log({
        action: 'task_completed',
        entityType: 'task',
        entityId: taskId,
        details: { agentId, success: true, toolCallsCount: executionToolCalls.length },
      });
    } catch (error) {
      console.error(`[AgentExecutor] Failed to log task_completed audit event for task ${taskId}:`, error);
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
  private async getSystemPrompt(
    agent: { skills: string[] },
    task: Task
  ): Promise<string> {
    const summaries = await getSkillSummaries(agent.skills);
    const summaryLines = summaries.map(skill => `- ${skill.name}: ${skill.description}`);
    let skillSection = summaryLines.length > 0
      ? `## Available Skills\n${summaryLines.join('\n')}`
      : '## Available Skills\nNo skills are currently available.';

    if (skillSection.length > 5000) {
      const limit = 5000;
      const boundaryCandidates = [
        skillSection.lastIndexOf('\n\n', limit),
        skillSection.lastIndexOf('\n', limit),
        skillSection.lastIndexOf(' ', limit),
      ];
      const boundary = boundaryCandidates.find(index => index > 0) ?? limit;
      skillSection = `${skillSection.slice(0, boundary)}...`;
    }

    const workspaceContext = loadBootstrapContext();
    const heartbeatContext = task.type === 'heartbeat' ? loadHeartbeatContext() : '';
    const runtimeSection = `## Runtime Context\nCurrent task type: ${task.type}\nYour Agent ID: ${task.agentId}`;

    return [workspaceContext, heartbeatContext, skillSection, runtimeSection]
      .filter(section => section.trim().length > 0)
      .join('\n\n');
  }

  /**
   * Build prompt based on task type
   */
  private async buildPrompt(
    task: Task,
    input: {
      context: string;
      sessionMessages: SessionContext['messages'];
      systemPrompt: string;
      agent: {
        model: string | null;
        contextWindowOverride: number | null;
      };
    },
  ): Promise<string> {
    const contextWindow = await resolveAgentContextWindow(input.agent);
    const responseReserve = Math.max(Math.floor(contextWindow * 0.2), 1000);
    const totalBudget = Math.max(contextWindow - responseReserve, 0);
    const taskPromptWithoutContext = this.renderTaskPrompt(task, '');
    const reservedTokens = countTokens(input.systemPrompt) + countTokens(taskPromptWithoutContext);
    let remainingBudget = Math.max(totalBudget - reservedTokens, 0);
    const contextSections: string[] = [];

    const sessionSection = this.buildSessionContextSection(input.sessionMessages, remainingBudget);
    if (sessionSection) {
      contextSections.push(sessionSection);
      remainingBudget = Math.max(remainingBudget - countTokens(sessionSection), 0);
    }

    const memorySection = this.buildBudgetedSection('RUNTIME MEMORY SNAPSHOT', input.context, remainingBudget);
    if (memorySection) {
      contextSections.push(memorySection);
    }

    const contextSection = contextSections.length > 0
      ? `\n\n${contextSections.join('\n\n')}`
      : '';

    return this.renderTaskPrompt(task, contextSection);
  }

  private renderTaskPrompt(task: Task, contextSection: string): string {
    switch (task.type) {
      case 'message':
        return `You have received a new message.
${contextSection}

MESSAGE DETAILS:
Channel: ${(task.payload as { channel?: string }).channel}
Sender: ${(task.payload as { sender?: string }).sender || 'Unknown'}
Content: ${(task.payload as { content?: string }).content}

Please respond appropriately to this message. Use tools if needed.`;

      case 'heartbeat':
        return `Heartbeat triggered at ${new Date().toISOString()}.
${contextSection}

This is a scheduled check-in. Please:
1. Review any pending items or context
2. Report your current status
3. Perform any necessary maintenance tasks
4. Use tools if you need to update notes or communicate with other agents`;

      case 'cron':
        return `Cron job triggered.
${contextSection}

SCHEDULED TIME: ${(task.payload as { scheduledTime?: Date }).scheduledTime}

This is a scheduled task. Execute the appropriate action for this time.`;

      case 'webhook':
        return `Webhook received.
${contextSection}

SOURCE: ${(task.payload as { source?: string }).source}
PAYLOAD: ${JSON.stringify((task.payload as { payload?: unknown }).payload, null, 2)}

Process this webhook data. Use tools to take action if needed.`;

      case 'hook':
        return `Internal hook triggered.
${contextSection}

EVENT: ${(task.payload as { event?: string }).event}
DATA: ${JSON.stringify((task.payload as { data?: unknown }).data, null, 2)}

Handle this system event appropriately.`;

      case 'a2a':
        return `Message from another agent.
${contextSection}

FROM AGENT: ${(task.payload as { fromAgentId?: string }).fromAgentId}
MESSAGE: ${(task.payload as { message?: string }).message}
DATA: ${JSON.stringify((task.payload as { data?: unknown }).data, null, 2)}

Process this inter-agent communication. You can respond by using the send_message_to_agent tool.`;

      case 'subagent': {
        const payload = task.payload as { task?: string };
        return `Sub-agent task received.
${contextSection}

TASK:
${payload.task ?? 'No task provided.'}`;
      }

      default:
        return `Task received: ${task.type}
${contextSection}`;
    }
  }

  private buildBudgetedSection(label: string, content: string, budget: number): string {
    const trimmedContent = content.trim();
    if (!trimmedContent || budget <= 0) {
      return '';
    }

    const sectionPrefix = `${label}:\n`;
    const minimumTokens = countTokens(sectionPrefix);
    if (budget <= minimumTokens) {
      return '';
    }

    const fullSection = `${sectionPrefix}${trimmedContent}`;
    if (countTokens(fullSection) <= budget) {
      return fullSection;
    }

    let low = 0;
    let high = trimmedContent.length;
    let best = '';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = trimmedContent.slice(0, mid).trimEnd();
      const section = candidate ? `${sectionPrefix}${candidate}` : '';
      if (section && countTokens(section) <= budget) {
        best = section;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }

  private buildSessionContextSection(
    sessionMessages: SessionContext['messages'],
    budget: number,
  ): string {
    if (sessionMessages.length === 0) {
      return '';
    }

    const summaryIndexes = new Set<number>();
    const regularIndexes: number[] = [];

    sessionMessages.forEach((message, index) => {
      if (message.role === 'system' && message.content.startsWith('[Session Summary]')) {
        summaryIndexes.add(index);
        return;
      }
      regularIndexes.push(index);
    });

    const buildSectionFromIndexes = (indexes: number[]): string => {
      if (indexes.length === 0) {
        return '';
      }
      const body = indexes
        .map(index => this.formatSessionMessageForPrompt(sessionMessages[index]!))
        .join('\n\n');
      return `CURRENT SESSION CONTEXT:\n${body}`;
    };

    const summaryOnlyIndexes = [...summaryIndexes].sort((left, right) => left - right);
    const summaryOnlySection = buildSectionFromIndexes(summaryOnlyIndexes);
    if (summaryOnlySection && countTokens(summaryOnlySection) > budget) {
      return summaryOnlySection;
    }

    const includedRegularIndexes = new Set<number>();
    let currentSection = summaryOnlySection;

    for (let index = regularIndexes.length - 1; index >= 0; index -= 1) {
      const candidateIndexes = [...summaryIndexes, regularIndexes[index]!, ...includedRegularIndexes]
        .sort((left, right) => left - right);
      const candidateSection = buildSectionFromIndexes(candidateIndexes);
      if (candidateSection && countTokens(candidateSection) <= budget) {
        includedRegularIndexes.add(regularIndexes[index]!);
        currentSection = candidateSection;
      }
    }

    return currentSection;
  }

  private formatSessionMessageForPrompt(message: SessionContext['messages'][number]): string {
    const sender = message.sender ? ` (${message.sender})` : '';
    const channelTag = message.channel
      ? ` [${message.channel}${message.channelKey ? `:${message.channelKey}` : ''}]`
      : '';
    return `${message.role}${sender}${channelTag}: ${message.content}`;
  }
}

export const agentExecutor = new AgentExecutorService();
