import { io, type Socket } from 'socket.io-client';
import { eventBus, type EventMap } from './event-bus';
import type { WSEvent } from '@/lib/ws-events';

type BackplaneEventBus = Pick<typeof eventBus, 'dispatchLocal' | 'getSourceId'>;

type SocketFactory = typeof io;

export interface BackplaneClientDependencies {
  ioFactory?: SocketFactory;
  eventBus?: BackplaneEventBus;
}

function getWsServiceUrl(): string {
  return process.env.OPENCLAW_WS_URL || 'http://localhost:3003';
}

export class BackplaneClientService {
  private socket: Socket | null = null;
  private startPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: BackplaneClientDependencies = {}) {}

  private getEventBus(): BackplaneEventBus {
    return this.dependencies.eventBus ?? eventBus;
  }

  private getSocketFactory(): SocketFactory {
    return this.dependencies.ioFactory ?? io;
  }

  async start(): Promise<void> {
    if (this.socket?.connected) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    const socket = this.getSocketFactory()(getWsServiceUrl(), {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 2000,
      timeout: 5000,
    });

    this.socket = socket;

    this.bindSocket(socket);

    this.startPromise = new Promise((resolve) => {
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.startPromise = null;
        resolve();
      };

      socket.once('connect', () => {
        finish();
      });

      socket.once('connect_error', (error) => {
        console.warn('[BackplaneClient] Initial connection failed, retrying:', error instanceof Error ? error.message : error);
        finish();
      });

      socket.connect();
    });

    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    this.startPromise = null;

    socket.removeAllListeners();
    socket.disconnect();
    console.log('[BackplaneClient] Disconnected from WebSocket backplane');
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  private bindSocket(socket: Socket): void {
    const bus = this.getEventBus();

    socket.on('connect', () => {
      console.log('[BackplaneClient] Connected to WebSocket backplane');
      socket.emit('subscribe:internal');
    });

    socket.on('disconnect', (reason) => {
      console.warn(`[BackplaneClient] Disconnected from WebSocket backplane: ${reason}`);
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      console.info(`[BackplaneClient] Reconnecting to WebSocket backplane (attempt ${attempt})`);
    });

    socket.io.on('reconnect', (attempt) => {
      console.info(`[BackplaneClient] Reconnected to WebSocket backplane after ${attempt} attempt(s)`);
      socket.emit('subscribe:internal');
    });

    socket.io.on('reconnect_error', (error) => {
      console.warn('[BackplaneClient] Reconnect failed:', error instanceof Error ? error.message : error);
    });

    socket.on('event', (event: WSEvent) => {
      if (!event?.type || !event?.data) {
        return;
      }

      if (event.source && event.source === bus.getSourceId()) {
        return;
      }

      this.dispatchInternalEvent(bus, event);
    });
  }

  private dispatchInternalEvent(bus: BackplaneEventBus, event: WSEvent): void {
    switch (event.type) {
      case 'task:created':
      case 'task:started':
      case 'task:completed':
      case 'task:failed':
      case 'session:created':
      case 'memory:updated':
      case 'memory:index-requested':
      case 'subagent:completed':
      case 'subagent:failed':
        bus.dispatchLocal(event.type, event.data as EventMap[typeof event.type]);
        return;
      default:
        return;
    }
  }
}

export const backplaneClient = new BackplaneClientService();
