// OpenClaw WebSocket Service
// Real-time updates for agent status, task queue, and triggers

import { Server } from 'socket.io';
import { createServer, IncomingMessage, ServerResponse } from 'http';

const PORT = parseInt(process.env.OPENCLAW_WS_PORT || '3003', 10);

// Event types for type safety
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
  timestamp: string;
}

// Create HTTP server
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /broadcast - Broadcast an event
  if (req.method === 'POST' && req.url === '/broadcast') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { agentId, event } = JSON.parse(body);
        
        if (!event || !event.type) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Event type required' }));
          return;
        }

        const wsEvent: WSEvent = {
          type: event.type,
          data: event.data || {},
          timestamp: new Date().toISOString(),
        };

        if (agentId) {
          io.to(`agent:${agentId}`).emit('event', wsEvent);
          io.to('admin').emit('event', wsEvent);
          console.log(`[WS] Broadcast to agent ${agentId}: ${wsEvent.type}`);
        } else {
          io.emit('event', wsEvent);
          console.log(`[WS] Broadcast to all: ${wsEvent.type}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // GET /health - Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      connections: io.sockets.sockets.size,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // GET /stats - Connection stats
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

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Create Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

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

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`[WS] OpenClaw WebSocket service running on port ${PORT}`);
  console.log(`[WS] HTTP endpoints: POST /broadcast, GET /health, GET /stats`);
});

export { io };
