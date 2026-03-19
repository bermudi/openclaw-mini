import { registerAdapter } from '@/lib/services/delivery-service';
import { TelegramAdapter } from '@/lib/adapters/telegram-adapter';

let initialized = false;

export function initializeAdapters(): void {
  if (initialized) {
    return;
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

  if (telegramBotToken) {
    registerAdapter(new TelegramAdapter(telegramBotToken));
  } else {
    console.log('[Adapters] Telegram adapter not configured');
  }

  initialized = true;
}

export function resetAdapterInitializationForTests(): void {
  initialized = false;
}
