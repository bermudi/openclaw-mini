// API Route: /api/triggers/[id]
// Single trigger operations

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAuth } from '@/lib/api-auth';
import { triggerService } from '@/lib/services/trigger-service';
import { storageErrorResponse } from '@/lib/api/storage-errors';

// GET /api/triggers/[id] - Get trigger by ID
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
    
    const trigger = await triggerService.updateTrigger(id, body);
    
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
