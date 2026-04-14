import type { ChannelAdapter, DeliveryTarget } from '@/lib/types';
import { buildInternalAuthHeaders } from '@/lib/internal-auth';
import { getWebsocketConfig } from '@/lib/config/runtime';

export class WebChatAdapter implements ChannelAdapter {
  readonly channel = 'webchat' as const;

  async sendText(target: DeliveryTarget, text: string): Promise<{ externalMessageId?: string }> {
    const sessionId = target.channelKey;
    const wsUrl = getWebsocketConfig().url;

    const response = await fetch(`${wsUrl}/broadcast`, {
      method: 'POST',
      headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
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
