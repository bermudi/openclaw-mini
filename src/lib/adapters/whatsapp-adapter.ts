import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
  type BaileysEventMap,
} from '@whiskeysockets/baileys';
import { rmSync, existsSync } from 'fs';
import { Boom } from '@hapi/boom';
import type { ChannelAdapter, DeliveryTarget } from '@/lib/types';

const AUTH_DIR = 'data/whatsapp-auth';
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MULTIPLIER = 2;
const RECONNECT_MAX_RETRIES = 5;
const RECONNECT_JITTER_MS = 1_000;

type ConnectionState = BaileysEventMap['connection.update'];

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;
  private socket: WASocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private stopping = false;
  private qrCallback: ((qr: string) => void) | null = null;

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
    const externalMessageId = result?.key.id ?? undefined;
    return { externalMessageId };
  }

  private async connect(): Promise<void> {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

      const sock = makeWASocket({ auth: state, printQRInTerminal: false });
      this.socket = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update: ConnectionState) => {
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
      });

      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          const jid = msg.key.remoteJid;
          if (!jid || jid === 'status@broadcast') continue;

          const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
          if (!text) continue;

          void this.routeInbound(jid, text);
        }
      });
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
        headers: { 'Content-Type': 'application/json' },
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
}
