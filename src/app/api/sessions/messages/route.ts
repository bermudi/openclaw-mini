import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel');
  const channelKey = searchParams.get('channelKey');

  if (!channel || !channelKey) {
    return NextResponse.json(
      { success: false, error: 'channel and channelKey are required' },
      { status: 400 },
    );
  }

  try {
    const session = await db.session.findFirst({
      where: { channel, channelKey },
      select: { id: true },
    });

    if (!session) {
      return NextResponse.json({ success: true, data: [] });
    }

    const messages = await db.sessionMessage.findMany({
      where: { sessionId: session.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, role: true, content: true, createdAt: true },
    });

    return NextResponse.json({ success: true, data: messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
