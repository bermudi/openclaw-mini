// API Route: /api/tasks
// Task management endpoints

import { NextRequest, NextResponse } from 'next/server';
import { taskQueue } from '@/lib/services/task-queue';
import { requireInternalAuth } from '@/lib/api-auth';

// GET /api/tasks - List tasks with optional filters
export async function GET(request: NextRequest) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const type = searchParams.get('type') ?? undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;

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
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
