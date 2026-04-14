// OpenClaw Agent Runtime - Task Queue Service
// Sequential task processing with priority ordering

import { Prisma, type PrismaClient, type Task as DbTask } from '@prisma/client';
import { db } from '@/lib/db';
import { Task, TaskStatus, TaskType } from '@/lib/types';
import { parseTaskPayload, parseTaskResult, serializeTaskPayload, serializeTaskResult } from '@/lib/storage-boundary';
import { auditService } from './audit-service';
import { eventBus } from './event-bus';
import { getRuntimeConfig } from '@/lib/config/runtime';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface BusyAgentRecoveryResult {
  inspected: number;
  recovered: number;
  errored: number;
}

export interface ErrorAgentRecoveryResult {
  inspected: number;
  recovered: number;
  tasksFailed: number;
}

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
        payload: serializeTaskPayload(input.payload),
        source: input.source,
        parentTaskId: input.parentTaskId ?? null,
        skillName: input.skillName ?? null,
        spawnDepth: input.spawnDepth ?? 0,
      },
    });

    const mappedTask = this.mapTask(task);

    // Log audit event
    await auditService.log({
      action: 'task_created',
      entityType: 'task',
      entityId: task.id,
      details: { agentId: input.agentId, type: input.type, priority: input.priority ?? 5 },
    });

    await eventBus.emit('task:created', {
      taskId: task.id,
      agentId: input.agentId,
      taskType: input.type,
      priority: input.priority ?? 5,
    });

    return mappedTask;
  }

  /**
   * Get the next pending task for an agent (FIFO within priority)
   */
  async getNextTask(agentId: string): Promise<Task | null> {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { status: true },
    });

    if (!agent || agent.status !== 'idle') {
      return null;
    }

    const processingTask = await db.task.findFirst({
      where: {
        agentId,
        status: 'processing',
      },
      select: { id: true },
    });

    if (processingTask) {
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
    const updated = await db.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
      });

      if (!task || task.status !== 'pending') {
        return null;
      }

      const processingTask = await this.hasProcessingTask(tx, task.agentId);
      if (processingTask) {
        return null;
      }

      const agentClaim = await tx.agent.updateMany({
        where: {
          id: task.agentId,
          status: 'idle',
        },
        data: {
          status: 'busy',
        },
      });

      if (agentClaim.count !== 1) {
        return null;
      }

      const claimResult = await tx.task.updateMany({
        where: {
          id: taskId,
          status: 'pending',
        },
        data: {
          status: 'processing',
          startedAt: new Date(),
        },
      });

      if (claimResult.count !== 1) {
        return null;
      }

      const claimedTask = await tx.task.findUnique({
        where: { id: taskId },
      });

      return claimedTask ? this.mapTask(claimedTask) : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (!updated) {
      return null;
    }

    await eventBus.emit('task:started', {
      taskId,
      agentId: updated.agentId,
      taskType: updated.type,
    });

    return updated;
  }

  /**
   * Complete a task with result
   */
  async completeTask(taskId: string, result?: Record<string, unknown>): Promise<Task | null> {
    const updated = await this.completeTaskTx(db, taskId, result);
    if (!updated) {
      return null;
    }

    await this.completeTaskSideEffects(updated.agentId, taskId, updated.type, result);

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
        result: result ? serializeTaskResult(result) : null,
        completedAt: new Date(),
      },
    });

    return this.mapTask(updated);
  }

  /**
   * Fail a task with error
   */
  async failTask(taskId: string, error: string): Promise<Task | null> {
    const updated = await db.$transaction(
      async (tx) => this.failTaskTx(tx, taskId, error),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!updated) {
      return null;
    }

    await this.failTaskSideEffects(updated.agentId, taskId, updated.type, error);

    return updated;
  }

  async failTaskTx(tx: DbClient, taskId: string, error: string): Promise<Task | null> {
    const updatedResult = await tx.task.updateMany({
      where: {
        id: taskId,
        status: { in: ['pending', 'processing'] },
      },
      data: {
        status: 'failed',
        error,
        completedAt: new Date(),
      },
    });

    if (updatedResult.count !== 1) {
      return null;
    }

    const updated = await tx.task.findUnique({
      where: { id: taskId },
    });

    if (!updated) {
      return null;
    }

    await this.failChildTasksTx(tx, taskId, 'Parent task failed');

    return this.mapTask(updated);
  }

  /**
   * Fail all pending/processing child tasks of a given parent task
   */
  async failChildTasks(parentTaskId: string, error: string): Promise<void> {
    await db.$transaction(
      async (tx) => this.failChildTasksTx(tx, parentTaskId, error),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async failChildTasksTx(
    client: DbClient,
    parentTaskId: string,
    error: string,
    visited: Set<string> = new Set<string>(),
  ): Promise<void> {
    if (visited.has(parentTaskId)) {
      return;
    }

    visited.add(parentTaskId);

    const children = await client.task.findMany({
      where: {
        parentTaskId,
        status: { in: ['pending', 'processing'] },
      },
      select: { id: true },
    });

    for (const child of children) {
      const updated = await client.task.updateMany({
        where: {
          id: child.id,
          status: { in: ['pending', 'processing'] },
        },
        data: { status: 'failed', error, completedAt: new Date() },
      });

      if (updated.count === 1) {
        // Recurse to handle grandchildren, but only once per branch.
        await this.failChildTasksTx(client, child.id, error, visited);
      }
    }
  }

  async completeTaskSideEffects(agentId: string, taskId: string, taskType: string, result?: Record<string, unknown>): Promise<void> {
    await db.agent.updateMany({
      where: { id: agentId },
      data: { status: 'idle' },
    });
    await eventBus.emit('task:completed', { taskId, agentId, taskType, result });
  }

  async failTaskSideEffects(agentId: string, taskId: string, taskType: string, error: string): Promise<void> {
    const hasProcessingTask = await this.hasProcessingTask(db, agentId);

    // Keep the agent busy only if another task is still processing; otherwise let the scheduler resume it.
    await db.agent.updateMany({
      where: { id: agentId },
      data: { status: hasProcessingTask ? 'busy' : 'idle' },
    });
    await eventBus.emit('task:failed', { taskId, agentId, taskType, error });
  }

  async sweepStaleBusyAgents(): Promise<BusyAgentRecoveryResult> {
    const timeoutSeconds = getRuntimeConfig().safety.subagentTimeout;
    const cutoff = new Date(Date.now() - timeoutSeconds * 1000);
    const busyAgents = await db.agent.findMany({
      where: {
        status: 'busy',
      },
      select: {
        id: true,
        name: true,
      },
    });

    let recovered = 0;
    let errored = 0;

    for (const agent of busyAgents) {
      try {
        const allTasks = await db.task.findMany({
          where: {
            agentId: agent.id,
          },
          select: {
            createdAt: true,
            startedAt: true,
            completedAt: true,
          },
        });

        let latestTaskActivityAt: Date | null = null;
        for (const task of allTasks) {
          const taskActivityAt = task.completedAt ?? task.startedAt ?? task.createdAt;
          if (!latestTaskActivityAt || taskActivityAt > latestTaskActivityAt) {
            latestTaskActivityAt = taskActivityAt;
          }
        }

        if (latestTaskActivityAt && latestTaskActivityAt > cutoff) {
          continue;
        }

        const processingTasks = await db.task.findMany({
          where: {
            agentId: agent.id,
            status: 'processing',
          },
          select: {
            id: true,
            startedAt: true,
            createdAt: true,
          },
          orderBy: [
            { startedAt: 'asc' },
            { createdAt: 'asc' },
          ],
        });

        if (processingTasks.length === 0) {
          const resetResult = await db.agent.updateMany({
            where: {
              id: agent.id,
              status: 'busy',
            },
            data: {
              status: 'idle',
            },
          });

          if (resetResult.count === 1) {
            recovered += 1;
            await auditService.log({
              action: 'agent_recovered_idle',
              entityType: 'agent',
              entityId: agent.id,
              details: {
                agentName: agent.name,
                reason: 'busy_without_processing_task',
                lastTaskActivityAt: latestTaskActivityAt ? latestTaskActivityAt.toISOString() : null,
                previousStatus: 'busy',
                recoveryThresholdSeconds: timeoutSeconds,
              },
            });
          }

          continue;
        }

        const processingAges = processingTasks.map(task => (task.startedAt ?? task.createdAt).getTime());
        const oldestStartedAt = new Date(Math.min(...processingAges));
        const staleProcessing = processingTasks.length > 1 || oldestStartedAt <= cutoff;

        if (!staleProcessing) {
          continue;
        }

        const errorResult = await db.agent.updateMany({
          where: {
            id: agent.id,
            status: 'busy',
          },
          data: {
            status: 'error',
          },
        });

        if (errorResult.count === 1) {
          errored += 1;
          await auditService.log({
            action: 'agent_recovery_failed',
            entityType: 'agent',
            entityId: agent.id,
            severity: 'error',
            details: {
              agentName: agent.name,
              processingTaskIds: processingTasks.map(task => task.id),
              reason: processingTasks.length > 1 ? 'multiple_processing_tasks' : 'processing_task_timed_out',
              cutoff: cutoff.toISOString(),
              lastTaskActivityAt: latestTaskActivityAt ? latestTaskActivityAt.toISOString() : null,
              timeoutSeconds,
            },
          });
        }
      } catch (error) {
        console.error('[TaskQueue] Failed to recover stale busy agent:', agent.id, error);
      }
    }

    return {
      inspected: busyAgents.length,
      recovered,
      errored,
    };
  }

  /**
   * Recover agents stuck in 'error' status back to 'idle'.
   *
   * When sweepStaleBusyAgents transitions an agent to 'error', nothing ever
   * resets it back to 'idle', so the agent is permanently dead. This sweep
   * fails any remaining processing tasks for error-state agents and
   * returns them to 'idle' so they can resume work.
   */
  async sweepErrorAgents(): Promise<ErrorAgentRecoveryResult> {
    const errorAgents = await db.agent.findMany({
      where: { status: 'error' },
      select: { id: true, name: true },
    });

    if (errorAgents.length === 0) {
      return { inspected: 0, recovered: 0, tasksFailed: 0 };
    }

    let recovered = 0;
    let tasksFailed = 0;

    for (const agent of errorAgents) {
      try {
        // Fail any tasks still in 'processing' for this agent
        const staleTasks = await db.task.findMany({
          where: {
            agentId: agent.id,
            status: 'processing',
          },
          select: { id: true },
        });

        for (const task of staleTasks) {
          await db.$transaction(
            async (tx) => this.failTaskTx(tx, task.id, 'Recovered from error state: task was stuck in processing'),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
          tasksFailed += 1;
        }

        // Reset agent from error → idle. Use a broad where to avoid racing with
        // failTaskSideEffects which may have already set it to idle.
        const resetResult = await db.agent.updateMany({
          where: { id: agent.id, status: { in: ['error', 'busy', 'idle'] } },
          data: { status: 'idle' },
        });

        if (resetResult.count >= 1) {
          recovered += 1;
          await auditService.log({
            action: 'agent_recovered_from_error',
            entityType: 'agent',
            entityId: agent.id,
            details: {
              agentName: agent.name,
              reason: 'error_state_recovered',
              previousStatus: 'error',
              staleTasksFailed: staleTasks.length,
            },
          });
        }
      } catch (error) {
        console.error('[TaskQueue] Failed to recover error agent:', agent.id, error);
      }
    }

    return { inspected: errorAgents.length, recovered, tasksFailed };
  }

  /**
   * Cancel a pending or processing task by failing it with a reason.
   * Returns false if the task is already in a terminal state or not found.
   */
  async cancelTask(taskId: string, reason = 'Cancelled by supervisor'): Promise<boolean> {
    const task = await this.getTask(taskId);
    if (!task) {
      return false;
    }
    if (task.status === 'completed' || task.status === 'failed') {
      return false;
    }
    const updated = await this.failTask(taskId, reason);
    return updated !== null;
  }

  /**
   * Batch-fetch tasks by ID using a single IN query.
   */
  async getTasksByIds(ids: string[]): Promise<Task[]> {
    if (ids.length === 0) {
      return [];
    }
    const tasks = await db.task.findMany({
      where: { id: { in: ids } },
    });
    return tasks.map(this.mapTask);
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
    const timeoutSeconds = getRuntimeConfig().safety.subagentTimeout;
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
  async cleanupOldTasks(daysOld?: number): Promise<number> {
    const retentionDays = daysOld ?? getRuntimeConfig().retention.tasks;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

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
      payload: parseTaskPayload(task.payload),
      result: task.result ? parseTaskResult(task.result) : undefined,
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

  private async hasProcessingTask(client: DbClient, agentId: string): Promise<boolean> {
    const processingTask = await client.task.findFirst({
      where: {
        agentId,
        status: 'processing',
      },
      select: {
        id: true,
      },
    });

    return Boolean(processingTask);
  }
}

export const taskQueue = new TaskQueueService();
