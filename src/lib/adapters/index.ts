import { registerAdapter } from '@/lib/services/delivery-service';
import { TelegramAdapter } from '@/lib/adapters/telegram-adapter';
import { WhatsAppAdapter } from '@/lib/adapters/whatsapp-adapter';
import { WebChatAdapter } from '@/lib/adapters/webchat-adapter';
import type { ChannelAdapter } from '@/lib/types';

let initialized = false;
let registeredAdapters: ChannelAdapter[] = [];

export function initializeAdapters(): ChannelAdapter[] {
  if (initialized) {
    return registeredAdapters;
  }

  const adapters: ChannelAdapter[] = [];

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramBotToken) {
    const telegram = new TelegramAdapter(telegramBotToken);
    registerAdapter(telegram);
    adapters.push(telegram);
  } else {
    console.log('[Adapters] Telegram adapter not configured');
  }

  if (process.env.WHATSAPP_ENABLED === 'true') {
    const whatsapp = new WhatsAppAdapter();
    registerAdapter(whatsapp);
    adapters.push(whatsapp);
  } else {
    console.log('[Adapters] WhatsApp adapter not configured');
  }

  const webchat = new WebChatAdapter();
  registerAdapter(webchat);
  adapters.push(webchat);

  registeredAdapters = adapters;
  initialized = true;
  return registeredAdapters;
}

export function getRegisteredAdapters(): ChannelAdapter[] {
  return registeredAdapters;
}

export function resetAdapterInitializationForTests(): void {
  initialized = false;
  registeredAdapters = [];
}
