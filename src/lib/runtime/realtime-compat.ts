import type { IncomingMessage, ServerResponse } from 'http';
import type { Server } from 'socket.io';
import {
  getSourceIp,
  logInternalAuthFailure,
  verifyInternalBearerToken,
} from '@/lib/internal-auth';
import type { WSBroadcastEvent, WSEvent } from '@/lib/ws-events';

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
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
        const { agentId, event } = JSON.parse(body) as { agentId?: string; event?: WSBroadcastEvent };

        if (!event?.type) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Event type required' }));
          return;
        }

        const wsEvent: WSEvent = {
          type: event.type,
          data: event.data ?? {},
          source: event.source,
          timestamp: new Date().toISOString(),
        };

        if (agentId) {
          io.to(`agent:${agentId}`).emit('event', wsEvent);
          io.to('admin').emit('event', wsEvent);
          io.to('internal').emit('event', wsEvent);
        } else {
          io.emit('event', wsEvent);
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        totalConnections: io.sockets.sockets.size,
        rooms: Array.from(rooms.keys()).map((room) => ({
          name: room,
          size: rooms.get(room)?.size ?? 0,
        })),
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}
