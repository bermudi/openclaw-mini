// API Route: /api/channels/bindings
// Channel binding management

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAuth } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { withInit } from '@/lib/api/init-guard';

// GET /api/channels/bindings - List all channel bindings
export async function GET(request: NextRequest) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(request);
      if (authResponse) return authResponse;

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
        agentName: binding.agent?.name ?? null,
        createdAt: binding.createdAt,
      }));

      return NextResponse.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('[ChannelBinding GET] Failed to list bindings:', error);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 },
      );
    }
  });
}

// POST /api/channels/bindings - Create a new channel binding
export async function POST(request: NextRequest) {
  return withInit(async () => {
    try {
      const authResponse = await requireInternalAuth(request);
      if (authResponse) return authResponse;

      let body: { channel?: string; channelKey?: string; agentId?: string };
      try {
        body = await request.json();
      } catch (error) {
        if (error instanceof SyntaxError) {
          return NextResponse.json(
            { success: false, error: 'Invalid JSON payload' },
            { status: 400 },
          );
        }
        throw error;
      }
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

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return NextResponse.json(
          { success: false, error: 'Invalid agentId: referenced agent not found' },
          { status: 400 },
        );
      }

      console.error('[ChannelBinding POST] Failed to create binding:', error);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 },
      );
    }
  });
}
