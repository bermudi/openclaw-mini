import { z } from 'zod';
import { inboundFileService } from '@/lib/services/inbound-file-service';
import type { Attachment, DeliveryTarget, DownloadedFile, MessageInput, VisionInput } from '@/lib/types';

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

const TelegramMessageSchema = z.object({
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
});

export const TelegramUpdateSchema = z.object({
  message: TelegramMessageSchema.optional(),
}).passthrough();

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

export interface TelegramProcessInputResult {
  success: boolean;
  taskId?: string;
  sessionId?: string;
  error?: string;
}

export type TelegramProcessInput = (input: MessageInput) => Promise<TelegramProcessInputResult>;

export type TelegramFileDownloader = (
  fileId: string,
  destDir: string,
  filename?: string,
) => Promise<DownloadedFile>;

export interface TelegramIngestOptions {
  processInput: TelegramProcessInput;
  downloadFile?: TelegramFileDownloader;
  logger?: Pick<Console, 'warn' | 'error'>;
  sourceLabel?: string;
}

export type TelegramIngestResult =
  | { status: 'processed'; taskId?: string; sessionId?: string }
  | { status: 'ignored' }
  | { status: 'failed'; error: string };

export async function processTelegramUpdate(
  update: unknown,
  options: TelegramIngestOptions,
): Promise<TelegramIngestResult> {
  const source = options.sourceLabel ?? 'Telegram Ingest';
  const logger = options.logger ?? console;

  const parsed = TelegramUpdateSchema.safeParse(update);

  if (!parsed.success) {
    return { status: 'failed', error: 'Invalid Telegram update payload' };
  }

  const message = parsed.data.message;

  if (!message) {
    return { status: 'ignored' };
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

  if (options.downloadFile) {
    try {
      if (message.animation) {
        const downloadsDir = inboundFileService.getDownloadsDir('telegram');
        const { localPath, mimeType } = await options.downloadFile(
          message.animation.file_id,
          downloadsDir,
          message.animation.file_name,
        );

        attachments.push({
          channelFileId: message.animation.file_id,
          localPath,
          filename: message.animation.file_name ?? `${message.animation.file_id}.gif`,
          mimeType: message.animation.mime_type ?? mimeType,
          size: message.animation.file_size,
        });
      } else if (message.photo && message.photo.length > 0) {
        const largestPhoto = message.photo.reduce((best, current) => {
          const bestArea = best.width * best.height;
          const currentArea = current.width * current.height;
          return bestArea > currentArea ? best : current;
        });

        const downloadsDir = inboundFileService.getDownloadsDir('telegram');
        const { localPath, mimeType } = await options.downloadFile(largestPhoto.file_id, downloadsDir);

        visionInputs.push({
          channelFileId: largestPhoto.file_id,
          localPath,
          mimeType,
        });
      } else if (message.document && !message.animation) {
        const downloadsDir = inboundFileService.getDownloadsDir('telegram');
        const { localPath, mimeType } = await options.downloadFile(
          message.document.file_id,
          downloadsDir,
          message.document.file_name,
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
      logger.error(`[${source}] File download error:`, error);
    }
  } else if (message.photo || message.document || message.animation) {
    logger.warn(`[${source}] File attachments ignored: TELEGRAM_BOT_TOKEN not configured`);
  }

  if (!content && visionInputs.length === 0 && attachments.length === 0) {
    return { status: 'ignored' };
  }

  const result = await options.processInput({
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
    return { status: 'failed', error: result.error ?? 'Telegram input processing failed' };
  }

  return {
    status: 'processed',
    taskId: result.taskId,
    sessionId: result.sessionId,
  };
}
