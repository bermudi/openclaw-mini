// OpenClaw WebSocket Service
// Real-time updates for agent status, task queue, and triggers

import { Server } from 'socket.io';
import { createServer } from 'http';

const PORT = 3003;

// Create HTTP server
const httpServer = createServer();

// Create Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Event types for type safety
type WSEventType = 
  | 'task:created'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'agent:status'
  | 'trigger:fired'
  | 'memory:updated'
  | 'stats:update';

interface WSEvent {
  type: WSEventType;
  data: Record<string, unknown>;
  timestamp: Date;
}

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

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Broadcast event to all connected clients
export function broadcastEvent(event: WSEvent) {
  io.emit('event', event);
  console.log(`[WS] Broadcast: ${event.type}`);
}

// Broadcast event to agent-specific room
export function broadcastToAgent(agentId: string, event: WSEvent) {
  io.to(`agent:${agentId}`).emit('event', event);
  console.log(`[WS] Broadcast to agent ${agentId}: ${event.type}`);
}

// Broadcast to admin room
export function broadcastToAdmin(event: WSEvent) {
  io.to('admin').emit('event', event);
  console.log(`[WS] Broadcast to admin: ${event.type}`);
}

// Start server
httpServer.listen(PORT, () => {
  console.log(`[WS] OpenClaw WebSocket service running on port ${PORT}`);
});

export { io };
