// API Route: /api/triggers/[id]
// Single trigger operations

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAuth } from '@/lib/api-auth';
import { triggerService } from '@/lib/services/trigger-service';
import { storageErrorResponse } from '@/lib/api/storage-errors';
import { z } from 'zod';

const updateTriggerSchema = z.object({
  name: z.string().min(1, 'Trigger name must not be empty').optional(),
  enabled: z.boolean().optional(),
  config: z.object({
    // Heartbeat config
    interval: z.number().int().min(1).optional(),
    // Cron config
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    // Webhook config
    endpoint: z.string().optional(),
    secret: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
    // Hook config
    event: z.string().optional(),
    condition: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
});
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    const { id } = await params;
    const trigger = await triggerService.getTrigger(id);
    
    if (!trigger) {
      return NextResponse.json(
        { success: false, error: 'Trigger not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: trigger,
    });
  } catch (error) {
    const storageResponse = storageErrorResponse(error);
    if (storageResponse) return storageResponse;

    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = typeof error === 'object' && error && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

// PUT /api/triggers/[id] - Update trigger
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    const { id } = await params;
    const body = await request.json();
    
    // Validate request body
    const parsed = updateTriggerSchema.safeParse(body);
    if (!parsed.success) {
      const { formErrors, fieldErrors } = parsed.error.flatten();
      const fieldMessages = Object.values(fieldErrors).flat().filter(Boolean);
      const message = [...formErrors, ...fieldMessages].join(', ') || 'Invalid request payload';
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    
    const trigger = await triggerService.updateTrigger(id, parsed.data);
    
    if (!trigger) {
      return NextResponse.json(
        { success: false, error: 'Trigger not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: trigger,
      message: 'Trigger updated successfully',
    });
  } catch (error) {
    const storageResponse = storageErrorResponse(error);
    if (storageResponse) return storageResponse;

    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = typeof error === 'object' && error && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

// DELETE /api/triggers/[id] - Delete trigger
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    const { id } = await params;
    const deleted = await triggerService.deleteTrigger(id);
    
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Trigger not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Trigger deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = typeof error === 'object' && error && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
