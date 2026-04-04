import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'http';
import type { Socket as NetSocket } from 'net';
import { Server } from 'socket.io';
import {
  getSourceIp,
  logInternalAuthFailure,
  verifyInternalBearerToken,
} from '@/lib/internal-auth';
import { getRuntimeCorsHeaders, isRuntimeCorsOriginAllowed } from '@/lib/runtime-cors';
import type { WSBroadcastEvent, WSEvent } from '@/lib/ws-events';

export type RuntimeReadinessState = 'booting' | 'ready' | 'failed' | 'stopping' | 'stopped';

export interface RuntimeReadinessSnapshot {
  state: RuntimeReadinessState;
  error?: string | null;
}

export interface RuntimeRealtimeServerOptions {
  port?: number;
  readinessProvider?: () => RuntimeReadinessSnapshot;
}

export interface RuntimeRealtimeStats {
  totalConnections: number;
  rooms: Array<{ name: string; size: number }>;
}

function getRuntimeRealtimePort(): number {
  return Number.parseInt(process.env.OPENCLAW_WS_PORT ?? '3003', 10);
}

function getRequestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;

  if (Array.isArray(origin)) {
    return origin[0] ?? null;
  }

  return origin ?? null;
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const corsHeaders = getRuntimeCorsHeaders(getRequestOrigin(req));

  for (const [name, value] of Object.entries(corsHeaders)) {
    res.setHeader(name, value);
  }
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

export class RuntimeRealtimeServer {
  private port: number;
  private readonly readinessProvider: () => RuntimeReadinessSnapshot;
  private httpServer: HttpServer | null = null;
  private io: Server | null = null;
  private startPromise: Promise<void> | null = null;
  private readonly openConnections = new Set<NetSocket>();

  constructor(options: RuntimeRealtimeServerOptions = {}) {
    this.port = options.port ?? getRuntimeRealtimePort();
    this.readinessProvider = options.readinessProvider ?? (() => ({ state: 'booting', error: null }));
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();

    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  private async startInternal(): Promise<void> {
    if (this.httpServer && this.io) {
      return;
    }

    const httpServer = createServer();
    httpServer.on('connection', (socket) => {
      this.openConnections.add(socket);
      socket.on('close', () => {
        this.openConnections.delete(socket);
      });
    });

    const io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          callback(null, isRuntimeCorsOriginAllowed(origin));
        },
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      },
    });

    this.bindSocketHandlers(io);
    httpServer.on('request', (req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        httpServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        resolve();
      };

      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(this.port);
    });

    const address = httpServer.address();
    if (address && typeof address === 'object') {
      this.port = address.port;
    }

    this.httpServer = httpServer;
    this.io = io;
  }

  async stop(): Promise<void> {
    const io = this.io;
    const httpServer = this.httpServer;

    this.io = null;
    this.httpServer = null;
    this.startPromise = null;

    if (io) {
      const closePromise = io.close();
      this.destroyOpenConnections();
      await closePromise;
      return;
    }

    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve();
          return;
        }

        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      this.destroyOpenConnections();
    }
  }

  private destroyOpenConnections(): void {
    for (const socket of this.openConnections) {
      socket.destroy();
    }
    this.openConnections.clear();
  }

  async broadcast(event: WSBroadcastEvent, agentId?: string): Promise<boolean> {
    if (!this.io) {
      return false;
    }

    const wsEvent: WSEvent = {
      type: event.type,
      data: event.data ?? {},
      source: event.source,
      timestamp: new Date().toISOString(),
    };

    if (agentId) {
      this.io.to(`agent:${agentId}`).emit('event', wsEvent);
      this.io.to('admin').emit('event', wsEvent);
      this.io.to('internal').emit('event', wsEvent);
    } else {
      this.io.emit('event', wsEvent);
    }

    return true;
  }

  getStats(): RuntimeRealtimeStats {
    if (!this.io) {
      return {
        totalConnections: 0,
        rooms: [],
      };
    }

    const rooms = this.io.sockets.adapter.rooms;
    return {
      totalConnections: this.io.sockets.sockets.size,
      rooms: Array.from(rooms.keys()).map((room) => ({
        name: room,
        size: rooms.get(room)?.size ?? 0,
      })),
    };
  }

  getPort(): number {
    return this.port;
  }

  private bindSocketHandlers(io: Server): void {
    io.on('connection', (socket) => {
      socket.on('subscribe:agent', (agentId: string) => {
        socket.join(`agent:${agentId}`);
      });

      socket.on('unsubscribe:agent', (agentId: string) => {
        socket.leave(`agent:${agentId}`);
      });

      socket.on('subscribe:all', () => {
        socket.join('admin');
        socket.emit('subscribed:all');
      });

      socket.on('unsubscribe:all', () => {
        socket.leave('admin');
      });

      socket.on('subscribe:internal', () => {
        socket.join('internal');
        socket.emit('subscribed:internal');
      });

      socket.on('unsubscribe:internal', () => {
        socket.leave('internal');
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = getRequestOrigin(req);
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      if (origin && !isRuntimeCorsOriginAllowed(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Origin not allowed' }));
        return;
      }

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

        if (!event?.type) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Event type required' }));
          return;
        }

        const ok = await this.broadcast(event, agentId);
        res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: ok }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      const readiness = this.readinessProvider();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: readiness.state === 'failed' ? 'degraded' : 'healthy',
        readiness: readiness.state,
        error: readiness.error ?? null,
        connections: this.io?.sockets.sockets.size ?? 0,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/ready') {
      const readiness = this.readinessProvider();
      const statusCode = readiness.state === 'ready' ? 200 : readiness.state === 'failed' ? 503 : 425;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ready: readiness.state === 'ready',
        state: readiness.state,
        error: readiness.error ?? null,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getStats()));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}
