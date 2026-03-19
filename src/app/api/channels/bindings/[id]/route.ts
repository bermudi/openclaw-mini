// API Route: /api/channels/bindings/[id]
// Single channel binding operations

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// DELETE /api/channels/bindings/[id] - Delete a channel binding
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authentication = validateApiKey(request);
    if (!authentication.authorized) {
      return NextResponse.json(
        { success: false, error: authentication.error },
        { status: authentication.status },
      );
    }

    const { id } = await params;

    await db.channelBinding.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'Channel binding deleted successfully',
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json(
        { success: false, error: 'Channel binding not found' },
        { status: 404 },
      );
    }

    console.error('[ChannelBinding DELETE] Failed to delete binding:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

function validateApiKey(request: NextRequest): {
  authorized: boolean;
  error?: string;
  status?: number;
} {
  const configuredApiKey = process.env.OPENCLAW_API_KEY;

  if (!configuredApiKey) {
    console.error('[ChannelBinding DELETE] OPENCLAW_API_KEY is not configured');
    return { authorized: false, error: 'Internal server error', status: 500 };
  }

  const authorizationHeader = request.headers.get('authorization');
  const bearerToken = authorizationHeader?.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length).trim()
    : null;
  const providedApiKey = bearerToken || request.headers.get('x-api-key');

  if (!providedApiKey) {
    return { authorized: false, error: 'Unauthorized', status: 401 };
  }

  const configuredBuffer = Buffer.from(configuredApiKey);
  const providedBuffer = Buffer.from(providedApiKey);

  if (
    configuredBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(configuredBuffer, providedBuffer)
  ) {
    return { authorized: false, error: 'Forbidden', status: 403 };
  }

  return { authorized: true };
}
