// API Route: /api/channels/bindings/[id]
// Single channel binding operations

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAuth } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// DELETE /api/channels/bindings/[id] - Delete a channel binding
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

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
