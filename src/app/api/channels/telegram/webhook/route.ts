import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Bot } from 'grammy';
import { initializeAdapters } from '@/lib/adapters';
import { inputManager } from '@/lib/services/input-manager';
import { downloadTelegramFile } from '@/lib/adapters/telegram-adapter';
import { inboundFileService } from '@/lib/services/inbound-file-service';
import type { DeliveryTarget, Attachment, VisionInput } from '@/lib/types';

initializeAdapters();

const TelegramPhotoSizeSchema = z.object({
  file_id: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  file_size: z.number().int().optional(),
});

const TelegramDocumentSchema = z.object({
  file_id: z.string(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  file_size: z.number().int().optional(),
});

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
    photo: z.array(TelegramPhotoSizeSchema).optional(),
    document: TelegramDocumentSchema.optional(),
    animation: TelegramDocumentSchema.optional(),
    caption: z.string().optional(),
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

  if (!message) {
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

  const content = message.text ?? message.caption ?? '';
  const visionInputs: VisionInput[] = [];
  const attachments: Attachment[] = [];

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const downloadBot = telegramBotToken ? new Bot(telegramBotToken) : null;

  if (downloadBot) {
    try {
      if (message.photo && message.photo.length > 0) {
        const largestPhoto = message.photo.reduce((a, b) =>
          (a.width * a.height) > (b.width * b.height) ? a : b
        );
        const downloadsDir = inboundFileService.getDownloadsDir('telegram');
        const { localPath, mimeType } = await downloadTelegramFile(downloadBot, largestPhoto.file_id, downloadsDir);
        visionInputs.push({
          channelFileId: largestPhoto.file_id,
          localPath,
          mimeType,
        });
      }

      if (message.animation && !message.photo) {
        const downloadsDir = inboundFileService.getDownloadsDir('telegram');
        const { localPath, mimeType } = await downloadTelegramFile(
          downloadBot,
          message.animation.file_id,
          downloadsDir,
          message.animation.file_name
        );
        attachments.push({
          channelFileId: message.animation.file_id,
          localPath,
          filename: message.animation.file_name ?? `${message.animation.file_id}.gif`,
          mimeType: message.animation.mime_type ?? mimeType,
          size: message.animation.file_size,
        });
      } else if (message.document && !message.animation) {
        const downloadsDir = inboundFileService.getDownloadsDir('telegram');
        const { localPath, mimeType } = await downloadTelegramFile(
          downloadBot,
          message.document.file_id,
          downloadsDir,
          message.document.file_name
        );
        attachments.push({
          channelFileId: message.document.file_id,
          localPath,
          filename: message.document.file_name ?? `${message.document.file_id}`,
          mimeType: message.document.mime_type ?? mimeType,
          size: message.document.file_size,
        });
      }
    } catch (error) {
      console.error('[Telegram Webhook] File download error:', error);
    }
  } else if (message.photo || message.document || message.animation) {
    console.warn('[Telegram Webhook] File attachments ignored: TELEGRAM_BOT_TOKEN not configured');
  }

  if (!content && visionInputs.length === 0 && attachments.length === 0) {
    return NextResponse.json({ success: true, ignored: true });
  }

  const result = await inputManager.processInput({
    type: 'message',
    channel: 'telegram',
    channelKey: chatId,
    content,
    sender: message.from?.username ?? message.from?.first_name ?? senderId,
    deliveryTarget,
    attachments: attachments.length > 0 ? attachments : undefined,
    visionInputs: visionInputs.length > 0 ? visionInputs : undefined,
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
