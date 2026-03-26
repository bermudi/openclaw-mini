import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAuth } from '@/lib/api-auth';
import { storageErrorResponse } from '@/lib/api/storage-errors';
import { triggerService } from '@/lib/services/trigger-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    const { id } = await params;
    const rawBody = await request.text();
    const body = rawBody ? JSON.parse(rawBody) as { referenceTime?: string } : {};

    const result = await triggerService.fireTimeBasedTrigger(id, {
      mode: 'manual',
      referenceTime: body.referenceTime ? new Date(body.referenceTime) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Trigger fired successfully',
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
      { status },
    );
  }
}
