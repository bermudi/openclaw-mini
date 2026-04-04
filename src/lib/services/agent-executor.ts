// OpenClaw Agent Runtime - Agent Executor
// Execute tasks using AI integration with tool support

import { generateText, stepCountIs } from 'ai';
import { db } from '@/lib/db';
import { taskQueue } from './task-queue';
import { agentService } from './agent-service';
import { memoryService } from './memory-service';
import { sessionService, type SessionContext } from './session-service';
import { auditService } from './audit-service';
import { enqueueDeliveryTx, enqueueFileDeliveryTx } from './delivery-service';
import { getModelConfig, resolveAgentContextWindow, runWithModelFallback } from './model-provider';
import { parseCommand, type ParsedCommand } from './command-parser';
import { sessionProviderState } from './session-provider-state';
import type { Prisma } from '@prisma/client';
import { AsyncTaskRecord, ChannelType, DeliveryTarget, Task, VisionInput, Attachment, DownloadedFile } from '@/lib/types';
import {
  getLowRiskTools,
  getToolExecutionContext,
  getToolsByNames,
  getToolsForAgent,
  withToolExecutionContext,
  normalizeSurfaceDirectives,
  type SurfaceDirective,
  type ToolResult,
} from '@/lib/tools';
import { getSkillForSubAgent, getSkillSummaries } from './skill-service';
import { type SubAgentOverrides, resolveSubAgentConfig } from '@/lib/subagent-config';
import { loadBootstrapContext, loadHeartbeatContext, cleanOffloadFiles } from './workspace-service';
import { countTokens } from '@/lib/utils/token-counter';
import { eventBus } from './event-bus';
import { supportsVision } from './model-catalog';
import { handleVisionInput, type VisionHandlerContext } from './vision-handler';
import { mcpService } from './mcp-service';

interface PromptContextSection {
  body: string;
  omittedCount: number;
  estimatedTokens: number;
  logId: string | null;
}

export interface ExecutionResult {
  success: boolean;
  response?: string;
  actions?: Record<string, unknown>[];
  toolCalls?: Array<{ tool: string; params: Record<string, unknown>; result: ToolResult }>;
  error?: string;
}

function collectSurfaceDirectives(toolResults: Array<{ output?: unknown }>): SurfaceDirective[] {
  return toolResults.flatMap((toolResult) => {
    const output = toolResult.output;
    if (!output || typeof output !== 'object') {
      return [];
    }

    return normalizeSurfaceDirectives((output as ToolResult).surface);
  });
}

type CompletedTaskResult = {
  response: string;
  taskType: Task['type'];
  toolCalls: Array<{ tool: string; success: boolean }>;
  surfaces?: SurfaceDirective[];
};

type ParsedExecutionArtifacts = {
  response: string;
  surfaces: SurfaceDirective[];
  executionToolCalls: NonNullable<ExecutionResult['toolCalls']>;
  actions: Record<string, unknown>[];
};

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
    const claimedTask = await taskQueue.startTask(taskId);
    if (!claimedTask) {
      return { success: false, error: 'Task could not be claimed' };
    }

    // Log audit event
    await auditService.log({
      action: 'task_started',
      entityType: 'task',
      entityId: taskId,
      details: { agentId: task.agentId, type: task.type },
    });

    try {
      // Load session context if available
      let sessionMessages: SessionContext['messages'] = [];
      if (task.sessionId) {
        sessionMessages = await sessionService.getSessionMessages(task.sessionId);
      }

      const recallQuery = this.buildRecallQuery(task, sessionMessages);

      const isSubagent = task.type === 'subagent';

      // Load async task registry (skip for subagents or tasks without session — task 4.2/4.3)
      const asyncTaskRegistry: Map<string, AsyncTaskRecord> = (!isSubagent && task.sessionId)
        ? await sessionService.getAsyncTaskRegistry(task.sessionId)
        : new Map();
      const flushAsyncRegistry = (!isSubagent && task.sessionId)
        ? () => sessionService.setAsyncTaskRegistry(task.sessionId!, asyncTaskRegistry)
        : () => Promise.resolve();

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
        overrides?: SubAgentOverrides;
      };
      const skillName = task.skillName ?? subagentPayload.skill;
      const skill = isSubagent && skillName ? await getSkillForSubAgent(skillName) : undefined;

      if (isSubagent && (!skill || !skill.skill)) {
        throw new Error(skill?.error ?? `Skill '${skillName ?? 'unknown'}' not found or disabled`);
      }

      const defaultSubagentSystemPrompt = skill?.skill?.instructions
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
        : getToolsForAgent(agent.skills, task.id);

      const systemPrompt = isSubagent
        ? (resolvedSubagentConfig?.systemPrompt ?? defaultSubagentSystemPrompt)
        : await this.getSystemPrompt(agent, task);

      const prompt = await this.buildPrompt(task, {
        recallQuery,
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

      const msgPayload = task.payload as {
        content?: string;
        sender?: string;
        channel?: ChannelType;
        channelKey?: string;
        deliveryTarget?: DeliveryTarget;
        visionInputs?: VisionInput[];
        attachments?: Attachment[];
      };

      const modelId = resolvedSubagentConfig?.model
        ?? sessionProviderOverrides?.activeModel
        ?? agent.model
        ?? 'unknown';

      const canDoVision = supportsVision(modelId);
      const hasVisionInputs = !!(msgPayload.visionInputs && msgPayload.visionInputs.length > 0);
      const hasTextContent = (msgPayload.content ?? '').trim().length > 0;

      const deliveryTarget = msgPayload.deliveryTarget
        ?? (task.type === 'message' ? this.buildFallbackDeliveryTarget(msgPayload) : undefined);

      // Handle vision inputs using extracted handler
      const visionResult = await handleVisionInput(
        task,
        msgPayload.visionInputs,
        { modelId, canDoVision, hasVisionInputs, hasTextContent, prompt },
        deliveryTarget,
        async (taskId, target, message, key) => {
          await enqueueDeliveryTx(db, taskId, target.channel, target.channelKey, JSON.stringify(target), message, key);
        },
      );

      // Case: Vision-only with non-vision model - error was delivered, skip LLM
      if (visionResult.skipLlm) {
        await taskQueue.completeTask(taskId, {
          response: visionResult.errorResponse ?? '',
          taskType: task.type,
          toolCalls: [],
        });
        cleanOffloadFiles(taskId);
        await agentService.setAgentStatus(task.agentId, 'idle');
        return { success: true, response: visionResult.errorResponse ?? '', actions: [], toolCalls: [] };
      }

      // Case: Vision with non-vision model but has text - execute with warning
      if (visionResult.warning) {
        const warningText = visionResult.warning;
        const result = await withToolExecutionContext(
          this.buildToolExecutionContext(task, deliveryTarget, resolvedSubagentConfig, asyncTaskRegistry, flushAsyncRegistry),
          () =>
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
            ),
        );
        const artifacts = this.parseExecutionArtifacts(result);
        await this.finalizeTaskExecution({
          task,
          response: artifacts.response,
          deliveryTarget,
          executionToolCalls: artifacts.executionToolCalls,
          surfaces: artifacts.surfaces,
          responseDedupeKey: `task:${taskId}`,
          extraDeliveries: warningText.trim().length > 0
            ? [{ text: warningText, dedupeKey: `task:${taskId}:warning` }]
            : [],
        });
        return {
          success: true,
          response: artifacts.response,
          actions: artifacts.actions,
          toolCalls: artifacts.executionToolCalls,
        };
      }

      const multiModalMessages = visionResult.multiModalMessages;

      const generationArgs = {
        system: systemPrompt,
        tools,
        stopWhen: stepCountIs(resolvedSubagentConfig?.maxIterations ?? 5),
      };

      const executeGeneration = () =>
        runWithModelFallback(
          ({ model }) => {
            if (multiModalMessages) {
              return generateText({
                ...generationArgs,
                model,
                messages: multiModalMessages,
              });
            }
            return generateText({
              ...generationArgs,
              model,
              prompt,
            });
          },
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

      const result = await withToolExecutionContext(
        this.buildToolExecutionContext(task, deliveryTarget, resolvedSubagentConfig, asyncTaskRegistry, flushAsyncRegistry),
        executeGeneration,
      );
      const artifacts = this.parseExecutionArtifacts(result);

      if (task.sessionId && task.type === 'message') {
        await sessionService.appendToContext(task.sessionId, {
          role: 'user',
          content: msgPayload.content || '',
          sender: msgPayload.sender,
          channel: msgPayload.channel,
          channelKey: msgPayload.channelKey,
        });
        await sessionService.appendToContext(task.sessionId, {
          role: 'assistant',
          content: artifacts.response,
          channel: msgPayload.channel,
          channelKey: msgPayload.channelKey,
        });
      }
      await this.finalizeTaskExecution({
        task,
        response: artifacts.response,
        deliveryTarget,
        executionToolCalls: artifacts.executionToolCalls,
        surfaces: artifacts.surfaces,
        responseDedupeKey: `task:${taskId}`,
      });

      return {
        success: true,
        response: artifacts.response,
        actions: artifacts.actions,
        toolCalls: artifacts.executionToolCalls,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await taskQueue.failTask(taskId, errorMessage);
      cleanOffloadFiles(taskId);

      if (task.type === 'subagent' && task.parentTaskId) {
        void eventBus.emit('subagent:failed', {
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
      try {
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[AgentExecutor] Failed to append to session context for task ${taskId}:`, errorMessage);
      }
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
      await taskQueue.completeTaskSideEffects(task.agentId, taskId, task.type, taskResult);
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

  private buildToolExecutionContext(
    task: Task,
    deliveryTarget: DeliveryTarget | undefined,
    resolvedSubagentConfig?: {
      allowedSkills?: string[];
      allowedTools?: string[];
      maxToolInvocations?: number;
    },
    asyncTaskRegistry?: Map<string, AsyncTaskRecord>,
    flushAsyncRegistry?: () => Promise<void>,
  ) {
    return {
      agentId: task.agentId,
      taskId: task.id,
      taskType: task.type,
      sessionId: task.sessionId,
      parentTaskId: task.parentTaskId ?? undefined,
      deliveryTarget,
      spawnDepth: task.spawnDepth ?? 0,
      allowedSkills: resolvedSubagentConfig?.allowedSkills,
      allowedTools: resolvedSubagentConfig?.allowedTools,
      maxToolInvocations: resolvedSubagentConfig?.maxToolInvocations,
      toolInvocationCount: { count: 0 },
      asyncTaskRegistry: asyncTaskRegistry ?? new Map<string, AsyncTaskRecord>(),
      flushAsyncRegistry: flushAsyncRegistry ?? (() => Promise.resolve()),
    };
  }

  private parseExecutionArtifacts(result: { text: string; steps: Array<{ toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>; toolResults?: Array<{ toolCallId: string; toolName: string; output?: unknown }> }> }): ParsedExecutionArtifacts {
    const response = result.text;
    const toolCalls = result.steps.flatMap(step => step.toolCalls ?? []);
    const toolResults = result.steps.flatMap(step => step.toolResults ?? []);
    const surfaces = collectSurfaceDirectives(toolResults);
    const toolResultMap = new Map(toolResults.map(toolResult => [toolResult.toolCallId, toolResult]));
    const executionToolCalls = toolCalls.map((toolCall) => {
      const toolResult = toolResultMap.get(toolCall.toolCallId);
      const output = toolResult?.output;

      return {
        tool: toolCall.toolName,
        params: toolCall.input as Record<string, unknown>,
        result:
          output && typeof output === 'object'
            ? (output as ToolResult)
            : ({ success: false, error: 'Tool result missing' } satisfies ToolResult),
      };
    });
    const actions: Record<string, unknown>[] = toolResults.map((toolResult) => {
      const output = toolResult.output;
      const typedOutput = output && typeof output === 'object' ? output as ToolResult : undefined;

      return {
        type: 'tool_call',
        tool: toolResult.toolName,
        success: typedOutput?.success ?? false,
        data: typedOutput?.data,
      };
    });

    return { response, surfaces, executionToolCalls, actions };
  }

  private buildCompletedTaskResult(
    task: Task,
    response: string,
    executionToolCalls: NonNullable<ExecutionResult['toolCalls']>,
    surfaces: SurfaceDirective[],
  ): CompletedTaskResult {
    return {
      response,
      taskType: task.type,
      toolCalls: executionToolCalls.map(tc => ({ tool: tc.tool, success: tc.result.success })),
      ...(surfaces.length > 0 ? { surfaces } : {}),
    };
  }

  private async finalizeTaskExecution(input: {
    task: Task;
    response: string;
    deliveryTarget?: DeliveryTarget;
    executionToolCalls: NonNullable<ExecutionResult['toolCalls']>;
    surfaces: SurfaceDirective[];
    responseDedupeKey?: string;
    extraDeliveries?: Array<{ text: string; dedupeKey: string }>;
  }): Promise<void> {
    const { task, response, deliveryTarget, executionToolCalls, surfaces, responseDedupeKey, extraDeliveries = [] } = input;
    const taskResult = this.buildCompletedTaskResult(task, response, executionToolCalls, surfaces);
    const surfacesToDeliver = surfaces.filter(surface => task.type === 'message' || surface.type === 'file');
    const shouldDeliverResponse = task.type === 'message' && response.trim().length > 0 && !!deliveryTarget && !!responseDedupeKey;
    const shouldDeliverSurfaces = !!deliveryTarget && surfacesToDeliver.length > 0;
    const shouldDeliverExtras = task.type === 'message' && !!deliveryTarget && extraDeliveries.length > 0;

    if (deliveryTarget && (shouldDeliverResponse || shouldDeliverSurfaces || shouldDeliverExtras)) {
      await db.$transaction(async (tx) => {
        await taskQueue.completeTaskTx(tx, task.id, taskResult);
        await this.enqueueSurfaceDeliveries(tx, task.id, deliveryTarget, surfacesToDeliver);

        if (shouldDeliverResponse && responseDedupeKey) {
          await enqueueDeliveryTx(
            tx,
            task.id,
            deliveryTarget.channel,
            deliveryTarget.channelKey,
            JSON.stringify(deliveryTarget),
            response,
            responseDedupeKey,
          );
        }

        for (const extraDelivery of extraDeliveries) {
          await enqueueDeliveryTx(
            tx,
            task.id,
            deliveryTarget.channel,
            deliveryTarget.channelKey,
            JSON.stringify(deliveryTarget),
            extraDelivery.text,
            extraDelivery.dedupeKey,
          );
        }
      });
      await taskQueue.completeTaskSideEffects(task.agentId, task.id, task.type, taskResult);
    } else {
      await taskQueue.completeTask(task.id, taskResult);
    }

    await this.runPostCommitSideEffects(task.agentId, task.id, task, response, executionToolCalls);
  }

  private async enqueueSurfaceDeliveries(
    tx: Prisma.TransactionClient,
    taskId: string,
    deliveryTarget: DeliveryTarget,
    surfaces: SurfaceDirective[],
  ): Promise<void> {
    const targetJson = JSON.stringify(deliveryTarget);

    for (let index = 0; index < surfaces.length; index += 1) {
      const surface = surfaces[index]!;
      const dedupeKey = `task:${taskId}:surface:${index}`;

      if (surface.type === 'text') {
        if (!surface.content || surface.content.length === 0) {
          continue;
        }

        await enqueueDeliveryTx(
          tx,
          taskId,
          deliveryTarget.channel,
          deliveryTarget.channelKey,
          targetJson,
          surface.content,
          dedupeKey,
        );
        continue;
      }

      if (surface.type !== 'file') {
        continue;
      }

      if (!surface.filePath || surface.filePath.length === 0) {
        continue;
      }

      await enqueueFileDeliveryTx(
        tx,
        taskId,
        deliveryTarget.channel,
        deliveryTarget.channelKey,
        targetJson,
        surface.filePath,
        surface.caption ?? '',
        dedupeKey,
      );
    }
  }

  private async runPostCommitSideEffects(
    agentId: string,
    taskId: string,
    task: Task,
    response: string,
    executionToolCalls: NonNullable<ExecutionResult['toolCalls']>,
  ): Promise<void> {
    cleanOffloadFiles(taskId);

    if (task.type === 'subagent' && task.parentTaskId) {
      void eventBus.emit('subagent:completed', {
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
    const mcpDirectory = mcpService.buildMcpDirectory();

    return [workspaceContext, heartbeatContext, mcpDirectory, skillSection, runtimeSection]
      .filter(section => section.trim().length > 0)
      .join('\n\n');
  }

  /**
   * Build prompt based on task type
   */
  private async buildPrompt(
    task: Task,
    input: {
      recallQuery: string;
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

    const memoryContext = task.agentId
      ? await memoryService.buildPromptContext(task.agentId, remainingBudget, input.recallQuery)
      : {
          pinnedSection: '',
          recalledSection: '',
          omittedCount: 0,
          estimatedTokens: 0,
          logId: null,
        };
    const memorySections = this.buildMemorySections(memoryContext, remainingBudget);
    if (memorySections.body) {
      contextSections.push(memorySections.body);
      remainingBudget = Math.max(remainingBudget - memorySections.estimatedTokens, 0);
      if (memorySections.logId) {
        await auditService.log({
          action: 'memory_recall_prompt_context',
          entityType: 'task',
          entityId: task.id,
          details: {
            agentId: task.agentId,
            recallLogId: memorySections.logId,
            omittedCount: memorySections.omittedCount,
            estimatedTokens: memorySections.estimatedTokens,
          },
        });
      }
    }

    const contextSection = contextSections.length > 0
      ? `\n\n${contextSections.join('\n\n')}`
      : '';

    return this.renderTaskPrompt(task, contextSection);
  }

  private renderTaskPrompt(task: Task, contextSection: string): string {
    switch (task.type) {
      case 'message': {
        const payload = task.payload as {
          channel?: string;
          sender?: string;
          content?: string;
          attachments?: Attachment[];
        };
        const attachmentsSection = payload.attachments && payload.attachments.length > 0
          ? `\n\nATTACHED FILES:\n${payload.attachments.map(a => `- ${a.localPath} (${a.filename}, ${a.mimeType}${a.size ? `, ${a.size} bytes` : ''})`).join('\n')}`
          : '';
        return `You have received a new message.
${contextSection}

MESSAGE DETAILS:
Channel: ${payload.channel}
Sender: ${payload.sender || 'Unknown'}
Content: ${payload.content}${attachmentsSection}

Please respond appropriately to this message. Use tools if needed.`;
      }

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
        const payload = task.payload as {
          task?: string;
          attachments?: Attachment[];
        };
        const attachmentsSection = payload.attachments && payload.attachments.length > 0
          ? `\n\nATTACHED FILES:\n${payload.attachments.map(a => `- ${a.localPath} (${a.filename}, ${a.mimeType}${a.size ? `, ${a.size} bytes` : ''})`).join('\n')}`
          : '';
        return `Sub-agent task received.
${contextSection}

TASK:
${payload.task ?? 'No task provided.'}${attachmentsSection}`;
      }

      default:
        return `Task received: ${task.type}
${contextSection}`;
    }
  }

  private buildRecallQuery(task: Task, sessionMessages: SessionContext['messages']): string {
    const latestSessionText = sessionMessages
      .slice(-4)
      .map(message => message.content)
      .join('\n');

    switch (task.type) {
      case 'message':
        return [
          String((task.payload as { content?: string }).content ?? ''),
          latestSessionText,
        ].filter(Boolean).join('\n');
      case 'webhook':
        return JSON.stringify((task.payload as { payload?: unknown }).payload ?? {});
      case 'hook':
        return [
          String((task.payload as { event?: string }).event ?? ''),
          JSON.stringify((task.payload as { data?: unknown }).data ?? {}),
        ].join('\n');
      case 'a2a':
        return [
          String((task.payload as { message?: string }).message ?? ''),
          JSON.stringify((task.payload as { data?: unknown }).data ?? {}),
        ].join('\n');
      case 'subagent':
        return String((task.payload as { task?: string }).task ?? '');
      case 'cron':
        return String((task.payload as { scheduledTime?: Date }).scheduledTime ?? '');
      case 'heartbeat':
        return 'heartbeat maintenance status review';
      default:
        return latestSessionText;
    }
  }

  private buildMemorySections(context: {
    pinnedSection: string;
    recalledSection: string;
    omittedCount: number;
    estimatedTokens: number;
    logId: string | null;
  }, budget: number): PromptContextSection {
    const sections = [context.pinnedSection, context.recalledSection].filter(section => section.trim().length > 0);
    if (sections.length === 0 || budget <= 0) {
      return {
        body: '',
        omittedCount: context.omittedCount,
        estimatedTokens: 0,
        logId: context.logId,
      };
    }

    const body = sections.join('\n\n');
    const sectionTokens = countTokens(body);
    if (sectionTokens <= budget) {
      return {
        body,
        omittedCount: context.omittedCount,
        estimatedTokens: sectionTokens,
        logId: context.logId,
      };
    }

    const trimmed = this.buildBudgetedSection('PINNED AND RECALLED MEMORY', body, budget);
    return {
      body: trimmed,
      omittedCount: context.omittedCount,
      estimatedTokens: trimmed ? countTokens(trimmed) : 0,
      logId: context.logId,
    };
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
