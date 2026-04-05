// API Route: /api/webhooks/[source]
// Webhook receiver for external services with signature verification

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { taskQueue } from '@/lib/services/task-queue';
import { verifyWebhook, extractWebhookEvent } from '@/lib/webhook-security';
import { auditService } from '@/lib/services/audit-service';
import { withInit } from '@/lib/api/init-guard';

// POST /api/webhooks/[source] - Receive webhook from external service
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  return withInit(async () => {
    const { source } = await params;
    
    try {
      // Get headers
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Get raw body for signature verification
      const rawBody = await request.text();
      
      // Get body as object
      let payload: Record<string, unknown>;
      const contentType = request.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { raw: rawBody };
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        // Parse URL-encoded data (common for Slack)
        const params = new URLSearchParams(rawBody);
        payload = {};
        params.forEach((value, key) => {
          payload[key] = value;
        });
        // Slack sends JSON as a 'payload' field
        if (payload.payload) {
          try {
            payload = JSON.parse(payload.payload as string);
          } catch {
            // Keep as is
          }
        }
      } else {
        payload = { raw: rawBody };
      }

      // Log the webhook
      const webhookLog = await db.webhookLog.create({
        data: {
          source,
          payload: JSON.stringify(payload),
          processed: false,
        },
      });

      // Find triggers that match this webhook source
      const triggers = await db.trigger.findMany({
        where: {
          type: 'webhook',
          enabled: true,
        },
        include: { agent: true },
      });

      // Filter triggers that match this endpoint
      const matchingTriggers = triggers.filter(trigger => {
        try {
          const config = JSON.parse(trigger.config);
          return config.endpoint === source;
        } catch {
          return false;
        }
      });

      if (matchingTriggers.length === 0) {
        // No matching triggers, log and return
        await auditService.log({
          action: 'webhook_received_no_handler',
          entityType: 'webhook',
          entityId: webhookLog.id,
          details: { source, hasMatchingTriggers: false },
        });

        return NextResponse.json({
          success: true,
          message: `Webhook from ${source} logged but no matching triggers found`,
          webhookLogId: webhookLog.id,
        });
      }

      // Verify webhook signatures for each trigger
      type MatchingTrigger = (typeof matchingTriggers)[number];
      const validTriggers: MatchingTrigger[] = [];
      for (const trigger of matchingTriggers) {
        const config = JSON.parse(trigger.config);
        
        if (config.secret) {
          const verification = verifyWebhook(source, rawBody, headers, config.secret);
          
          if (!verification.valid) {
            await auditService.log({
              action: 'webhook_verification_failed',
              entityType: 'trigger',
              entityId: trigger.id,
              details: { source, error: verification.error },
              severity: 'warning',
            });
            continue; // Skip this trigger
          }
        }
        
        validTriggers.push(trigger);
      }

      if (validTriggers.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Webhook signature verification failed' },
          { status: 401 }
        );
      }

      // Extract event type
      const eventType = extractWebhookEvent(source, payload);

      // Create tasks for each valid trigger
      const tasks: Awaited<ReturnType<typeof taskQueue.createTask>>[] = [];
      for (const trigger of validTriggers) {
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
            eventType,
            payload,
            headers: {
              'content-type': headers['content-type'],
              'user-agent': headers['user-agent'],
            },
            triggerId: trigger.id,
            webhookLogId: webhookLog.id,
          },
          source: `webhook:${source}:${eventType}`,
        });

        tasks.push(task);
      }

      // Mark webhook as processed
      await db.webhookLog.update({
        where: { id: webhookLog.id },
        data: { processed: true, taskId: tasks[0]?.id },
      });

      // Log audit event
      await auditService.log({
        action: 'webhook_processed',
        entityType: 'webhook',
        entityId: webhookLog.id,
        details: { source, eventType, tasksCreated: tasks.length },
      });

      return NextResponse.json({
        success: true,
        message: `Webhook from ${source} processed`,
        eventType,
        tasksCreated: tasks.length,
        taskIds: tasks.map(t => t.id),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      await auditService.log({
        action: 'webhook_error',
        entityType: 'webhook',
        entityId: source,
        details: { error: message },
        severity: 'error',
      });

      return NextResponse.json(
        { success: false, error: message },
        { status: 500 }
      );
    }
  });
}

// GET /api/webhooks/[source] - Webhook verification (for some platforms)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  return withInit(async () => {
    const { source } = await params;
    const { searchParams } = new URL(request.url);
    
    // Support for various webhook verification challenges
    const challenge = searchParams.get('hub.challenge');
    if (challenge) {
      return new Response(challenge, { status: 200 });
    }

    // Slack URL verification
    const mode = searchParams.get('hub.mode');
    const verifyToken = searchParams.get('hub.verify_token');
    if (mode && verifyToken) {
      // You could verify the token against your triggers here
      return NextResponse.json({
        success: true,
        message: `Webhook endpoint for ${source} is active`,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Webhook endpoint for ${source} is active`,
      hint: 'Send a POST request with your webhook payload',
    });
  });
}
