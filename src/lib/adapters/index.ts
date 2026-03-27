import { registerAdapter } from '@/lib/services/delivery-service';
import { TelegramAdapter } from '@/lib/adapters/telegram-adapter';
import { WebChatAdapter } from '@/lib/adapters/webchat-adapter';
import type { ChannelAdapter, DeliveryTarget } from '@/lib/types';

type WhatsAppAdapterLike = ChannelAdapter & {
  onQr?(callback: (qr: string) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
  sendFile?(target: DeliveryTarget, filePath: string, opts?: { filename?: string; mimeType?: string; caption?: string }): Promise<{ externalMessageId?: string }>;
  downloadFile?(fileId: string, destDir: string, filename?: string): Promise<{ localPath: string; mimeType: string }>;
};

class LazyWhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;
  private adapterPromise: Promise<WhatsAppAdapterLike> | null = null;
  private loadedAdapter: WhatsAppAdapterLike | null = null;

  private async loadAdapter(): Promise<WhatsAppAdapterLike> {
    if (!this.adapterPromise) {
      this.adapterPromise = import('@/lib/adapters/whatsapp-adapter').then(module => {
        this.loadedAdapter = new module.WhatsAppAdapter();
        return this.loadedAdapter;
      });
    }

    return this.adapterPromise;
  }

  async start(): Promise<void> {
    await (await this.loadAdapter()).start();
  }

  async stop(): Promise<void> {
    await (await this.loadAdapter()).stop();
  }

  isConnected(): boolean {
    return this.loadedAdapter?.isConnected() ?? false;
  }

  onQr(callback: (qr: string) => void): void {
    void this.loadAdapter().then(adapter => adapter.onQr?.(callback));
  }

  async sendText(target: DeliveryTarget, text: string): Promise<{ externalMessageId?: string }> {
    return (await this.loadAdapter()).sendText(target, text);
  }

  async sendFile(
    target: DeliveryTarget,
    filePath: string,
    opts?: { filename?: string; mimeType?: string; caption?: string },
  ): Promise<{ externalMessageId?: string }> {
    const adapter = await this.loadAdapter();
    if (!adapter.sendFile) {
      throw new Error('WhatsApp adapter does not support file delivery');
    }
    return adapter.sendFile(target, filePath, opts);
  }
}

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
    const whatsapp = new LazyWhatsAppAdapter();
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
