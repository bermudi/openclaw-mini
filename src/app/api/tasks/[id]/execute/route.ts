// API Route: /api/tasks/[id]/execute
// Execute a specific task

import { NextRequest, NextResponse } from 'next/server';
import { agentExecutor } from '@/lib/services/agent-executor';
import { requireInternalAuth } from '@/lib/api-auth';

// POST /api/tasks/[id]/execute - Execute a task
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResponse = await requireInternalAuth(_request);
    if (authResponse) return authResponse;

    const { id } = await params;
    const result = await agentExecutor.executeTask(id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Task executed successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
