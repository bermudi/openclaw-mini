// OpenClaw Agent Runtime - Task Queue Service
// Sequential task processing with priority ordering

import { db } from '@/lib/db';
import { Task, TaskStatus, TaskType } from '@/lib/types';

export interface CreateTaskInput {
  agentId: string;
  sessionId?: string;
  type: TaskType;
  priority?: number;
  payload: Record<string, unknown>;
  source?: string;
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
      },
    });

    return this.mapTask(task);
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

    return this.mapTask(updated);
  }

  /**
   * Complete a task with result
   */
  async completeTask(taskId: string, result?: Record<string, unknown>): Promise<Task | null> {
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return null;
    }

    const updated = await db.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        result: result ? JSON.stringify(result) : null,
        completedAt: new Date(),
      },
    });

    this.processing.delete(task.agentId);

    return this.mapTask(updated);
  }

  /**
   * Fail a task with error
   */
  async failTask(taskId: string, error: string): Promise<Task | null> {
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return null;
    }

    const updated = await db.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error,
        completedAt: new Date(),
      },
    });

    this.processing.delete(task.agentId);

    return this.mapTask(updated);
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
  private mapTask(task: {
    id: string;
    agentId: string;
    sessionId: string | null;
    type: string;
    priority: number;
    status: string;
    payload: string;
    result: string | null;
    error: string | null;
    source: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }): Task {
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
      createdAt: task.createdAt,
      startedAt: task.startedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
    };
  }
}

export const taskQueue = new TaskQueueService();
