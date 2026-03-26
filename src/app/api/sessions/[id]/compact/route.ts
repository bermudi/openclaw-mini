import { NextRequest, NextResponse } from 'next/server';
import { sessionService } from '@/lib/services/session-service';
import { requireInternalAuth } from '@/lib/api-auth';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResponse = await requireInternalAuth(_request);
    if (authResponse) return authResponse;

    const { id } = await params;
    const result = await sessionService.compactSession(id, { force: true });

    return NextResponse.json({
      success: true,
      summarized: result.summarized,
      remaining: result.remaining,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
