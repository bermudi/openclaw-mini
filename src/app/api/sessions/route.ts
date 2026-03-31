import { NextRequest, NextResponse } from 'next/server';
import { withInit } from '@/lib/api/init-guard';
import { sessionService } from '@/lib/services/session-service';
import { requireInternalAuth } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(request);
      if (authResponse) return authResponse;

      const { searchParams } = new URL(request.url);
      const agentId = searchParams.get('agentId');
      const sessionId = searchParams.get('sessionId');

      if (sessionId) {
        const session = await sessionService.getSession(sessionId);
        if (!session) {
          return NextResponse.json({ success: true, data: null });
        }
        return NextResponse.json({ success: true, data: session });
      }

      if (agentId) {
        const sessions = await sessionService.getAgentSessions(agentId);
        return NextResponse.json({ success: true, data: sessions });
      }

      return NextResponse.json(
        { success: false, error: 'Either agentId or sessionId query parameter is required' },
        { status: 400 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        { success: false, error: message },
        { status: 500 },
      );
    }
  });
}
