// API Route: /api/agents/[id]/memory
// Memory management for agents

import { NextRequest, NextResponse } from 'next/server';
import { memoryService } from '@/lib/services/memory-service';
import { requireInternalAuth } from '@/lib/api-auth';
import { withInit } from '@/lib/api/init-guard';

// GET /api/agents/[id]/memory - Get agent memories
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(_request);
      if (authResponse) return authResponse;

      const { id } = await params;
      const memories = await memoryService.getAgentMemories(id);

      return NextResponse.json({
        success: true,
        data: memories,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        { success: false, error: message },
        { status: 500 }
      );
    }
  });
}

// POST /api/agents/[id]/memory - Update agent memory
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(request);
      if (authResponse) return authResponse;

      const { id } = await params;
      const body = await request.json();
      const { key, value, entry, category } = body;

      if (!key) {
        return NextResponse.json(
          { success: false, error: 'Memory key is required' },
          { status: 400 }
        );
      }

      // If entry is provided, append to history
      if (entry && (key === 'system/history' || key === 'history')) {
        await memoryService.appendHistory(id, entry);
        return NextResponse.json({
          success: true,
          message: 'History updated',
        });
      }

      // Otherwise, set the memory
      if (value === undefined) {
        return NextResponse.json(
          { success: false, error: 'Memory value is required' },
          { status: 400 }
        );
      }

      const memory = await memoryService.setMemory({
        agentId: id,
        key,
        value,
        category,
      });

      return NextResponse.json({
        success: true,
        data: memory,
        message: 'Memory updated',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        { success: false, error: message },
        { status: 500 }
      );
    }
  });
}
