// API Route: /api/agents/[id]/memory/[key]/at/[sha]
// Returns memory content at a specific git commit

import { NextRequest, NextResponse } from 'next/server';
import { memoryService } from '@/lib/services/memory-service';
import { requireInternalAuth } from '@/lib/api-auth';
import { withInit } from '@/lib/api/init-guard';

// GET /api/agents/[id]/memory/[key]/at/[sha]
// Note: keys containing '/' should be URL-encoded (e.g. system%2Fpreferences)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; key: string; sha: string }> }
) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(_request);
      if (authResponse) return authResponse;

      const { id, key, sha } = await params;

      const value = await memoryService.getMemoryAtCommit(id, key, sha);

      if (value === null) {
        return NextResponse.json(
          { success: false, error: 'Memory not found at this commit' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: { key, sha, value },
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
