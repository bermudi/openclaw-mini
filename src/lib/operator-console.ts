import { z } from 'zod';

import { agentService } from '@/lib/services/agent-service';
import { memoryService } from '@/lib/services/memory-service';
import { inputManager } from '@/lib/services/input-manager';
import { sessionService } from '@/lib/services/session-service';
import { taskQueue, type TaskQueueStats } from '@/lib/services/task-queue';
import { triggerService } from '@/lib/services/trigger-service';
import {
  initializeWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileSummary,
} from '@/lib/services/workspace-service';
import type { Agent, ChannelType, Task, Trigger } from '@/lib/types';

const createAgentSchema = z.object({
  name: z.string().trim().min(1, 'Agent name is required'),
  description: z.string().trim().optional(),
  skills: z.array(z.string().trim().min(1)).default([]),
});

const sendMessageSchema = z.object({
  agentId: z.string().trim().min(1, 'Agent is required'),
  content: z.string().trim().min(1, 'Message content is required'),
  channel: z.enum(['webchat', 'slack', 'discord', 'whatsapp', 'telegram', 'imessage']).default('webchat'),
});

const createTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    agentId: z.string().trim().min(1, 'Agent is required'),
    name: z.string().trim().min(1, 'Trigger name is required'),
    type: z.literal('heartbeat'),
    schedule: z.coerce.number().int().positive('Heartbeat interval must be a positive number of minutes'),
  }),
  z.object({
    agentId: z.string().trim().min(1, 'Agent is required'),
    name: z.string().trim().min(1, 'Trigger name is required'),
    type: z.literal('cron'),
    schedule: z.string().trim().min(1, 'Cron expression is required'),
  }),
]);

const saveWorkspaceSchema = z.object({
  fileName: z.string().trim().min(1, 'Workspace file name is required'),
  content: z.string(),
});

export interface OperatorSessionSummary {
  id: string;
  agentId: string;
  agentName: string;
  channel: string;
  channelKey: string;
  lastActive: Date;
  messageCount: number;
}

export interface WorkspaceDocument {
  name: string;
  content: string;
  size: number;
}

export interface OperatorSnapshot {
  agents: Agent[];
  tasks: Task[];
  taskStats: TaskQueueStats;
  triggers: Trigger[];
  sessions: OperatorSessionSummary[];
  workspaceFiles: WorkspaceFileSummary[];
  selectedWorkspaceFile: WorkspaceDocument | null;
}

function normalizeOptionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function splitSkills(input?: string): string[] {
  if (!input) {
    return [];
  }

  return input
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);
}

function resolveWorkspaceSelection(
  requestedFile: string | undefined,
  workspaceFiles: WorkspaceFileSummary[],
): string | undefined {
  if (requestedFile && workspaceFiles.some((file) => file.name === requestedFile)) {
    return requestedFile;
  }

  return workspaceFiles[0]?.name;
}

export async function loadOperatorSnapshot(selectedWorkspaceFile?: string): Promise<OperatorSnapshot> {
  initializeWorkspace();

  const [agents, tasks, taskStats, triggers] = await Promise.all([
    agentService.getAgents(),
    taskQueue.getTasks({ limit: 25 }),
    taskQueue.getStats(),
    triggerService.getAllTriggers(),
  ]);

  const sessionGroups = await Promise.all(
    agents.map(async (agent) => ({
      agent,
      sessions: await sessionService.getAgentSessions(agent.id),
    })),
  );

  const sessions = sessionGroups.flatMap(({ agent, sessions: agentSessions }) =>
    agentSessions.map((session) => ({
      ...session,
      agentId: agent.id,
      agentName: agent.name,
    })),
  );

  const workspaceFiles = listWorkspaceFiles();
  const selectedFileName = resolveWorkspaceSelection(selectedWorkspaceFile, workspaceFiles);
  const workspaceContent = selectedFileName ? readWorkspaceFile(selectedFileName) : null;
  const selectedDocument = selectedFileName && workspaceContent !== null
    ? {
        name: selectedFileName,
        content: workspaceContent,
        size: Buffer.byteLength(workspaceContent, 'utf-8'),
      }
    : null;

  return {
    agents,
    tasks,
    taskStats,
    triggers,
    sessions,
    workspaceFiles,
    selectedWorkspaceFile: selectedDocument,
  };
}

export async function createOperatorAgent(input: {
  name: string;
  description?: string;
  skills?: string[];
}): Promise<Agent> {
  const parsed = createAgentSchema.parse({
    name: input.name,
    description: normalizeOptionalText(input.description),
    skills: input.skills ?? [],
  });

  const agent = await agentService.createAgent(parsed);
  await memoryService.initializeAgentMemory(agent.id, agent.name);
  return agent;
}

export async function createOperatorAgentFromCommaList(input: {
  name: string;
  description?: string;
  skills?: string;
}): Promise<Agent> {
  return createOperatorAgent({
    name: input.name,
    description: input.description,
    skills: splitSkills(input.skills),
  });
}

export async function setOperatorDefaultAgent(agentId: string): Promise<Agent> {
  const updated = await agentService.setDefaultAgent(agentId);

  if (!updated) {
    throw new Error('Agent not found');
  }

  return updated;
}

export async function toggleOperatorAgent(agentId: string): Promise<Agent> {
  const agent = await agentService.getAgent(agentId);

  if (!agent) {
    throw new Error('Agent not found');
  }

  const updated = await agentService.updateAgent(agentId, {
    status: agent.status === 'disabled' ? 'idle' : 'disabled',
  });

  if (!updated) {
    throw new Error('Agent update failed');
  }

  return updated;
}

export async function deleteOperatorAgent(agentId: string): Promise<void> {
  const deleted = await agentService.deleteAgent(agentId);

  if (!deleted) {
    throw new Error('Agent not found');
  }
}

export async function sendOperatorMessage(input: {
  agentId: string;
  content: string;
  channel?: ChannelType;
}): Promise<{ taskId?: string; sessionId?: string }> {
  const parsed = sendMessageSchema.parse({
    agentId: input.agentId,
    content: input.content,
    channel: input.channel ?? 'webchat',
  });

  const result = await inputManager.processInput(
    {
      type: 'message',
      channel: parsed.channel,
      channelKey: `operator-console:${parsed.agentId}`,
      content: parsed.content,
      sender: 'operator-console',
    },
    parsed.agentId,
  );

  if (!result.success) {
    throw new Error(result.error ?? 'Failed to queue operator message');
  }

  return {
    taskId: result.taskId,
    sessionId: result.sessionId,
  };
}

export async function createOperatorTrigger(input: {
  agentId: string;
  name: string;
  type: 'heartbeat' | 'cron';
  schedule: string;
}): Promise<Trigger> {
  const parsed = createTriggerSchema.parse({
    agentId: input.agentId,
    name: input.name,
    type: input.type,
    schedule: input.type === 'heartbeat' ? Number(input.schedule) : input.schedule,
  });

  if (parsed.type === 'heartbeat') {
    return triggerService.createTrigger({
      agentId: parsed.agentId,
      name: parsed.name,
      type: 'heartbeat',
      config: { interval: parsed.schedule },
    });
  }

  return triggerService.createTrigger({
    agentId: parsed.agentId,
    name: parsed.name,
    type: 'cron',
    config: { cronExpression: parsed.schedule },
  });
}

export async function toggleOperatorTrigger(triggerId: string): Promise<Trigger> {
  const trigger = await triggerService.getTrigger(triggerId);

  if (!trigger) {
    throw new Error('Trigger not found');
  }

  const updated = await triggerService.setTriggerEnabled(triggerId, !trigger.enabled);

  if (!updated) {
    throw new Error('Trigger update failed');
  }

  return updated;
}

export async function deleteOperatorTrigger(triggerId: string): Promise<void> {
  const deleted = await triggerService.deleteTrigger(triggerId);

  if (!deleted) {
    throw new Error('Trigger not found');
  }
}

export async function saveOperatorWorkspaceDocument(fileName: string, content: string): Promise<WorkspaceFileSummary> {
  const parsed = saveWorkspaceSchema.parse({ fileName, content });
  return writeWorkspaceFile(parsed.fileName, parsed.content);
}
