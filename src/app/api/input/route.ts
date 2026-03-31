// API Route: /api/input
// Unified input processing endpoint

import { NextRequest, NextResponse } from 'next/server';
import { withInit } from '@/lib/api/init-guard';
import { requireInternalAuth } from '@/lib/api-auth';
import { inputManager } from '@/lib/services/input-manager';
import { Input } from '@/lib/types';

// POST /api/input - Process any input type
export async function POST(request: NextRequest) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(request);
      if (authResponse) return authResponse;

      const body = await request.json();
      const { input, agentId } = body as { input: Input; agentId?: string };

      if (!input || !input.type) {
        return NextResponse.json(
          { success: false, error: 'Input with type is required' },
          { status: 400 }
        );
      }

      // Validate input type
      const validTypes = ['message', 'webhook', 'hook', 'a2a'];
      if (!validTypes.includes(input.type)) {
        return NextResponse.json(
          { success: false, error: `Invalid input type. Must be one of: ${validTypes.join(', ')}` },
          { status: 400 }
        );
      }

      // For A2A messages, extract target agent from input
      let targetAgentId = agentId;
      if (input.type === 'a2a') {
        targetAgentId = input.toAgentId;
      }

      const result = await inputManager.processInput(input, targetAgentId);

      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          taskId: result.taskId,
          sessionId: result.sessionId,
        },
        message: 'Input processed successfully',
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
