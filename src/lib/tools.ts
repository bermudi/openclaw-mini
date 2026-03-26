// OpenClaw Agent Runtime - Tools/Skills System
// Defines available tools that agents can use

import type { Tool as CoreTool } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';
import { asSchema, tool } from '@ai-sdk/provider-utils';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { taskQueue } from '@/lib/services/task-queue';
import { sessionService } from '@/lib/services/session-service';
import { db } from '@/lib/db';
import { auditService } from '@/lib/services/audit-service';
import { buildInternalAuthHeaders } from '@/lib/internal-auth';
import { getSkillForSubAgent } from '@/lib/services/skill-service';
import { getBuiltInSkillsDir, getManagedSkillsDir } from '@/lib/services/skill-loaders';
import { getOverrideFieldsApplied } from '@/lib/subagent-config';
import { getRuntimeConfig } from '@/lib/config/runtime';
import { getMemoryDir, memoryService } from '@/lib/services/memory-service';
import { resolveSandboxPath } from '@/lib/services/sandbox-service';
import {
  buildExecLaunch,
  isExecTierAllowed,
  surfaceExecFiles,
  type ExecCommandMode,
} from '@/lib/services/exec-runtime';
import { processSupervisor } from '@/lib/services/process-supervisor';
import { parseCommand, getBinaryBasename, capCombinedOutput } from '@/lib/utils/exec-helpers';
import { existsSync } from 'fs';
import type { Attachment, DeliveryTarget, TaskType, VisionInput } from '@/lib/types';
import { SearchService, getSearchProvider } from '@/lib/services/search-service';
import { browserService } from '@/lib/services/browser-service';
import { mcpService } from '@/lib/services/mcp-service';

function assertNever(value: never): never {
  throw new Error(`Unsupported browser action: ${String(value)}`);
}

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface ToolExecutionContext {
  agentId: string;
  taskId: string;
  taskType: TaskType;
  sessionId?: string;
  parentTaskId?: string;
  deliveryTarget?: DeliveryTarget;
  spawnDepth?: number;
  allowedSkills?: string[];
  allowedTools?: string[];
  maxToolInvocations?: number;
  toolInvocationCount?: { count: number };
}

export type SpawnSubagentContext = ToolExecutionContext;

export function withToolExecutionContext<T>(context: ToolExecutionContext, fn: () => Promise<T>): Promise<T> {
  return toolExecutionContext.run(
    {
      ...context,
      toolInvocationCount: context.toolInvocationCount ?? { count: 0 },
    },
    fn,
  );
}

export function withSpawnSubagentContext<T>(context: SpawnSubagentContext, fn: () => Promise<T>): Promise<T> {
  return withToolExecutionContext(context, fn);
}

export function getToolExecutionContext(): ToolExecutionContext | undefined {
  return toolExecutionContext.getStore();
}

export interface SurfaceDirective {
  type: 'text' | 'file';
  content?: string;
  filePath?: string;
  mimeType?: string;
  caption?: string;
}

export function isSurfaceDirective(value: unknown): value is SurfaceDirective {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.type !== 'text' && candidate.type !== 'file') {
    return false;
  }

  if (candidate.content !== undefined && typeof candidate.content !== 'string') {
    return false;
  }

  if (candidate.filePath !== undefined && typeof candidate.filePath !== 'string') {
    return false;
  }

  if (candidate.mimeType !== undefined && typeof candidate.mimeType !== 'string') {
    return false;
  }

  if (candidate.caption !== undefined && typeof candidate.caption !== 'string') {
    return false;
  }

  return true;
}

export function normalizeSurfaceDirectives(value: unknown): SurfaceDirective[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isSurfaceDirective);
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  surface?: SurfaceDirective[];
}

export interface ToolMeta {
  riskLevel: 'low' | 'medium' | 'high';
}

export interface RegisteredTool {
  name: string;
  tool: CoreTool;
  meta: ToolMeta;
}

// ============================================
// Tool Registry
// ============================================
const tools: Map<string, CoreTool> = new Map();
const toolMeta: Map<string, ToolMeta> = new Map();
const toolExecutionContext = new AsyncLocalStorage<ToolExecutionContext>();

export function registerTool(name: string, registeredTool: CoreTool, meta: ToolMeta): void {
  const execute = registeredTool.execute;
  const wrappedTool = execute
    ? {
        ...registeredTool,
        execute: async (input: unknown, options: unknown) => {
          const context = getToolExecutionContext();
          const invocationCount = context?.toolInvocationCount;

          if (context?.allowedTools) {
            const allowedTools = new Set(context.allowedTools.map(toolName => toolName.toLowerCase()));
            if (!allowedTools.has(name.toLowerCase())) {
              throw new Error(`Tool '${name}' is not permitted for this sub-agent`);
            }
          }

          if (context?.maxToolInvocations !== undefined && invocationCount) {
            if (invocationCount.count >= context.maxToolInvocations) {
              throw new Error(
                `Tool invocation limit of ${context.maxToolInvocations} reached for this sub-agent`,
              );
            }
            invocationCount.count += 1;
          }

          if (name === 'spawn_subagent' && context?.allowedSkills) {
            const requestedSkill = typeof (input as { skill?: unknown }).skill === 'string'
              ? (input as { skill: string }).skill
              : undefined;
            const allowedSkills = new Set(context.allowedSkills.map(skillName => skillName.toLowerCase()));

            if (requestedSkill && !allowedSkills.has(requestedSkill.toLowerCase())) {
              throw new Error(`Skill '${requestedSkill}' is not permitted for this sub-agent`);
            }
          }

          return execute(input, options as never);
        },
      }
    : registeredTool;

  tools.set(name, wrappedTool as CoreTool);
  toolMeta.set(name, meta);
}

export function unregisterTool(name: string): void {
  tools.delete(name);
  toolMeta.delete(name);
}

export function getTool(name: string): CoreTool | undefined {
  return tools.get(name);
}

export function getToolMeta(name: string): ToolMeta | undefined {
  return toolMeta.get(name);
}

export function getAvailableTools(): RegisteredTool[] {
  return Array.from(tools.entries()).flatMap(([name, registeredTool]) => {
    const meta = toolMeta.get(name);
    if (!meta) return [];
    return [{ name, tool: registeredTool, meta }];
  });
}

export function getAvailableToolNames(): string[] {
  return getAvailableTools().map(tool => tool.name);
}

function jsonSchemaToParameters(schema: JSONSchema7): ToolParameter[] {
  if (typeof schema === 'boolean') return [];
  if (schema.type !== 'object' || !schema.properties) return [];

  const required = new Set(schema.required ?? []);

  return Object.entries(schema.properties).map(([name, definition]) => {
    if (typeof definition === 'boolean') {
      return {
        name,
        type: 'boolean',
        description: '',
        required: required.has(name),
      };
    }

    const typeValue = definition.type;
    const type = Array.isArray(typeValue)
      ? typeValue.join(' | ')
      : typeValue ?? 'object';

    return {
      name,
      type,
      description: definition.description ?? '',
      required: required.has(name),
    };
  });
}

export async function getToolSchemas(): Promise<Array<{
  name: string;
  description: string;
  parameters: ToolParameter[];
  riskLevel: ToolMeta['riskLevel'];
  inputSchema: JSONSchema7;
}>> {
  const toolEntries = getAvailableTools();

  return Promise.all(
    toolEntries.map(async ({ name, tool: registeredTool, meta }) => {
      const schema = await asSchema(registeredTool.inputSchema).jsonSchema;
      return {
        name,
        description: registeredTool.description ?? '',
        parameters: jsonSchemaToParameters(schema),
        riskLevel: meta.riskLevel,
        inputSchema: schema,
      };
    }),
  );
}

export function getToolsForAgent(_skills: string[]): Record<string, CoreTool> {
  const allTools = getAvailableTools();
  return Object.fromEntries(allTools.map(({ name, tool: registeredTool }) => [name, registeredTool]));
}

export function getLowRiskTools(): Record<string, CoreTool> {
  return Object.fromEntries(
    getAvailableTools()
      .filter(({ meta }) => meta.riskLevel === 'low')
      .map(({ name, tool: registeredTool }) => [name, registeredTool]),
  );
}

export function getToolsByNames(names: string[]): Record<string, CoreTool> {
  const allowed = new Set(names.map(name => name.toLowerCase()));
  return Object.fromEntries(
    getAvailableTools()
      .filter(({ name }) => allowed.has(name.toLowerCase()))
      .map(({ name, tool: registeredTool }) => [name, registeredTool]),
  );
}

const browserActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('navigate'),
    url: z.string().url().describe('The URL to navigate to'),
  }),
  z.object({
    action: z.literal('click'),
    url: z.string().url().describe('The URL to navigate to before clicking'),
    selector: z.string().min(1).describe('CSS selector for the element to click'),
  }),
  z.object({
    action: z.literal('type'),
    url: z.string().url().describe('The URL to navigate to before typing'),
    selector: z.string().min(1).describe('CSS selector for the input element'),
    text: z.string().describe('Text to type into the element'),
  }),
  z.object({
    action: z.literal('screenshot'),
    url: z.string().url().describe('The URL to capture'),
    fullPage: z.boolean().optional().describe('Capture the full scrollable page'),
  }),
  z.object({
    action: z.literal('get_text'),
    url: z.string().url().describe('The URL to extract text from'),
    selector: z.string().min(1).optional().describe('Optional CSS selector to scope text extraction'),
  }),
  z.object({
    action: z.literal('evaluate'),
    url: z.string().url().describe('The URL to evaluate JavaScript on'),
    script: z.string().min(1).describe('JavaScript expression to evaluate in the page context'),
  }),
  z.object({
    action: z.literal('pdf'),
    url: z.string().url().describe('The URL to render as PDF'),
    agentId: z.string().min(1).describe('Agent ID used to resolve the sandbox output directory'),
  }),
]);

export async function registerOptionalTools(): Promise<void> {
  const browserAvailable = await browserService.checkAvailability();

  if (browserAvailable) {
    registerTool(
      'browser_action',
      tool({
        description: 'Control a Playwright browser to navigate, interact, extract content, capture screenshots, and generate PDFs.',
        inputSchema: browserActionSchema,
        execute: async (input): Promise<ToolResult> => {
          switch (input.action) {
            case 'navigate':
              return browserService.executeAction('navigate', { url: input.url });
            case 'click':
              return browserService.executeAction('click', { url: input.url, selector: input.selector });
            case 'type':
              return browserService.executeAction('type', { url: input.url, selector: input.selector, text: input.text });
            case 'screenshot':
              return browserService.executeAction('screenshot', { url: input.url, fullPage: input.fullPage });
            case 'get_text':
              return browserService.executeAction('get_text', { url: input.url, selector: input.selector });
            case 'evaluate':
              return browserService.executeAction('evaluate', { url: input.url, script: input.script });
            case 'pdf':
              return browserService.executeAction('pdf', { url: input.url, agentId: input.agentId });
            default:
              assertNever(input);
          }
        },
      }),
      { riskLevel: 'high' },
    );
  }

  if (!browserAvailable) {
    unregisterTool('browser_action');
  }
}

const spawnSubagentAttachmentSchema = z.object({
  channelFileId: z.string().describe('Stable channel-specific file identifier for the attachment'),
  localPath: z.string().describe('Local filesystem path to the downloaded attachment'),
  filename: z.string().describe('Original filename for the attachment'),
  mimeType: z.string().describe('MIME type of the attachment'),
  size: z.number().int().nonnegative().optional().describe('Optional attachment size in bytes'),
});

const spawnSubagentVisionInputSchema = z.object({
  channelFileId: z.string().describe('Stable channel-specific file identifier for the vision input'),
  localPath: z.string().describe('Local filesystem path to the downloaded image'),
  mimeType: z.string().describe('MIME type of the image'),
});

registerTool(
  'spawn_subagent',
  tool({
    description: 'Spawn a sub-agent to execute a focused task using a specific skill',
    inputSchema: z.object({
      skill: z.string().describe('Skill name to use for the sub-agent'),
      task: z.string().describe('Task to assign to the sub-agent'),
      attachments: z.array(spawnSubagentAttachmentSchema).optional().describe('Optional attachments to pass through to the child task'),
      visionInputs: z.array(spawnSubagentVisionInputSchema).optional().describe('Optional vision inputs to pass through to the child task'),
      timeoutSeconds: z.number().int().positive().optional().describe('Timeout in seconds (default: 120)'),
    }),
    execute: async ({ skill, task, attachments, visionInputs, timeoutSeconds }: {
      skill: string;
      task: string;
      attachments?: Attachment[];
      visionInputs?: VisionInput[];
      timeoutSeconds?: number;
    }): Promise<ToolResult> => {
      const context = getToolExecutionContext();
      if (!context) {
        return { success: false, error: 'spawn_subagent called without task context' };
      }

      const { maxSpawnDepth, subagentTimeout: defaultTimeout } = getRuntimeConfig().safety;

      // 2.3: Compute child depth and reject if it would exceed the limit
      const spawnDepth = context.spawnDepth ?? 0;
      const childDepth = spawnDepth + 1;
      if (childDepth > maxSpawnDepth) {
        return { success: false, error: `Maximum spawn depth of ${maxSpawnDepth} exceeded` };
      }

      const skillResult = await getSkillForSubAgent(skill);
      if (!skillResult.skill) {
        return { success: false, error: skillResult.error ?? `Skill '${skill}' not found or disabled` };
      }

      const skillName = skillResult.skill.name;

      // 2.5: Pass spawnDepth: childDepth when creating the child task
      const newTask = await taskQueue.createTask({
        agentId: context.agentId,
        type: 'subagent',
        priority: 5,
        payload: {
          task,
          skill: skillName,
          skillTools: skillResult.skill.tools,
          overrides: skillResult.skill.overrides,
          attachments,
          visionInputs,
          deliveryTarget: context.deliveryTarget,
        },
        source: `subagent:${context.taskId}`,
        parentTaskId: context.taskId,
        skillName,
        spawnDepth: childDepth,
      });

      const childTaskId = newTask.id;

      await auditService.log({
        action: 'subagent_task_dispatched',
        entityType: 'task',
        entityId: childTaskId,
        details: {
          agentId: context.agentId,
          parentTaskId: context.taskId,
          skill: skillName,
          overrideFieldsApplied: getOverrideFieldsApplied(skillResult.skill.overrides),
        },
      });

      const sessionScope = `subagent:${childTaskId}`;
      const session = await sessionService.getOrCreateSession(
        context.agentId,
        sessionScope,
        'internal',
        sessionScope,
      );

      await db.task.update({
        where: { id: childTaskId },
        data: { sessionId: session.id },
      });

      const cleanupSession = async () => {
        if (session?.id) {
          await sessionService.deleteSession(session.id);
        }
      };

      const timeoutMs = Math.max(1, timeoutSeconds ?? defaultTimeout) * 1000;
      const deadline = Date.now() + timeoutMs;
      const baseDelayMs = 500;
      const maxDelayMs = 5000;
      let delayMs = baseDelayMs;
      let lastStatus: string | undefined;

      while (Date.now() < deadline) {
        const current = await taskQueue.getTask(childTaskId);
        if (!current) {
          await cleanupSession();
          // 5.3: Structured error for task disappeared
          return {
            success: false,
            error: 'Sub-agent task disappeared',
            data: { skill: skillName, depth: childDepth, childTaskId },
          };
        }

        if (current.status !== lastStatus) {
          delayMs = baseDelayMs;
          lastStatus = current.status;
        }

        if (current.status === 'completed') {
          const resultValue = current.result;
          const response =
            typeof resultValue === 'object' && resultValue !== null &&
            typeof (resultValue as { response?: unknown }).response === 'string'
              ? (resultValue as { response: string }).response
              : undefined;
          const surfaces =
            typeof resultValue === 'object' && resultValue !== null
              ? normalizeSurfaceDirectives((resultValue as { surfaces?: unknown }).surfaces)
              : [];

          if (!response) {
            await cleanupSession();
            return { success: false, error: 'Sub-agent completed without a valid response' };
          }
          await cleanupSession();
          return {
            success: true,
            data: {
              response,
              skill: skillName,
              ...(surfaces.length > 0 ? { surfaces } : {}),
            },
          };
        }

        if (current.status === 'failed') {
          await cleanupSession();
          // 5.1: Structured error for failure
          return {
            success: false,
            error: `Sub-agent failed: ${current.error ?? 'unknown error'}`,
            data: { skill: skillName, depth: childDepth, childTaskId },
          };
        }

        const jitter = Math.floor(delayMs * 0.1 * Math.random());
        await new Promise(resolve => setTimeout(resolve, delayMs + jitter));
        delayMs = Math.min(delayMs * 2, maxDelayMs);
      }

      // 3.1 & 3.2: Timeout — fail child task unless it already reached a terminal state
      const taskOnTimeout = await taskQueue.getTask(childTaskId);
      if (taskOnTimeout && taskOnTimeout.status !== 'completed' && taskOnTimeout.status !== 'failed') {
        await taskQueue.failTask(childTaskId, 'Sub-agent timed out');
      }

      const timeoutLabel = timeoutSeconds ?? defaultTimeout;
      await cleanupSession();
      // 5.2: Structured error for timeout
      return {
        success: false,
        error: `Sub-agent timed out after ${timeoutLabel}s`,
        data: { skill: skillName, depth: childDepth, childTaskId },
      };
    },
  }),
  { riskLevel: 'medium' },
);

// ============================================
// Built-in Tools
// ============================================

// Get current date/time
registerTool(
  'emit_to_chat',
  tool({
    description: 'Send text directly to the user chat without including it in your response',
    inputSchema: z.object({
      text: z.string().describe('Text to send to chat'),
    }),
    execute: async ({ text }): Promise<ToolResult> => ({
      success: true,
      data: { emitted: true },
      surface: [{ type: 'text', content: text }],
    }),
  }),
  { riskLevel: 'low' },
);

registerTool(
  'get_datetime',
  tool({
    description: 'Get the current date and time',
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      const now = new Date();
      return {
        success: true,
        data: {
          iso: now.toISOString(),
          unix: now.getTime(),
          formatted: now.toLocaleString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      };
    },
  }),
  { riskLevel: 'low' },
);

// Calculate expression
registerTool(
  'calculate',
  tool({
    description: 'Evaluate a mathematical expression safely',
    inputSchema: z.object({
      expression: z
        .string()
        .describe('The mathematical expression to evaluate (e.g., "2 + 2 * 3")'),
    }),
    execute: async ({ expression }): Promise<ToolResult> => {
      // Safe evaluation - only allow numbers and basic operators
      const safeExpression = expression.replace(/[^0-9+\-*/().%\s]/g, '');

      try {
        // Use Function constructor for safe evaluation
        const result = new Function(`return ${safeExpression}`)();

        if (typeof result !== 'number' || !isFinite(result)) {
          return { success: false, error: 'Invalid calculation result' };
        }

        return { success: true, data: { expression, result } };
      } catch {
        return { success: false, error: 'Failed to evaluate expression' };
      }
    },
  }),
  { riskLevel: 'low' },
);

// Read file from data directory
registerTool(
  'read_file',
  tool({
    description: 'Read a file from the agent memory directory',
    inputSchema: z.object({
      agentId: z.string().describe('The agent ID'),
      filename: z.string().describe('The filename to read (without path)'),
    }),
    execute: async ({ agentId, filename }): Promise<ToolResult> => {
      const fs = await import('fs');
      const path = await import('path');

      // Sanitize filename to prevent path traversal
      const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '');

      const filePath = path.join(getMemoryDir(), agentId, safeName);

      try {
        if (!fs.existsSync(filePath)) {
          return { success: false, error: 'File not found' };
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        return { success: true, data: { filename: safeName, content } };
      } catch (error) {
        return { success: false, error: `Failed to read file: ${error}` };
      }
    },
  }),
  { riskLevel: 'low' },
);

registerTool(
  'read_skill_file',
  tool({
    description: 'Read a built-in or managed SKILL.md file by logical skill name.',
    inputSchema: z.object({
      source: z.string().describe("Skill source to read from: 'built-in' or 'managed'"),
      skillName: z.string().describe('Logical skill name / directory name to read'),
    }),
    execute: async ({ source, skillName }): Promise<ToolResult> => {
      const fs = await import('fs');
      const path = await import('path');

      const normalizedSource = source.trim().toLowerCase();
      let skillsRoot: string;

      if (normalizedSource === 'built-in') {
        skillsRoot = getBuiltInSkillsDir();
      } else if (normalizedSource === 'managed') {
        skillsRoot = getManagedSkillsDir();
      } else {
        return {
          success: false,
          error: `Invalid skill source '${source}'. Use 'built-in' or 'managed'.`,
        };
      }

      const normalizedSkillName = skillName.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalizedSkillName)) {
        return {
          success: false,
          error: `Invalid skill name '${skillName}'. Skill names must stay within the allowed skill directories.`,
        };
      }

      const filePath = path.resolve(skillsRoot, normalizedSkillName, 'SKILL.md');
      const relativePath = path.relative(skillsRoot, filePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return {
          success: false,
          error: `Invalid skill name '${skillName}'. Skill names must stay within the allowed skill directories.`,
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `Skill file not found for ${normalizedSource} skill '${normalizedSkillName}' at ${filePath}`,
        };
      }

      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return {
          success: true,
          data: {
            source: normalizedSource,
            skillName: normalizedSkillName,
            filePath,
            content,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to read skill file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
  { riskLevel: 'low' },
);

// Write note to memory
registerTool(
  'write_note',
  tool({
    description: 'Write a note to the agent memory',
    inputSchema: z.object({
      agentId: z.string().describe('The agent ID'),
      title: z.string().describe('The note title'),
      content: z.string().describe('The note content (markdown)'),
    }),
    execute: async ({ agentId, title, content }): Promise<ToolResult> => {
      const fs = await import('fs');
      const path = await import('path');

      // Sanitize title for filename
      const safeTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50);
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `note-${timestamp}-${safeTitle}.md`;

      const dir = path.join(getMemoryDir(), agentId);

      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const filePath = path.join(dir, filename);
        const fullContent = `# ${title}\n\nCreated: ${new Date().toISOString()}\n\n${content}\n`;

        fs.writeFileSync(filePath, fullContent, 'utf-8');

        return { success: true, data: { filename, path: filePath } };
      } catch (error) {
        return { success: false, error: `Failed to write note: ${error}` };
      }
    },
  }),
  { riskLevel: 'low' },
);

registerTool(
  'memory_search',
  tool({
    description: 'Search the agent memory store using exact, keyword, and vector-backed recall',
    inputSchema: z.object({
      query: z.string().describe('Search query or memory key hint'),
      limit: z.number().int().positive().max(20).optional().describe('Maximum number of ranked results'),
    }),
    execute: async ({ query, limit }): Promise<ToolResult> => {
      const context = getToolExecutionContext();
      if (!context) {
        return { success: false, error: 'memory_search called without task context' };
      }

      try {
        await memoryService.processPendingIndexing();
        const result = await memoryService.searchMemories(context.agentId, query, limit);
        return {
          success: true,
          data: {
            query,
            results: result.results,
            recallLogId: result.logId,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Memory search failed',
        };
      }
    },
  }),
  { riskLevel: 'low' },
);

registerTool(
  'memory_get',
  tool({
    description: 'Get a canonical memory record by exact hierarchical key',
    inputSchema: z.object({
      key: z.string().describe('Exact memory key, e.g. user/name or system/preferences'),
    }),
    execute: async ({ key }): Promise<ToolResult> => {
      const context = getToolExecutionContext();
      if (!context) {
        return { success: false, error: 'memory_get called without task context' };
      }

      try {
        const result = await memoryService.getExactMemory(context.agentId, key);
        if (!result.memory) {
          return {
            success: false,
            error: `Memory not found: ${key}`,
          };
        }

        return {
          success: true,
          data: {
            memory: result.memory,
            retrievalMethod: result.retrievalMethod,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Memory lookup failed',
        };
      }
    },
  }),
  { riskLevel: 'low' },
);

// List files in memory
registerTool(
  'list_files',
  tool({
    description: 'List files in the agent memory directory',
    inputSchema: z.object({
      agentId: z.string().describe('The agent ID'),
    }),
    execute: async ({ agentId }): Promise<ToolResult> => {
      const fs = await import('fs');
      const path = await import('path');

      const dir = path.join(getMemoryDir(), agentId);

      try {
        if (!fs.existsSync(dir)) {
          return { success: true, data: { files: [] } };
        }

        const files = fs.readdirSync(dir).map((file) => {
          const stats = fs.statSync(path.join(dir, file));
          return {
            name: file,
            size: stats.size,
            modified: stats.mtime,
          };
        });

        return { success: true, data: { files } };
      } catch (error) {
        return { success: false, error: `Failed to list files: ${error}` };
      }
    },
  }),
  { riskLevel: 'low' },
);

// Web search using configured provider (Brave, Tavily, or DuckDuckGo fallback)
registerTool(
  'web_search',
  tool({
    description: 'Search the web for information',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      numResults: z
        .number()
        .optional()
        .describe('Number of results to return (default: 5)'),
    }),
    execute: async ({ query, numResults }): Promise<ToolResult> => {
      try {
        const provider = getSearchProvider();
        const searchService = new SearchService(provider);
        const results = await searchService.search(query, numResults ?? 5);

        return {
          success: true,
          data: {
            query,
            provider: provider.name,
            results,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown search error';
        return {
          success: false,
          error: `Search failed: ${message}`,
        };
      }
    },
  }),
  { riskLevel: 'medium' },
);

function stripHtmlToText(content: string): string {
  const noScript = content.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const noStyle = noScript.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const noTags = noStyle.replace(/<[^>]+>/g, ' ');
  return noTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWithTimeoutAndRedirects(url: string, timeoutMs: number, maxRedirects: number): Promise<Response> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        if (redirectCount === maxRedirects) {
          throw new Error(`Too many redirects (max ${maxRedirects})`);
        }

        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Redirect missing location header');
        }

        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      return response;
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        throw new Error(`Fetch timed out after ${Math.floor(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('Too many redirects');
}

registerTool(
  'web_fetch',
  tool({
    description: 'Fetch a URL and return extracted text content',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to fetch'),
    }),
    execute: async ({ url }): Promise<ToolResult> => {
      try {
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          return { success: false, error: 'Invalid URL' };
        }

        const response = await fetchWithTimeoutAndRedirects(parsedUrl.toString(), 15_000, 5);
        if (!response.ok) {
          return { success: false, error: `Fetch failed: HTTP ${response.status}` };
        }

        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        const rawText = await response.text();
        const isHtml = contentType.includes('text/html') || /<html[\s>]/i.test(rawText);
        const extracted = isHtml ? stripHtmlToText(rawText) : rawText;
        const truncated = extracted.length > 10_000;
        const content = truncated ? extracted.slice(0, 10_000) : extracted;

        return {
          success: true,
          data: {
            url: response.url || parsedUrl.toString(),
            content,
            truncated,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown fetch error';
        return {
          success: false,
          error: message,
        };
      }
    },
  }),
  { riskLevel: 'medium' },
);

registerTool(
  'mcp_list',
  tool({
    description: 'List configured MCP servers or discover tools on one MCP server.',
    inputSchema: z.object({
      server: z.string().optional().describe('Optional MCP server name. Omit to list configured servers.'),
    }),
    execute: async ({ server }): Promise<ToolResult> => {
      try {
        if (server) {
          const tools = await mcpService.listTools(server);
          return {
            success: true,
            data: {
              server,
              tools,
            },
          };
        }

        return {
          success: true,
          data: {
            servers: mcpService.listServers(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list MCP resources',
        };
      }
    },
  }),
  { riskLevel: 'low' },
);

registerTool(
  'mcp_call',
  tool({
    description: 'Call a tool on a configured MCP server.',
    inputSchema: z.object({
      server: z.string().min(1).describe('Configured MCP server name'),
      tool: z.string().min(1).describe('Tool name to invoke on the MCP server'),
      arguments: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the MCP tool'),
    }),
    execute: async ({ server, tool: toolName, arguments: args }): Promise<ToolResult> => {
      try {
        const result = await mcpService.callTool(server, toolName, args ?? {});
        return {
          success: true,
          data: {
            server,
            tool: toolName,
            result,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to call MCP tool',
        };
      }
    },
  }),
  { riskLevel: 'medium' },
);

// Wait/sleep
registerTool(
  'wait',
  tool({
    description: 'Wait for a specified number of seconds',
    inputSchema: z.object({
      seconds: z
        .number()
        .max(60)
        .describe('Number of seconds to wait (max: 60)'),
    }),
    execute: async ({ seconds }): Promise<ToolResult> =>
      new Promise((resolve) => {
        const clampedSeconds = Math.min(Math.max(0, seconds || 0), 60);
        setTimeout(() => {
          resolve({ success: true, data: { waited: clampedSeconds } });
        }, clampedSeconds * 1000);
      }),
  }),
  { riskLevel: 'low' },
);

// Generate random data
registerTool(
  'random',
  tool({
    description: 'Generate random data (number, UUID, string)',
    inputSchema: z.object({
      type: z.enum(['number', 'uuid', 'string']).describe('Type of random data'),
      length: z.number().optional().describe('Length for string type (default: 16)'),
    }),
    execute: async ({ type, length }): Promise<ToolResult> => {
      const resolvedLength = length ?? 16;

      switch (type) {
        case 'number':
          return { success: true, data: { value: Math.random() } };

        case 'uuid': {
          const { v4: uuidv4 } = await import('uuid');
          return { success: true, data: { value: uuidv4() } };
        }

        case 'string': {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
          let result = '';
          for (let i = 0; i < Math.min(resolvedLength, 100); i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          return { success: true, data: { value: result } };
        }

        default:
          return { success: false, error: 'Invalid type. Use: number, uuid, or string' };
      }
    },
  }),
  { riskLevel: 'low' },
);

// Agent communication (A2A)
registerTool(
  'send_message_to_agent',
  tool({
    description: 'Send a message to another agent',
    inputSchema: z.object({
      fromAgentId: z.string().describe('The sender agent ID'),
      toAgentId: z.string().describe('The recipient agent ID'),
      message: z.string().describe('The message to send'),
      data: z.record(z.string(), z.unknown()).optional().describe('Optional data to include'),
    }),
    execute: async ({ fromAgentId, toAgentId, message, data }): Promise<ToolResult> => {
      try {
        const response = await fetch('http://localhost:3000/api/input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: {
              type: 'a2a',
              fromAgentId,
              toAgentId,
              message,
              data,
            },
          }),
        });

        const result = await response.json();

        if (result.success) {
          return { success: true, data: { taskId: result.data.taskId } };
        }
        return { success: false, error: result.error };
      } catch (error) {
        return { success: false, error: `Failed to send message: ${error}` };
      }
    },
  }),
  { riskLevel: 'low' },
);

// Log event
registerTool(
  'log_event',
  tool({
    description: 'Log an event to the agent history',
    inputSchema: z.object({
      agentId: z.string().describe('The agent ID'),
      event: z.string().describe('The event description'),
      category: z.string().optional().describe('Event category: info, warning, error'),
    }),
    execute: async ({ agentId, event, category }): Promise<ToolResult> => {
      const resolvedCategory = category || 'info';

      try {
        const response = await fetch(`http://localhost:3000/api/agents/${agentId}/memory`, {
          method: 'POST',
          headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            key: 'system/history',
            entry: `[${resolvedCategory.toUpperCase()}] ${event}`,
          }),
        });

        const result = await response.json();

        if (result.success) {
          return { success: true, data: { logged: true } };
        }
        return { success: false, error: result.error };
      } catch (error) {
        return { success: false, error: `Failed to log event: ${error}` };
      }
    },
  }),
  { riskLevel: 'low' },
);

// ============================================
// exec_command / process tools
// ============================================

// Re-export helpers so callers can import from one place
export { parseCommand, getBinaryBasename } from '@/lib/utils/exec-helpers';
export { truncateOutput } from '@/lib/utils/exec-helpers';

const execTierSchema = z.enum(['host', 'sandbox', 'locked-down']);
const execLaunchModeSchema = z.enum(['child', 'pty']);
const execCommandModeSchema = z.enum(['direct', 'shell']);

const execCommandInputSchema = z.object({
  agentId: z.string().describe('The agent ID (used to scope sandbox and exec mounts)'),
  command: z.string().describe('The command to execute'),
  tier: execTierSchema.optional().describe('Execution tier: host, sandbox, or locked-down'),
  launchMode: execLaunchModeSchema.optional().describe('Launch mode: child for non-interactive, pty for interactive terminal sessions'),
  commandMode: execCommandModeSchema.optional().describe('Command mode: direct parses argv and enforces allowlist; shell runs through a shell according to tier policy'),
  background: z.boolean().optional().describe('Whether to hand the process off as a supervised session immediately'),
  cwd: z.string().optional().describe('Optional working directory. Use mount:<alias>/... to target configured execution mounts'),
  surfaceOutput: z.boolean().optional().describe('Whether to surface stdout directly to chat when the command completes in the foreground'),
  surfaceFiles: z.array(z.string()).optional().describe('Optional file paths to surface after foreground completion. Files outside the sandbox but inside approved mounts are copied into sandbox output first'),
});

const processToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list'),
    agentId: z.string().optional().describe('Optional agent ID filter. Defaults to the current tool context agent when available'),
  }),
  z.object({
    action: z.literal('poll'),
    sessionId: z.string().min(1).describe('Process session identifier'),
    offset: z.number().int().nonnegative().optional().describe('Read output starting from this absolute offset'),
    limit: z.number().int().positive().optional().describe('Maximum number of characters to return'),
  }),
  z.object({
    action: z.literal('log'),
    sessionId: z.string().min(1).describe('Process session identifier'),
    offset: z.number().int().nonnegative().optional().describe('Read output starting from this absolute offset'),
    limit: z.number().int().positive().optional().describe('Maximum number of characters to return'),
  }),
  z.object({
    action: z.literal('write'),
    sessionId: z.string().min(1).describe('Process session identifier'),
    input: z.string().describe('Raw PTY input to forward to the running session'),
  }),
  z.object({
    action: z.literal('kill'),
    sessionId: z.string().min(1).describe('Process session identifier'),
  }),
]);

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function buildProcessHandleData(input: {
  sessionId: string;
  status: string;
  tier: string;
  launchMode: string;
  commandMode: string;
  background: boolean;
}): Record<string, unknown> {
  return {
    sessionId: input.sessionId,
    sessionStatus: input.status,
    tier: input.tier,
    launchMode: input.launchMode,
    commandMode: input.commandMode,
    background: input.background,
  };
}

function assertProcessSessionAccess(sessionId: string, context?: ToolExecutionContext): void {
  if (!context?.agentId) {
    return;
  }

  const session = processSupervisor.getSessionSnapshot(sessionId);
  if (session.agentId !== context.agentId) {
    throw new Error(`Process session ${sessionId} is not accessible for agent '${context.agentId}'`);
  }
}

registerTool(
  'exec_command',
  tool({
    description: 'Execute commands using the configured exec runtime with explicit execution tier, child or PTY launch mode, background handoff, and mount-aware working directories.',
    inputSchema: execCommandInputSchema,
    execute: async ({
      agentId,
      command,
      tier,
      launchMode,
      commandMode,
      background,
      cwd,
      surfaceOutput,
      surfaceFiles,
    }): Promise<ToolResult> => {
      const config = getRuntimeConfig().exec;
      const context = getToolExecutionContext();

      if (!config.enabled) {
        return { success: false, error: 'exec_command is disabled. Set runtime.exec.enabled to true in openclaw.json.' };
      }

      const resolvedTier = tier ?? config.defaultTier;
      if (!isExecTierAllowed(resolvedTier, config.maxTier)) {
        return {
          success: false,
          error: `Execution tier '${resolvedTier}' exceeds configured maxTier '${config.maxTier}'`,
        };
      }

      const resolvedLaunchMode = launchMode ?? config.defaultLaunchMode;
      const resolvedCommandMode: ExecCommandMode = commandMode ?? (resolvedLaunchMode === 'pty' ? 'shell' : 'direct');
      const resolvedBackground = background ?? config.defaultBackground;

      if (resolvedBackground && surfaceFiles && surfaceFiles.length > 0) {
        return {
          success: false,
          error: 'surfaceFiles require foreground completion. Re-run without backgrounding, or surface files later with send_file_to_chat.',
        };
      }

      const activeSessions = processSupervisor
        .listSessions(agentId)
        .filter(session => session.status === 'starting' || session.status === 'running').length;
      if (activeSessions >= config.maxSessions) {
        return {
          success: false,
          error: `Maximum exec session limit reached for agent '${agentId}' (${config.maxSessions})`,
        };
      }

      const maxTimeoutSeconds = Math.min(config.maxTimeout, 300);
      const maxOutputSize = Math.min(config.maxOutputSize, 1_000_000);
      const sessionBufferSize = Math.min(config.sessionBufferSize, 2_000_000);

      let prepared;
      try {
        prepared = buildExecLaunch({
          agentId,
          command,
          tier: resolvedTier,
          launchMode: resolvedLaunchMode,
          commandMode: resolvedCommandMode,
          cwd,
          allowlist: config.allowlist,
          mounts: config.mounts,
          containerRuntime: config.containerRuntime,
          timeoutMs: maxTimeoutSeconds * 1000,
          ptyCols: config.ptyCols,
          ptyRows: config.ptyRows,
        });
      } catch (error) {
        return { success: false, error: toErrorMessage(error, 'Failed to prepare exec launch') };
      }

      const spawnInput = prepared.spawn.mode === 'pty'
        ? { ...prepared.spawn, forceFallback: config.forcePtyFallback }
        : prepared.spawn;

      let session;
      try {
        session = await processSupervisor.spawnSession({
          agentId,
          taskId: context?.taskId,
          tier: resolvedTier,
          launchMode: resolvedLaunchMode,
          bufferSize: sessionBufferSize,
          sessionTimeoutMs: maxTimeoutSeconds * 1000,
          spawn: spawnInput,
        });
      } catch (error) {
        return { success: false, error: toErrorMessage(error, 'Failed to start process session') };
      }

      if (session.status === 'failed' || session.status === 'cancelled' || session.status === 'timed_out') {
        const failedSession = await processSupervisor.waitForSession(session.sessionId);

        if (failedSession?.reason === 'spawn-error') {
          return {
            success: false,
            error: failedSession.stderr.trim() || 'Failed to launch command',
          };
        }

        if (failedSession?.status === 'timed_out') {
          return {
            success: false,
            error: `Command timed out after ${maxTimeoutSeconds} seconds`,
          };
        }

        if (failedSession?.reason === 'manual-cancel') {
          return {
            success: false,
            error: 'Command was cancelled before completion',
          };
        }

        if (failedSession?.reason === 'signal') {
          return {
            success: false,
            error: `Command exited due to signal ${String(failedSession.signal ?? 'unknown')}`,
          };
        }
      }

      const shouldHandOffImmediately = resolvedBackground || resolvedLaunchMode === 'pty';
      if (shouldHandOffImmediately) {
        return {
          success: true,
          data: buildProcessHandleData({
            sessionId: session.sessionId,
            status: session.status,
            tier: resolvedTier,
            launchMode: resolvedLaunchMode,
            commandMode: resolvedCommandMode,
            background: true,
          }),
        };
      }

      const completed = await processSupervisor.waitForSession(session.sessionId, config.foregroundYieldMs);

      if (!completed) {
        return {
          success: true,
          data: buildProcessHandleData({
            sessionId: session.sessionId,
            status: session.status,
            tier: resolvedTier,
            launchMode: resolvedLaunchMode,
            commandMode: resolvedCommandMode,
            background: true,
          }),
        };
      }

      if (completed.reason === 'spawn-error') {
        return {
          success: false,
          error: completed.stderr.trim() || 'Failed to launch command',
        };
      }

      if (completed.status === 'timed_out') {
        return {
          success: false,
          error: `Command timed out after ${maxTimeoutSeconds} seconds`,
        };
      }

      if (completed.reason === 'manual-cancel') {
        return {
          success: false,
          error: 'Command was cancelled before completion',
        };
      }

      if (completed.reason === 'signal') {
        return {
          success: false,
          error: `Command exited due to signal ${String(completed.signal ?? 'unknown')}`,
        };
      }

      const capped = capCombinedOutput(completed.stdout, completed.stderr, maxOutputSize);
      const surfaces: SurfaceDirective[] = [];

      if (surfaceOutput && capped.stdout.length > 0) {
        surfaces.push({ type: 'text', content: capped.stdout });
      }

      if (surfaceFiles && surfaceFiles.length > 0) {
        try {
          const surfacedFiles = surfaceExecFiles({
            agentId,
            files: surfaceFiles,
            workingDirectory: prepared.workingDirectory,
            mounts: prepared.mounts,
          });

          for (const surfacedFile of surfacedFiles) {
            surfaces.push({
              type: 'file',
              filePath: surfacedFile.surfacedPath,
              mimeType: detectMimeType(surfacedFile.surfacedPath),
            });
          }
        } catch (error) {
          return {
            success: false,
            error: toErrorMessage(error, 'Failed to surface output files'),
          };
        }
      }

      return {
        success: true,
        data: {
          stdout: capped.stdout,
          stderr: capped.stderr,
          exitCode: completed.exitCode ?? 0,
          outputTruncated: capped.truncated,
          tier: resolvedTier,
          launchMode: resolvedLaunchMode,
          commandMode: resolvedCommandMode,
        },
        ...(surfaces.length > 0 ? { surface: surfaces } : {}),
      };
    },
  }),
  { riskLevel: 'high' },
);

registerTool(
  'process',
  tool({
    description: 'Interact with supervised exec sessions using canonical actions: list, poll, log, write, and kill.',
    inputSchema: processToolInputSchema,
    execute: async (input): Promise<ToolResult> => {
      const config = getRuntimeConfig().exec;
      const context = getToolExecutionContext();

      if (!config.enabled) {
        return { success: false, error: 'process is unavailable because runtime.exec.enabled is false' };
      }

      try {
        switch (input.action) {
          case 'list': {
            const agentFilter = input.agentId ?? context?.agentId;
            return {
              success: true,
              data: {
                sessions: processSupervisor.listSessions(agentFilter),
              },
            };
          }
          case 'poll': {
            assertProcessSessionAccess(input.sessionId, context);
            return {
              success: true,
              data: processSupervisor.pollSession(input.sessionId, input.offset, input.limit),
            };
          }
          case 'log': {
            assertProcessSessionAccess(input.sessionId, context);
            return {
              success: true,
              data: processSupervisor.readSessionLog(input.sessionId, input.offset, input.limit),
            };
          }
          case 'write': {
            assertProcessSessionAccess(input.sessionId, context);
            return {
              success: true,
              data: processSupervisor.writeSession(input.sessionId, input.input),
            };
          }
          case 'kill': {
            assertProcessSessionAccess(input.sessionId, context);
            return {
              success: true,
              data: processSupervisor.killSession(input.sessionId),
            };
          }
          default:
            assertNever(input);
        }
      } catch (error) {
        return {
          success: false,
          error: toErrorMessage(error, 'Process session operation failed'),
        };
      }
    },
  }),
  { riskLevel: 'medium' },
);

const MIME_TYPE_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
};

function detectMimeType(filename: string, fallback?: string): string {
  const lastDot = filename.lastIndexOf('.');
  const ext = lastDot === -1 ? '' : filename.slice(lastDot).toLowerCase();
  return MIME_TYPE_MAP[ext] ?? fallback ?? 'application/octet-stream';
}

registerTool(
  'send_file_to_chat',
  tool({
    description: 'Send a file from the agent sandbox to the chat. The file path is relative to the sandbox directory.',
    inputSchema: z.object({
      agentId: z.string().describe('The agent ID (used to determine sandbox directory)'),
      filePath: z.string().describe('Path to the file, relative to the agent sandbox directory'),
      caption: z.string().optional().describe('Optional caption to include with the file'),
      mimeType: z.string().optional().describe('MIME type of the file (auto-detected from extension if not provided)'),
    }),
    execute: async ({ agentId, filePath, caption, mimeType }): Promise<ToolResult> => {
      const context = getToolExecutionContext();
      if (!context) {
        return { success: false, error: 'send_file_to_chat called without task context' };
      }

      let resolvedPath: string;
      try {
        resolvedPath = resolveSandboxPath(agentId, filePath);
      } catch (error) {
        return { success: false, error: `Invalid file path: ${error instanceof Error ? error.message : 'Unknown error'}` };
      }

      if (!existsSync(resolvedPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      if (!context.deliveryTarget) {
        return { success: false, error: 'send_file_to_chat requires a delivery target' };
      }

      const detectedMimeType = detectMimeType(filePath, mimeType);

      return {
        success: true,
        data: {
          filePath: resolvedPath,
          mimeType: detectedMimeType,
          caption,
          deliveryTarget: context.deliveryTarget,
        },
        surface: [{ type: 'file', filePath: resolvedPath, mimeType: detectedMimeType, caption }],
      };
    },
  }),
  { riskLevel: 'medium' },
);

export { tools };
