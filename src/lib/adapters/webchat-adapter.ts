import type { ChannelAdapter, DeliveryTarget } from '@/lib/types';

const WS_URL = process.env.OPENCLAW_WS_URL ?? 'http://localhost:3003';

export class WebChatAdapter implements ChannelAdapter {
  readonly channel = 'webchat' as const;

  async sendText(target: DeliveryTarget, text: string): Promise<{ externalMessageId?: string }> {
    const sessionId = target.channelKey;

    const response = await fetch(`${WS_URL}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          type: 'session:updated',
          data: {
            sessionId,
            channel: 'webchat',
            message: text,
            role: 'agent',
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`WebChat broadcast failed: ${response.status}`);
    }

    return {};
  }
}
