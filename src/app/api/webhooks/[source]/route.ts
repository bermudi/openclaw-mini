// API Route: /api/webhooks/[source]
// Webhook receiver for external services

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { taskQueue } from '@/lib/services/task-queue';
import { agentService } from '@/lib/services/agent-service';

// POST /api/webhooks/[source] - Receive webhook from external service
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  try {
    const { source } = await params;
    
    // Get headers
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Get body
    let payload: Record<string, unknown>;
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      payload = await request.json();
    } else {
      const text = await request.text();
      payload = { raw: text };
    }

    // Log the webhook
    const webhookLog = await db.webhookLog.create({
      data: {
        source,
        payload: JSON.stringify(payload),
        processed: false,
      },
    });

    // Find agents that have webhook triggers for this source
    const triggers = await db.trigger.findMany({
      where: {
        type: 'webhook',
        enabled: true,
        config: { contains: `"endpoint":"${source}"` },
      },
      include: { agent: true },
    });

    if (triggers.length === 0) {
      // No matching triggers, just log it
      return NextResponse.json({
        success: true,
        message: `Webhook from ${source} logged but no matching triggers found`,
        webhookLogId: webhookLog.id,
      });
    }

    // Create tasks for each matching agent
    const tasks = [];
    for (const trigger of triggers) {
      const agent = trigger.agent;
      
      if (agent.status === 'disabled') {
        continue;
      }

      const task = await taskQueue.createTask({
        agentId: agent.id,
        type: 'webhook',
        priority: 4,
        payload: {
          source,
          payload,
          headers,
          triggerId: trigger.id,
          webhookLogId: webhookLog.id,
        },
        source: `webhook:${source}`,
      });

      tasks.push(task);
    }

    // Mark webhook as processed
    await db.webhookLog.update({
      where: { id: webhookLog.id },
      data: { processed: true, taskId: tasks[0]?.id },
    });

    return NextResponse.json({
      success: true,
      message: `Webhook from ${source} processed`,
      tasksCreated: tasks.length,
      taskIds: tasks.map(t => t.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// GET /api/webhooks/[source] - Webhook verification (for some platforms)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const { source } = await params;
  const { searchParams } = new URL(request.url);
  
  // Support for various webhook verification challenges
  const challenge = searchParams.get('hub.challenge');
  if (challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({
    success: true,
    message: `Webhook endpoint for ${source} is active`,
  });
}
