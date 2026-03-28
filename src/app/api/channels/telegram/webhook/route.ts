import { NextRequest, NextResponse } from 'next/server';
import { Bot } from 'grammy';
import { inputManager } from '@/lib/services/input-manager';
import { processTelegramUpdate } from '@/lib/adapters/telegram-ingest';
import { downloadTelegramFile } from '@/lib/adapters/telegram-adapter';

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const providedSecret = request.headers.get('x-telegram-bot-api-secret-token');

  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const downloadBot = telegramBotToken ? new Bot(telegramBotToken) : null;

  const result = await processTelegramUpdate(body, {
    processInput: (input) => inputManager.processInput(input),
    downloadFile: downloadBot
      ? (fileId, destDir, filename) => downloadTelegramFile(downloadBot, fileId, destDir, filename)
      : undefined,
    sourceLabel: 'Telegram Webhook',
  });

  if (result.status === 'failed') {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  if (result.status === 'ignored') {
    return NextResponse.json({ success: true, ignored: true });
  }

  return NextResponse.json({
    success: true,
    data: {
      taskId: result.taskId,
      sessionId: result.sessionId,
    },
  });
}
