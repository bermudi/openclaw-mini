// OpenClaw WebSocket Service
// Real-time updates for agent status, task queue, and triggers

import { Server } from 'socket.io';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import {
  ensureInternalAuthConfigured,
  getSourceIp,
  logInternalAuthFailure,
  verifyInternalBearerToken,
} from '../../src/lib/internal-auth';
import type { WSBroadcastEvent, WSEvent } from '../../src/lib/ws-events';

const PORT = parseInt(process.env.OPENCLAW_WS_PORT || '3003', 10);

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function createWsHttpHandler(io: Server) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/broadcast') {
      const authResult = verifyInternalBearerToken(req.headers.authorization);
      if (!authResult.ok) {
        await logInternalAuthFailure({
          route: '/broadcast',
          reason: authResult.reason,
          service: 'openclaw-ws',
          sourceIp: getSourceIp(req.headers, req.socket.remoteAddress),
        });
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      try {
        const body = await readRequestBody(req);
        const { agentId, event } = JSON.parse(body) as {
          agentId?: string;
          event?: WSBroadcastEvent;
        };

        if (!event || !event.type) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Event type required' }));
          return;
        }

        const wsEvent: WSEvent = {
          type: event.type,
          data: event.data || {},
          source: event.source,
          timestamp: new Date().toISOString(),
        };

        if (agentId) {
          io.to(`agent:${agentId}`).emit('event', wsEvent);
          io.to('admin').emit('event', wsEvent);
          io.to('internal').emit('event', wsEvent);
          console.log(`[WS] Broadcast to agent ${agentId}: ${wsEvent.type}`);
        } else {
          io.emit('event', wsEvent);
          console.log(`[WS] Broadcast to all: ${wsEvent.type}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        connections: io.sockets.sockets.size,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/stats') {
      const rooms = io.sockets.adapter.rooms;
      const stats = {
        totalConnections: io.sockets.sockets.size,
        rooms: Array.from(rooms.keys()).map(room => ({
          name: room,
          size: rooms.get(room)?.size || 0,
        })),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}

export function createOpenClawWsService() {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  httpServer.on('request', createWsHttpHandler(io));

  return { httpServer, io };
}

const service = createOpenClawWsService();
const { httpServer, io } = service;

// Connection handling
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Join agent-specific room
  socket.on('subscribe:agent', (agentId: string) => {
    socket.join(`agent:${agentId}`);
    console.log(`[WS] Client ${socket.id} subscribed to agent ${agentId}`);
  });

  // Leave agent-specific room
  socket.on('unsubscribe:agent', (agentId: string) => {
    socket.leave(`agent:${agentId}`);
    console.log(`[WS] Client ${socket.id} unsubscribed from agent ${agentId}`);
  });

  // Subscribe to all events (admin/dashboard)
  socket.on('subscribe:all', () => {
    socket.join('admin');
    console.log(`[WS] Client ${socket.id} subscribed to all events`);
  });

  // Unsubscribe from all events
  socket.on('unsubscribe:all', () => {
    socket.leave('admin');
    console.log(`[WS] Client ${socket.id} unsubscribed from all events`);
  });

  socket.on('subscribe:internal', () => {
    socket.join('internal');
    console.log(`[WS] Client ${socket.id} subscribed to internal events`);
  });

  socket.on('unsubscribe:internal', () => {
    socket.leave('internal');
    console.log(`[WS] Client ${socket.id} unsubscribed from internal events`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Start server
export function startOpenClawWsService(port: number = PORT) {
  ensureInternalAuthConfigured('openclaw-ws');
  httpServer.listen(port, () => {
    console.log(`[WS] OpenClaw WebSocket service running on port ${port}`);
    console.log('[WS] HTTP endpoints: POST /broadcast, GET /health, GET /stats');
  });
}

if (import.meta.main) {
  startOpenClawWsService();
}

export { io, httpServer };
