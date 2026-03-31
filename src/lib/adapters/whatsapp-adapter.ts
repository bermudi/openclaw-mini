import { rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { Boom } from '@hapi/boom';
import * as path from 'path';
import type { ChannelAdapter, DeliveryTarget, VisionInput, Attachment, DownloadedFile } from '@/lib/types';
import { buildInternalAuthHeaders } from '@/lib/internal-auth';
import { inboundFileService } from '@/lib/services/inbound-file-service';

type BaileysSocketLike = {
  ev: { on(event: string, cb: (...args: unknown[]) => void): void };
  sendMessage(jid: string, content: Record<string, unknown>): Promise<{ key?: { id?: string } }>;
  logout(): Promise<void>;
};

type BaileysModuleLike = {
  default?: (options: { auth: unknown; printQRInTerminal: boolean }) => BaileysSocketLike;
  makeWASocket?: (options: { auth: unknown; printQRInTerminal: boolean }) => BaileysSocketLike;
  useMultiFileAuthState?: (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
  DisconnectReason?: { loggedOut: unknown; badSession: unknown; connectionReplaced: unknown };
  downloadMediaMessage?: (message: unknown, type: 'buffer', options: Record<string, unknown>) => Promise<Uint8Array | Buffer>;
  extensionForMediaMessage?: (message: unknown) => string | undefined;
};

async function getBaileysModule(): Promise<BaileysModuleLike> {
  // Use runtime dynamic import to prevent Turbopack from analyzing this
  const runtimeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<unknown>;
  const module = await runtimeImport('@whiskeysockets/baileys');
  return module as BaileysModuleLike;
}

function getMakeWASocket(module: BaileysModuleLike): ((options: { auth: unknown; printQRInTerminal: boolean }) => BaileysSocketLike) | null {
  return module.makeWASocket ?? module.default ?? null;
}

function getDisconnectReason(module: BaileysModuleLike): BaileysModuleLike['DisconnectReason'] | null {
  return module.DisconnectReason ?? null;
}

function getMediaHelpers(module: BaileysModuleLike): {
  downloadMediaMessage: BaileysModuleLike['downloadMediaMessage'] | null;
  extensionForMediaMessage: BaileysModuleLike['extensionForMediaMessage'] | null;
} {
  const candidates: Array<Record<string, unknown> | null> = [];
  const seen = new Set<unknown>();

  const pushCandidate = (value: unknown): void => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (typeof value === 'object' || typeof value === 'function') {
      candidates.push(value as Record<string, unknown>);
      const nested = (value as Record<string, unknown>).default;
      if (nested && nested !== value) pushCandidate(nested);
    }
  };

  pushCandidate(module);
  pushCandidate(module.default);

  const pickHelper = <T extends 'downloadMediaMessage' | 'extensionForMediaMessage'>(name: T): BaileysModuleLike[T] | null => {
    for (const candidate of candidates) {
      const value = candidate?.[name];
      if (typeof value === 'function') return value as BaileysModuleLike[T];
    }

    return null;
  };

  return {
    downloadMediaMessage: pickHelper('downloadMediaMessage'),
    extensionForMediaMessage: pickHelper('extensionForMediaMessage'),
  };
}

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || 'data/whatsapp-auth';
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MULTIPLIER = 2;
const RECONNECT_MAX_RETRIES = 5;
const RECONNECT_JITTER_MS = 1_000;

type ConnectionState = {
  connection?: 'open' | 'close' | string;
  lastDisconnect?: { error?: Boom };
  qr?: string;
};

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;
  private socket: BaileysSocketLike | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private stopping = false;
  private qrCallback: ((qr: string) => void) | null = null;
  private mediaHelpers: {
    downloadMediaMessage: BaileysModuleLike['downloadMediaMessage'] | null;
    extensionForMediaMessage: BaileysModuleLike['extensionForMediaMessage'] | null;
  } = { downloadMediaMessage: null, extensionForMediaMessage: null };

  async start(): Promise<void> {
    this.stopping = false;
    this.reconnectAttempts = 0;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch {
        // ignore logout errors on intentional stop
      }
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onQr(callback: (qr: string) => void): void {
    this.qrCallback = callback;
  }

  async sendText(target: DeliveryTarget, text: string): Promise<{ externalMessageId?: string }> {
    if (!this.connected || !this.socket) {
      throw new Error('WhatsApp connection is not active');
    }

    const chatId = target.metadata.chatId;
    if (!chatId) {
      throw new Error('WhatsApp delivery target is missing chatId');
    }

    const result = await this.socket.sendMessage(chatId, { text });
    const externalMessageId = result.key?.id;
    return { externalMessageId };
  }

  async sendFile(target: DeliveryTarget, filePath: string, opts?: {
    filename?: string;
    mimeType?: string;
    caption?: string;
  }): Promise<{ externalMessageId?: string }> {
    if (!this.connected || !this.socket) {
      throw new Error('WhatsApp connection is not active');
    }

    const chatId = target.metadata.chatId;
    if (!chatId) {
      throw new Error('WhatsApp delivery target is missing chatId');
    }

    const result = await this.socket.sendMessage(chatId, {
      document: { url: filePath },
      mimetype: opts?.mimeType ?? 'application/octet-stream',
      fileName: opts?.filename,
      caption: opts?.caption,
    });
    const externalMessageId = result.key?.id;
    return { externalMessageId };
  }

  /**
   * Download a media file from WhatsApp.
   * For WhatsApp, the fileId is the message ID, and we need additional context
   * (jid, message type, mediaKey, mimetype) which must be provided.
   */
  async downloadFile(
    fileId: string,
    destDir: string,
    filename?: string,
    context?: {
      jid: string;
      messageType: 'image' | 'document';
      mediaKey?: Uint8Array;
      mimetype?: string;
      fileName?: string;
    },
  ): Promise<DownloadedFile> {
    if (!this.socket) {
      throw new Error('WhatsApp socket not available');
    }

    if (!context) {
      throw new Error('WhatsApp download requires message context (jid, messageType, mediaKey, mimetype)');
    }

    const { jid, messageType, mediaKey, mimetype, fileName } = context;

    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    const helpers = this.mediaHelpers.downloadMediaMessage || this.mediaHelpers.extensionForMediaMessage
      ? this.mediaHelpers
      : getMediaHelpers(await getBaileysModule());
    const { downloadMediaMessage, extensionForMediaMessage } = helpers;

    if (!downloadMediaMessage || !extensionForMediaMessage) {
      throw new Error('WhatsApp media helpers are unavailable');
    }

    const messageWrapper = messageType === 'image'
      ? { key: { remoteJid: jid }, message: { imageMessage: { mediaKey, mimetype } } } as never
      : { key: { remoteJid: jid }, message: { documentMessage: { mediaKey, mimetype, fileName } } } as never;

    const buffer = await downloadMediaMessage(messageWrapper, 'buffer', {});
    const ext = extensionForMediaMessage({ mediaKey, mimetype } as never) ?? (messageType === 'image' ? 'jpg' : '');
    const destFilename = filename ?? fileName ?? `${fileId}.${ext}`;
    const localPath = path.join(destDir, destFilename);
    writeFileSync(localPath, buffer);

    return { localPath, mimeType: mimetype ?? 'application/octet-stream' };
  }

  private async connect(): Promise<void> {
    try {
      const baileys = await getBaileysModule();
      const makeWASocket = getMakeWASocket(baileys);
      const DisconnectReason = getDisconnectReason(baileys);
      if (!makeWASocket || typeof baileys.useMultiFileAuthState !== 'function' || !DisconnectReason) {
        throw new Error('WhatsApp adapter is unavailable');
      }

      this.mediaHelpers = getMediaHelpers(baileys);

      const { state, saveCreds } = await baileys.useMultiFileAuthState(AUTH_DIR);

      const sock = makeWASocket({ auth: state, printQRInTerminal: false });
      this.socket = sock;

      sock.ev.on('creds.update', saveCreds);

      const onConnectionUpdate = (update: ConnectionState): void => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && this.qrCallback) {
          this.qrCallback(qr);
        }

        if (connection === 'open') {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('[WhatsApp] Connected');
        }

        if (connection === 'close') {
          this.connected = false;
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          if (isLoggedOut) {
            console.error('[WhatsApp] Logged out — clearing auth state, QR pairing required');
            this.clearAuthState();
            return;
          }

          const isAuthFailure =
            statusCode === DisconnectReason.badSession ||
            statusCode === DisconnectReason.connectionReplaced;

          if (isAuthFailure) {
            console.error('[WhatsApp] Auth failure — clearing auth state, QR pairing required');
            this.clearAuthState();
            return;
          }

          if (!this.stopping) {
            void this.scheduleReconnect();
          }
        }
      };

      sock.ev.on('connection.update', onConnectionUpdate as unknown as (...args: unknown[]) => void);

      const onMessagesUpsert = (event: { messages: Array<{ key: { remoteJid?: string; id?: string }; message?: { conversation?: string; extendedTextMessage?: { text?: string }; imageMessage?: { mediaKey?: Uint8Array; mimetype?: string; caption?: string }; documentMessage?: { mediaKey?: Uint8Array; mimetype?: string; fileName?: string; caption?: string } } }>; type: string }): void => {
        const { messages, type } = event;
        if (type !== 'notify') return;

        for (const msg of messages) {
          const jid = msg.key.remoteJid;
          if (!jid || jid === 'status@broadcast') continue;

          const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
          const imageMessage = msg.message?.imageMessage as { mediaKey?: Uint8Array; mimetype?: string; caption?: string } | undefined;
          const documentMessage = msg.message?.documentMessage as { mediaKey?: Uint8Array; mimetype?: string; fileName?: string; caption?: string } | undefined;

          const hasImagePayload = !!imageMessage && (!!imageMessage.mediaKey || !!imageMessage.mimetype || !!imageMessage.caption);
          const hasDocumentPayload = !!documentMessage && (!!documentMessage.mediaKey || !!documentMessage.mimetype || !!documentMessage.fileName || !!documentMessage.caption);

          if (hasImagePayload || hasDocumentPayload) {
            void this.routeInboundMedia(jid, msg.key.id ?? 'unknown', imageMessage, documentMessage);
          } else if (text && msg.message && ('conversation' in msg.message || 'extendedTextMessage' in msg.message)) {
            void this.routeInbound(jid, text);
          }
        }
      };

      sock.ev.on('messages.upsert', onMessagesUpsert as unknown as (...args: unknown[]) => void);
    } catch (error) {
      this.connected = false;
      console.error('[WhatsApp] Failed to start connection:', error);

      if (!this.stopping) {
        void this.scheduleReconnect();
      }
    }
  }

  private clearAuthState(): void {
    if (existsSync(AUTH_DIR)) {
      rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    this.connected = false;
    this.socket = null;
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= RECONNECT_MAX_RETRIES) {
      console.error(`[WhatsApp] Max reconnection attempts (${RECONNECT_MAX_RETRIES}) exceeded — giving up`);
      this.connected = false;
      return;
    }

    const attempt = ++this.reconnectAttempts;
    const backoff = RECONNECT_BASE_MS * RECONNECT_MULTIPLIER ** (attempt - 1);
    const jitter = Math.random() * RECONNECT_JITTER_MS;
    const delay = backoff + jitter;

    console.log(`[WhatsApp] Reconnecting in ${Math.round(delay)}ms (attempt ${attempt}/${RECONNECT_MAX_RETRIES})`);

    await new Promise<void>((resolve) => setTimeout(resolve, delay));

    if (!this.stopping) {
      await this.connect();
    }
  }

  private async routeInbound(jid: string, text: string): Promise<void> {
    const appUrl = process.env.OPENCLAW_APP_URL ?? 'http://localhost:3000';

    try {
      await fetch(`${appUrl}/api/input`, {
        method: 'POST',
        headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          type: 'message',
          channel: 'whatsapp',
          channelKey: jid,
          content: text,
          deliveryTarget: {
            channel: 'whatsapp',
            channelKey: jid,
            metadata: { chatId: jid },
          },
        }),
      });
    } catch (error) {
      console.error('[WhatsApp] Failed to route inbound message:', error);
    }
  }

  private async routeInboundMedia(
    jid: string,
    msgId: string,
    imageMessage?: { mediaKey?: Uint8Array; mimetype?: string; caption?: string },
    documentMessage?: { mediaKey?: Uint8Array; mimetype?: string; fileName?: string; caption?: string },
  ): Promise<void> {
    if (!this.socket) {
      console.error('[WhatsApp] Cannot download media: socket not available');
      return;
    }

    const appUrl = process.env.OPENCLAW_APP_URL ?? 'http://localhost:3000';
    const downloadsDir = inboundFileService.getDownloadsDir('whatsapp');
    const baileys = await getBaileysModule();
    const helpers = this.mediaHelpers.downloadMediaMessage || this.mediaHelpers.extensionForMediaMessage
      ? this.mediaHelpers
      : getMediaHelpers(baileys);

    try {
      const { downloadMediaMessage, extensionForMediaMessage } = helpers;
      if (!downloadMediaMessage || !extensionForMediaMessage) {
        throw new Error('WhatsApp media helpers are unavailable');
      }

      let visionInputs: VisionInput[] | undefined;
      let attachments: Attachment[] | undefined;
      let caption = '';

      if (imageMessage) {
        const buffer = await downloadMediaMessage(
          { key: { remoteJid: jid }, message: { imageMessage } } as never,
          'buffer',
          {}
        );
        const ext = extensionForMediaMessage({ mediaKey: imageMessage.mediaKey, mimetype: imageMessage.mimetype } as never) ?? 'jpg';
        const filename = `${msgId}.${ext}`;
        const localPath = path.join(downloadsDir, filename);
        writeFileSync(localPath, buffer);
        caption = imageMessage.caption ?? '';
        visionInputs = [{
          channelFileId: msgId,
          localPath,
          mimeType: imageMessage.mimetype ?? 'image/jpeg',
        }];
      } else if (documentMessage) {
        const buffer = await downloadMediaMessage(
          { key: { remoteJid: jid }, message: { documentMessage } } as never,
          'buffer',
          {}
        );
        const ext = extensionForMediaMessage({ mediaKey: documentMessage.mediaKey, mimetype: documentMessage.mimetype } as never) ?? '';
        const filename = documentMessage.fileName ?? `${msgId}.${ext}`;
        const localPath = path.join(downloadsDir, filename);
        writeFileSync(localPath, buffer);
        caption = documentMessage.caption ?? '';
        attachments = [{
          channelFileId: msgId,
          localPath,
          filename,
          mimeType: documentMessage.mimetype ?? 'application/octet-stream',
        }];
      }

      await fetch(`${appUrl}/api/input`, {
        method: 'POST',
        headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          type: 'message',
          channel: 'whatsapp',
          channelKey: jid,
          content: caption,
          deliveryTarget: {
            channel: 'whatsapp',
            channelKey: jid,
            metadata: { chatId: jid },
          },
          visionInputs,
          attachments,
        }),
      });
    } catch (error) {
      console.error('[WhatsApp] Failed to route inbound media message:', error);
    }
  }
}

type BaileysHelpersModule = Record<string, unknown>;
