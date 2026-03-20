'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = 'http://localhost:3003';

export interface OpenClawEventHandlers {
  onTaskCreated?: (data: Record<string, unknown>) => void;
  onTaskStarted?: (data: Record<string, unknown>) => void;
  onTaskCompleted?: (data: Record<string, unknown>) => void;
  onTaskFailed?: (data: Record<string, unknown>) => void;
  onAgentStatus?: (data: Record<string, unknown>) => void;
  onTriggerFired?: (data: Record<string, unknown>) => void;
  onStatsUpdate?: (data: Record<string, unknown>) => void;
  onSessionUpdated?: (data: Record<string, unknown>) => void;
  onMemoryUpdated?: (data: Record<string, unknown>) => void;
  onToolCalled?: (data: Record<string, unknown>) => void;
  onReconnect?: () => void;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

export function useOpenClawEvents(handlers: OpenClawEventHandlers) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const dispatch = useCallback((eventType: string, data: Record<string, unknown>) => {
    const h = handlersRef.current;
    switch (eventType) {
      case 'task:created': h.onTaskCreated?.(data); break;
      case 'task:started': h.onTaskStarted?.(data); break;
      case 'task:completed': h.onTaskCompleted?.(data); break;
      case 'task:failed': h.onTaskFailed?.(data); break;
      case 'agent:status': h.onAgentStatus?.(data); break;
      case 'trigger:fired': h.onTriggerFired?.(data); break;
      case 'stats:update': h.onStatsUpdate?.(data); break;
      case 'session:updated': h.onSessionUpdated?.(data); break;
      case 'memory:updated': h.onMemoryUpdated?.(data); break;
      case 'tool:called': h.onToolCalled?.(data); break;
    }
  }, []);

  useEffect(() => {
    const socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      socket.emit('subscribe:all');
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socket.io.on('reconnect_attempt', () => {
      setConnectionStatus('reconnecting');
    });

    socket.io.on('reconnect', () => {
      setConnectionStatus('connected');
      socket.emit('subscribe:all');
      handlersRef.current.onReconnect?.();
    });

    // Listen for all event types
    const eventTypes = [
      'task:created', 'task:started', 'task:completed', 'task:failed',
      'agent:status', 'trigger:fired', 'stats:update', 'session:updated',
      'memory:updated', 'tool:called',
    ];

    for (const eventType of eventTypes) {
      socket.on(eventType, (data: Record<string, unknown>) => {
        dispatch(eventType, data);
      });
    }

    // Also handle generic 'event' messages from the broadcast endpoint
    socket.on('event', (payload: { type: string; data: Record<string, unknown> }) => {
      if (payload?.type && payload?.data) {
        dispatch(payload.type, payload.data);
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [dispatch]);

  return {
    connected: connectionStatus === 'connected',
    connectionStatus,
  };
}
