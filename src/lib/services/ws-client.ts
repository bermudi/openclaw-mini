import { buildInternalAuthHeaders } from '@/lib/internal-auth';
import type { WSBroadcastEvent } from '@/lib/ws-events';
import { getWebsocketConfig } from '@/lib/config/runtime';

function getWsServiceUrl(): string {
  return getWebsocketConfig().url;
}

class WSClientService {
  async broadcast(event: WSBroadcastEvent, agentId?: string): Promise<boolean> {
    try {
      const response = await fetch(`${getWsServiceUrl()}/broadcast`, {
        method: 'POST',
        headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(agentId ? { agentId, event } : { event }),
      });
      return response.ok;
    } catch (error) {
      console.error('[WSClient] Failed to broadcast:', error);
      return false;
    }
  }

  async broadcastToAgent(agentId: string, event: WSBroadcastEvent): Promise<boolean> {
    return this.broadcast(event, agentId);
  }

  /**
   * Check if WebSocket service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${getWsServiceUrl()}/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get WebSocket service stats
   */
  async getStats(): Promise<{
    totalConnections: number;
    rooms: Array<{ name: string; size: number }>;
  } | null> {
    try {
      const response = await fetch(`${getWsServiceUrl()}/stats`);
      if (response.ok) {
        return response.json();
      }
      return null;
    } catch {
      return null;
    }
  }
}

export const wsClient = new WSClientService();
