// API Route: /api/agents/[id]/memory/history
// Returns git commit history for agent memory

import { NextRequest, NextResponse } from 'next/server';
import { memoryService } from '@/lib/services/memory-service';
import { requireInternalAuth } from '@/lib/api-auth';
import { withInit } from '@/lib/api/init-guard';

// GET /api/agents/[id]/memory/history?key=system/preferences&limit=20
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(request);
      if (authResponse) return authResponse;

      const { id } = await params;
      const { searchParams } = request.nextUrl;
      const key = searchParams.get('key') ?? undefined;
      const limitParam = searchParams.get('limit');
      const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10)) : 50;

      const history = await memoryService.getMemoryHistory(id, key, limit);

      return NextResponse.json({
        success: true,
        data: history,
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
