import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { initializeAdapters } from '@/lib/adapters';
import { inputManager } from '@/lib/services/input-manager';
import type { DeliveryTarget } from '@/lib/types';

initializeAdapters();

const TelegramUpdateSchema = z.object({
  message: z.object({
    text: z.string().optional(),
    message_id: z.number().int(),
    message_thread_id: z.number().int().optional(),
    chat: z.object({
      id: z.union([z.string(), z.number()]),
    }),
    from: z.object({
      id: z.union([z.string(), z.number()]).optional(),
      username: z.string().optional(),
      first_name: z.string().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const providedSecret = request.headers.get('x-telegram-bot-api-secret-token');

  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = TelegramUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid Telegram update payload' }, { status: 400 });
  }

  const message = parsed.data.message;

  if (!message?.text) {
    return NextResponse.json({ success: true, ignored: true });
  }

  const chatId = String(message.chat.id);
  const senderId = message.from?.id ? String(message.from.id) : undefined;
  const deliveryTarget: DeliveryTarget = {
    channel: 'telegram',
    channelKey: chatId,
    metadata: {
      chatId,
      threadId: message.message_thread_id ? String(message.message_thread_id) : undefined,
      userId: senderId,
      replyToMessageId: String(message.message_id),
    },
  };

  const result = await inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: chatId,
    content: message.text,
    sender: message.from?.username ?? message.from?.first_name ?? senderId,
    deliveryTarget,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      taskId: result.taskId,
      sessionId: result.sessionId,
    },
  });
}
