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

      const skillResult = await getSkillForSubAgent(skill);
      if (!skillResult.skill) {
        return { success: false, error: skillResult.error ?? `Skill '${skill}' not found or disabled` };
      }

      const newTask = await taskQueue.createTask({
        agentId: context.agentId,
        type: 'subagent',
        priority: 5,
        payload: {
          task,
          skill: skillResult.skill.name,
          skillTools: skillResult.skill.tools,
          systemPrompt: skillResult.skill.instructions,
          overrides: skillResult.skill.overrides,
        },
        source: `subagent:${context.parentTaskId}`,
        parentTaskId: context.parentTaskId,
        skillName: skillResult.skill.name,
      });

      await auditService.log({
        action: 'subagent_task_dispatched',
        entityType: 'task',
        entityId: newTask.id,
        details: {
          agentId: context.agentId,
          parentTaskId: context.parentTaskId,
          skill: skillResult.skill.name,
          overrideFieldsApplied: getOverrideFieldsApplied(skillResult.skill.overrides),
        },
      });

      const sessionScope = `subagent:${newTask.id}`;
      const session = await sessionService.getOrCreateSession(
        context.agentId,
        sessionScope,
        'internal',
        sessionScope,
      );

      await db.task.update({
        where: { id: newTask.id },
        data: { sessionId: session.id },
      });

      const cleanupSession = async () => {
        if (session?.id) {
          await sessionService.deleteSession(session.id);
        }
      };

      const timeoutMs = Math.max(1, timeoutSeconds ?? 120) * 1000;
      const deadline = Date.now() + timeoutMs;
      const baseDelayMs = 500;
      const maxDelayMs = 5000;
      let delayMs = baseDelayMs;
      let lastStatus: string | undefined;

      while (Date.now() < deadline) {
        const current = await taskQueue.getTask(newTask.id);
        if (!current) {
          await cleanupSession();
          return { success: false, error: 'Sub-agent task disappeared' };
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
              skill: skillResult.skill.name,
            },
          };
        }

        if (current.status === 'failed') {
          await cleanupSession();
          return { success: false, error: `Sub-agent failed: ${current.error ?? 'unknown error'}` };
        }

        const jitter = Math.floor(delayMs * 0.1 * Math.random());
        await new Promise(resolve => setTimeout(resolve, delayMs + jitter));
        delayMs = Math.min(delayMs * 2, maxDelayMs);
      }

      const timeoutLabel = timeoutSeconds ?? 120;
      await cleanupSession();
      return { success: false, error: `Sub-agent timed out after ${timeoutLabel}s` };
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

      const filePath = path.join(process.cwd(), 'data', 'memories', agentId, safeName);

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

      const dir = path.join(process.cwd(), 'data', 'memories', agentId);

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

      const dir = path.join(process.cwd(), 'data', 'memories', agentId);

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

// Web search placeholder
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
    execute: async (): Promise<ToolResult> => ({
      success: false,
      error: 'Web search not configured',
    }),
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
            key: 'history',
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

export { tools };
