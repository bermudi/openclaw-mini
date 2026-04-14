// API Route: /api/tasks
// Task management endpoints

import { NextRequest, NextResponse } from 'next/server';
import { withInit } from '@/lib/api/init-guard';
import { taskQueue } from '@/lib/services/task-queue';
import { requireInternalAuth } from '@/lib/api-auth';
import { storageErrorResponse } from '@/lib/api/storage-errors';

const VALID_TASK_TYPES = new Set(['message', 'heartbeat', 'cron', 'webhook', 'hook', 'a2a']);

// GET /api/tasks - List tasks with optional filters
export async function GET(request: NextRequest) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(request);
      if (authResponse) return authResponse;

      const { searchParams } = new URL(request.url);
      const agentId = searchParams.get('agentId') ?? undefined;
      const status = searchParams.get('status') ?? undefined;
      const type = searchParams.get('type') ?? undefined;
      const rawLimit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50;

      const tasks = await taskQueue.getTasks({
        agentId,
        status: status as 'pending' | 'processing' | 'completed' | 'failed',
        type: type as 'message' | 'heartbeat' | 'cron' | 'webhook' | 'hook' | 'a2a',
        limit,
      });

      const stats = await taskQueue.getStats();

      return NextResponse.json({
        success: true,
        data: tasks,
        stats,
      });
    } catch (error) {
      const storageResponse = storageErrorResponse(error);
      if (storageResponse) return storageResponse;

      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        { success: false, error: message },
        { status: 500 }
      );
    }
  });
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(request);
      if (authResponse) return authResponse;

      const body = await request.json();
      const { agentId, sessionId, type, priority, payload, source } = body;

      if (!agentId || !type || !payload) {
        return NextResponse.json(
          { success: false, error: 'agentId, type, and payload are required' },
          { status: 400 }
        );
      }

      if (!VALID_TASK_TYPES.has(type)) {
        return NextResponse.json(
          { success: false, error: `Invalid task type "${type}". Must be one of: ${[...VALID_TASK_TYPES].join(', ')}` },
          { status: 400 }
        );
      }

      if (priority !== undefined && (typeof priority !== 'number' || !Number.isFinite(priority) || priority < 0 || priority > 10)) {
        return NextResponse.json(
          { success: false, error: 'priority must be a number between 0 and 10' },
          { status: 400 }
        );
      }

      const task = await taskQueue.createTask({
        agentId,
        sessionId,
        type,
        priority,
        payload,
        source,
      });

      return NextResponse.json({
        success: true,
        data: task,
        message: 'Task created successfully',
      });
    } catch (error) {
      const storageResponse = storageErrorResponse(error);
      if (storageResponse) return storageResponse;

      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        { success: false, error: message },
        { status: 500 }
      );
    }
  });
}
