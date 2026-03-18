// API Route: /api/channels/bindings/[id]
// Single channel binding operations

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// DELETE /api/channels/bindings/[id] - Delete a channel binding
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
