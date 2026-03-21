// OpenClaw Agent Runtime - Task Queue Service
// Sequential task processing with priority ordering

import type { Prisma, PrismaClient, Task as DbTask } from '@prisma/client';
import { db } from '@/lib/db';
import { Task, TaskStatus, TaskType } from '@/lib/types';
import { broadcastTaskCreated, broadcastTaskStarted, broadcastTaskCompleted, broadcastTaskFailed } from './ws-client';
import { auditService } from './audit-service';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CreateTaskInput {
  agentId: string;
  sessionId?: string;
  type: TaskType;
  priority?: number;
  payload: Record<string, unknown>;
  source?: string;
  parentTaskId?: string | null;
  skillName?: string | null;
  spawnDepth?: number;
}

export interface TaskQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

class TaskQueueService {
  private processing: Map<string, boolean> = new Map();
  
  /**
   * Create a new task and add it to the queue
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const task = await db.task.create({
      data: {
        agentId: input.agentId,
        sessionId: input.sessionId,
        type: input.type,
        priority: input.priority ?? 5,
        status: 'pending',
        payload: JSON.stringify(input.payload),
        source: input.source,
        parentTaskId: input.parentTaskId ?? null,
        skillName: input.skillName ?? null,
        spawnDepth: input.spawnDepth ?? 0,
      },
    });

    const mappedTask = this.mapTask(task);

    // Broadcast task created event
    broadcastTaskCreated(input.agentId, task.id, input.type);

    // Log audit event
    await auditService.log({
      action: 'task_created',
      entityType: 'task',
      entityId: task.id,
      details: { agentId: input.agentId, type: input.type, priority: input.priority ?? 5 },
    });

    return mappedTask;
  }

  /**
   * Get the next pending task for an agent (FIFO within priority)
   */
  async getNextTask(agentId: string): Promise<Task | null> {
    // Check if agent is already processing a task
    if (this.processing.get(agentId)) {
      return null;
    }

    const task = await db.task.findFirst({
      where: {
        agentId,
        status: 'pending',
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    return task ? this.mapTask(task) : null;
  }

  /**
   * Get all pending tasks for an agent
   */
  async getPendingTasks(agentId: string): Promise<Task[]> {
    const tasks = await db.task.findMany({
      where: {
        agentId,
        status: 'pending',
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    return tasks.map(this.mapTask);
  }

  /**
   * Mark a task as processing
   */
  async startTask(taskId: string): Promise<Task | null> {
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.status !== 'pending') {
      return null;
    }

    const updated = await db.task.update({
      where: { id: taskId },
      data: {
        status: 'processing',
        startedAt: new Date(),
      },
    });

    this.processing.set(task.agentId, true);

    const mappedTask = this.mapTask(updated);

    // Broadcast task started event
    broadcastTaskStarted(task.agentId, taskId);

    return mappedTask;
  }

  /**
   * Complete a task with result
   */
  async completeTask(taskId: string, result?: Record<string, unknown>): Promise<Task | null> {
    const updated = await this.completeTaskTx(db, taskId, result);
    if (!updated) {
      return null;
    }

    this.completeTaskSideEffects(updated.agentId, taskId, result);

    return updated;
  }

  async completeTaskTx(tx: DbClient, taskId: string, result?: Record<string, unknown>): Promise<Task | null> {
    const task = await tx.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return null;
    }

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        result: result ? JSON.stringify(result) : null,
        completedAt: new Date(),
      },
    });

    return this.mapTask(updated);
  }

  /**
   * Fail a task with error
   */
  async failTask(taskId: string, error: string): Promise<Task | null> {
    const updated = await this.failTaskTx(db, taskId, error);
    if (!updated) {
      return null;
    }

    this.failTaskSideEffects(updated.agentId, taskId, error);

    return updated;
  }

  async failTaskTx(tx: DbClient, taskId: string, error: string): Promise<Task | null> {
    const task = await tx.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return null;
    }

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error,
        completedAt: new Date(),
      },
    });

    // 4.3: Cascade to nested child tasks
    await this.failChildTasks(taskId, 'Parent task failed');

    return this.mapTask(updated);
  }

  /**
   * Fail all pending/processing child tasks of a given parent task
   */
  async failChildTasks(parentTaskId: string, error: string): Promise<void> {
    const children = await db.task.findMany({
      where: {
        parentTaskId,
        status: { in: ['pending', 'processing'] },
      },
    });

    for (const child of children) {
      await db.task.update({
        where: { id: child.id },
        data: { status: 'failed', error, completedAt: new Date() },
      });
      // Recurse to handle grandchildren
      await this.failChildTasks(child.id, error);
    }
  }

  completeTaskSideEffects(agentId: string, taskId: string, result?: Record<string, unknown>): void {
    this.processing.delete(agentId);
    broadcastTaskCompleted(agentId, taskId, result);
  }

  failTaskSideEffects(agentId: string, taskId: string, error: string): void {
    this.processing.delete(agentId);
    broadcastTaskFailed(agentId, taskId, error);
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    return task ? this.mapTask(task) : null;
  }

  /**
   * Get all tasks with optional filters
   */
  async getTasks(filters?: {
    agentId?: string;
    status?: TaskStatus;
    type?: TaskType;
    limit?: number;
  }): Promise<Task[]> {
    const tasks = await db.task.findMany({
      where: {
        ...(filters?.agentId && { agentId: filters.agentId }),
        ...(filters?.status && { status: filters.status }),
        ...(filters?.type && { type: filters.type }),
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 50,
    });

    return tasks.map(this.mapTask);
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<TaskQueueStats> {
    const [pending, processing, completed, failed, total] = await Promise.all([
      db.task.count({ where: { status: 'pending' } }),
      db.task.count({ where: { status: 'processing' } }),
      db.task.count({ where: { status: 'completed' } }),
      db.task.count({ where: { status: 'failed' } }),
      db.task.count(),
    ]);

    return { pending, processing, completed, failed, total };
  }

  /**
   * Sweep orphaned sub-agent tasks stuck in processing beyond the configured timeout
   */
  async sweepOrphanedSubagents(): Promise<number> {
    const rawTimeout = parseInt(process.env.OPENCLAW_SUBAGENT_TIMEOUT ?? '', 10);
    const timeoutSeconds = Number.isInteger(rawTimeout) && rawTimeout > 0 ? rawTimeout : 300;
    const cutoff = new Date(Date.now() - timeoutSeconds * 1000);

    const orphans = await db.task.findMany({
      where: {
        type: 'subagent',
        status: 'processing',
        startedAt: { lt: cutoff },
      },
    });

    for (const orphan of orphans) {
      await db.task.update({
        where: { id: orphan.id },
        data: {
          status: 'failed',
          error: 'Orphaned sub-agent: exceeded processing timeout',
          completedAt: new Date(),
        },
      });
    }

    return orphans.length;
  }

  /**
   * Clean up old completed/failed tasks
   */
  async cleanupOldTasks(daysOld: number = 7): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await db.task.deleteMany({
      where: {
        status: { in: ['completed', 'failed'] },
        completedAt: { lt: cutoff },
      },
    });

    return result.count;
  }

  /**
   * Map database task to interface
   */
  private mapTask(task: DbTask): Task {
    return {
      id: task.id,
      agentId: task.agentId,
      sessionId: task.sessionId ?? undefined,
      type: task.type as TaskType,
      priority: task.priority,
      status: task.status as TaskStatus,
      payload: JSON.parse(task.payload),
      result: task.result ? JSON.parse(task.result) : undefined,
      error: task.error ?? undefined,
      source: task.source ?? undefined,
      parentTaskId: task.parentTaskId ?? undefined,
      skillName: task.skillName ?? undefined,
      spawnDepth: task.spawnDepth,
      createdAt: task.createdAt,
      startedAt: task.startedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
    };
  }
}

export const taskQueue = new TaskQueueService();
