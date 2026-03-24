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
import { getSkillForSubAgent } from '@/lib/services/skill-service';
import { getOverrideFieldsApplied } from '@/lib/subagent-config';
import { getRuntimeConfig } from '@/lib/config/runtime';
import { getMemoryDir } from '@/lib/services/memory-service';
import { getSandboxDir, resolveSandboxPath } from '@/lib/services/sandbox-service';
import { enqueueFileDeliveryTx } from '@/lib/services/delivery-service';
import { parseCommand, getBinaryBasename, capCombinedOutput } from '@/lib/utils/exec-helpers';
import { existsSync } from 'fs';
import type { ChannelType } from '@/lib/types';
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

export function withSpawnSubagentContext<T>(context: SpawnSubagentContext, fn: () => Promise<T>): Promise<T> {
  return spawnSubagentContext.run(
    {
      ...context,
      toolInvocationCount: context.toolInvocationCount ?? { count: 0 },
    },
    fn,
  );
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolMeta {
  riskLevel: 'low' | 'medium' | 'high';
}

export interface RegisteredTool {
  name: string;
  tool: CoreTool;
  meta: ToolMeta;
}

export interface SpawnSubagentContext {
  agentId: string;
  parentTaskId: string;
  spawnDepth?: number;
  allowedSkills?: string[];
  allowedTools?: string[];
  maxToolInvocations?: number;
  toolInvocationCount?: { count: number };
}

// ============================================
// Tool Registry
// ============================================
const tools: Map<string, CoreTool> = new Map();
const toolMeta: Map<string, ToolMeta> = new Map();
const spawnSubagentContext = new AsyncLocalStorage<SpawnSubagentContext>();

export function registerTool(name: string, registeredTool: CoreTool, meta: ToolMeta): void {
  const execute = registeredTool.execute;
  const wrappedTool = execute
    ? {
        ...registeredTool,
        execute: async (input: unknown, options: unknown) => {
          const context = spawnSubagentContext.getStore();
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

registerTool(
  'spawn_subagent',
  tool({
    description: 'Spawn a sub-agent to execute a focused task using a specific skill',
    inputSchema: z.object({
      skill: z.string().describe('Skill name to use for the sub-agent'),
      task: z.string().describe('Task to assign to the sub-agent'),
      timeoutSeconds: z.number().int().positive().optional().describe('Timeout in seconds (default: 120)'),
    }),
    execute: async ({ skill, task, timeoutSeconds }): Promise<ToolResult> => {
      const context = spawnSubagentContext.getStore();
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
          systemPrompt: skillResult.skill.instructions,
          overrides: skillResult.skill.overrides,
        },
        source: `subagent:${context.parentTaskId}`,
        parentTaskId: context.parentTaskId,
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
          parentTaskId: context.parentTaskId,
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

          if (!response) {
            await cleanupSession();
            return { success: false, error: 'Sub-agent completed without a valid response' };
          }
          return {
            success: true,
            data: {
              response,
              skill: skillName,
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
          headers: { 'Content-Type': 'application/json' },
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
// exec_command tool (registered always; enabled check is inside execute)
// ============================================

// Re-export helpers so callers can import from one place
export { parseCommand, getBinaryBasename } from '@/lib/utils/exec-helpers';
export { truncateOutput } from '@/lib/utils/exec-helpers';

// Minimal safe environment to pass to sandboxed commands
function buildSafeEnv(): NodeJS.ProcessEnv {
  // NODE_ENV is included because bun-types requires it in ProcessEnv; it is not sensitive
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TERM: 'dumb',
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  };
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
  return env as NodeJS.ProcessEnv;
}

registerTool(
  'exec_command',
  tool({
    description: 'Execute an allowlisted shell command in the agent sandbox directory. Commands are run directly (no shell), with timeout and output size limits enforced.',
    inputSchema: z.object({
      agentId: z.string().describe('The agent ID (used to determine sandbox directory)'),
      command: z.string().describe('The command to execute (binary name and arguments)'),
      surfaceOutput: z.boolean().optional().describe('Whether to surface output directly (reserved for future use)'),
    }),
    execute: async ({ agentId, command }): Promise<ToolResult> => {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      const config = getRuntimeConfig().exec;

      if (!config.enabled) {
        return { success: false, error: 'exec_command is disabled. Set runtime.exec.enabled to true in openclaw.json.' };
      }

      // Enforce sane upper bounds regardless of what the config says
      const maxTimeout = Math.min(config.maxTimeout ?? 30, 300); // cap at 5 min
      const maxOutputSize = Math.min(config.maxOutputSize ?? 10000, 1_000_000); // cap at 1 MB

      // Parse command
      const parsed = parseCommand(command);
      if ('error' in parsed) {
        return { success: false, error: parsed.error };
      }

      const { binary, args } = parsed;

      // Check allowlist
      const binaryBasename = getBinaryBasename(binary);
      const allowlist = config.allowlist ?? [];

      if (!allowlist.includes(binaryBasename)) {
        return {
          success: false,
          error: `Command '${binaryBasename}' is not in the allowlist. Allowed commands: ${allowlist.join(', ') || '(none)'}`,
        };
      }

      // Get sandbox directory
      let sandboxDir: string;
      try {
        sandboxDir = getSandboxDir(agentId);
      } catch (error) {
        return { success: false, error: `Invalid agent sandbox: ${error}` };
      }

      const timeoutMs = maxTimeout * 1000;
      // maxBuffer limits each stream; set large enough to capture output before our truncation
      const streamBuffer = Math.max(maxOutputSize * 5, 1024 * 1024);

      try {
        const { stdout, stderr } = await execFileAsync(binary, args, {
          cwd: sandboxDir,
          timeout: timeoutMs,
          maxBuffer: streamBuffer,
          killSignal: 'SIGTERM',
          env: buildSafeEnv() as NodeJS.ProcessEnv,
        });

        const capped = capCombinedOutput(stdout, stderr, maxOutputSize);

        return {
          success: true,
          data: {
            stdout: capped.stdout,
            stderr: capped.stderr,
            exitCode: 0,
            outputTruncated: capped.truncated,
          },
        };
      } catch (error) {
        const execError = error as { code?: string | number; signal?: string; stdout?: string; stderr?: string; message?: string };

        // Handle timeout
        if (execError.signal === 'SIGTERM' || execError.code === 'ETIMEDOUT') {
          return {
            success: false,
            error: `Command timed out after ${maxTimeout} seconds`,
          };
        }

        // Handle spawn errors (binary not found, etc.)
        if (execError.code === 'ENOENT') {
          return {
            success: false,
            error: `Command not found: '${binary}'`,
          };
        }

        // Handle non-zero exit codes — still a successful execution
        if (typeof execError.code === 'number') {
          const capped = capCombinedOutput(
            execError.stdout ?? '',
            execError.stderr ?? '',
            maxOutputSize,
          );

          return {
            success: true,
            data: {
              stdout: capped.stdout,
              stderr: capped.stderr,
              exitCode: execError.code,
              outputTruncated: capped.truncated,
            },
          };
        }

        return {
          success: false,
          error: `Failed to execute command: ${execError.message ?? 'Unknown error'}`,
        };
      }
    },
  }),
  { riskLevel: 'high' },
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
      const context = spawnSubagentContext.getStore();
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

      const session = await db.session.findFirst({
        where: { agentId },
        orderBy: { lastActive: 'desc' },
      });

      if (!session) {
        return { success: false, error: 'No active session found for agent' };
      }

      const channel = session.channel as ChannelType;
      const channelKey = session.channelKey;
      const deliveryTarget = {
        channel,
        channelKey,
        metadata: {},
      };

      const detectedMimeType = detectMimeType(filePath, mimeType);
      const dedupeKey = `file:${context.parentTaskId}:${filePath}:${crypto.randomUUID()}`;

      try {
        await enqueueFileDeliveryTx(
          db,
          context.parentTaskId,
          channel,
          channelKey,
          JSON.stringify(deliveryTarget),
          resolvedPath,
          caption ?? '',
          dedupeKey,
        );
      } catch (error) {
        return { success: false, error: `Failed to enqueue file delivery: ${error instanceof Error ? error.message : 'Unknown error'}` };
      }

      return {
        success: true,
        data: { filePath: resolvedPath, mimeType: detectedMimeType, caption },
      };
    },
  }),
  { riskLevel: 'medium' },
);

export { tools };
