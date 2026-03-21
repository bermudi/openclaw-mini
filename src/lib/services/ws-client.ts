// OpenClaw Agent Runtime - WebSocket Client
// Client to broadcast events to the WebSocket service

const WS_SERVICE_URL = process.env.OPENCLAW_WS_URL || 'http://localhost:3003';

type WSEventType = 
  | 'task:created'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'agent:status'
  | 'trigger:fired'
  | 'memory:updated'
  | 'stats:update'
  | 'tool:called'
  | 'session:updated';

interface WSEvent {
  type: WSEventType;
  data: Record<string, unknown>;
}

class WSClientService {
  /**
   * Broadcast an event to all connected clients
   */
  async broadcast(event: WSEvent): Promise<boolean> {
    try {
      const response = await fetch(`${WS_SERVICE_URL}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      });
      return response.ok;
    } catch (error) {
      console.error('[WSClient] Failed to broadcast:', error);
      return false;
    }
  }

  /**
   * Broadcast an event to a specific agent's subscribers
   */
  async broadcastToAgent(agentId: string, event: WSEvent): Promise<boolean> {
    try {
      const response = await fetch(`${WS_SERVICE_URL}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, event }),
      });
      return response.ok;
    } catch (error) {
      console.error('[WSClient] Failed to broadcast to agent:', error);
      return false;
    }
  }

  /**
   * Check if WebSocket service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${WS_SERVICE_URL}/health`, {
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
      const response = await fetch(`${WS_SERVICE_URL}/stats`);
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

// Convenience functions for common events
export const broadcastTaskCreated = (agentId: string, taskId: string, taskType: string) =>
  wsClient.broadcastToAgent(agentId, {
    type: 'task:created',
    data: { taskId, taskType },
  });

export const broadcastTaskStarted = (agentId: string, taskId: string) =>
  wsClient.broadcastToAgent(agentId, {
    type: 'task:started',
    data: { taskId },
  });

export const broadcastTaskCompleted = (agentId: string, taskId: string, result?: unknown) =>
  wsClient.broadcastToAgent(agentId, {
    type: 'task:completed',
    data: { taskId, result },
  });

export const broadcastTaskFailed = (agentId: string, taskId: string, error: string) =>
  wsClient.broadcastToAgent(agentId, {
    type: 'task:failed',
    data: { taskId, error },
  });

export const broadcastAgentStatus = (agentId: string, status: string) =>
  wsClient.broadcast({
    type: 'agent:status',
    data: { agentId, status },
  });

export const broadcastTriggerFired = (agentId: string, triggerId: string, triggerName: string) =>
  wsClient.broadcastToAgent(agentId, {
    type: 'trigger:fired',
    data: { triggerId, triggerName },
  });

export const broadcastToolCalled = (agentId: string, toolName: string, success: boolean) =>
  wsClient.broadcastToAgent(agentId, {
    type: 'tool:called',
    data: { toolName, success },
  });
