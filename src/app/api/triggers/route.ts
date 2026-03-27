// API Route: /api/triggers
// Trigger management endpoints

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAuth } from '@/lib/api-auth';
import { triggerService } from '@/lib/services/trigger-service';
import { storageErrorResponse } from '@/lib/api/storage-errors';

// GET /api/triggers - List all triggers
export async function GET(request: NextRequest) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    const triggers = agentId
      ? await triggerService.getTriggersByAgent(agentId)
      : await triggerService.getAllTriggers();

    return NextResponse.json({
      success: true,
      data: triggers,
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

// POST /api/triggers - Create a new trigger
export async function POST(request: NextRequest) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    const body = await request.json();
    const { agentId, name, type, config, enabled } = body;

    if (!agentId || !name || !type || !config) {
      return NextResponse.json(
        { success: false, error: 'agentId, name, type, and config are required' },
        { status: 400 }
      );
    }

    const trigger = await triggerService.createTrigger({
      agentId,
      name,
      type,
      config,
      enabled,
    });

    return NextResponse.json({
      success: true,
      data: trigger,
      message: 'Trigger created successfully',
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
