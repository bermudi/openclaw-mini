// API Route: /api/channels/bindings
// Channel binding management

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// GET /api/channels/bindings - List all channel bindings
export async function GET() {
  try {
    const bindings = await db.channelBinding.findMany({
      include: {
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = bindings.map(binding => ({
      id: binding.id,
      channel: binding.channel,
      channelKey: binding.channelKey,
      agentId: binding.agentId,
      agentName: binding.agent.name,
      createdAt: binding.createdAt,
    }));

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

// POST /api/channels/bindings - Create a new channel binding
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { channel, channelKey, agentId } = body as {
      channel?: string;
      channelKey?: string;
      agentId?: string;
    };

    if (!channel || !channelKey || !agentId) {
      return NextResponse.json(
        { success: false, error: 'channel, channelKey, and agentId are required' },
        { status: 400 },
      );
    }

    const binding = await db.channelBinding.create({
      data: {
        channel,
        channelKey,
        agentId,
      },
    });

    return NextResponse.json({
      success: true,
      data: binding,
      message: 'Channel binding created successfully',
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { success: false, error: 'Channel binding already exists' },
        { status: 409 },
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
