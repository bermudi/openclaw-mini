'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Send, Bot, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDashboardRuntimeConfigError, getDashboardRuntimeConfigOrNull } from '@/lib/dashboard-runtime-client';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 16_000;

type MessageRole = 'user' | 'agent';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

function getOrCreateSessionId(): string {
  const existing = sessionStorage.getItem('openclaw-webchat-session');
  if (existing) return existing;
  const id = `webchat-${crypto.randomUUID()}`;
  sessionStorage.setItem('openclaw-webchat-session', id);
  return id;
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const styles: Record<ConnectionStatus, string> = {
    connected: 'bg-emerald-400 shadow-emerald-400/50 shadow-sm',
    disconnected: 'bg-red-500',
    reconnecting: 'bg-amber-400 animate-pulse shadow-amber-400/50 shadow-sm',
  };
  const labels: Record<ConnectionStatus, string> = {
    connected: 'connected',
    disconnected: 'disconnected',
    reconnecting: 'reconnecting…',
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${styles[status]}`} />
      <span className="text-xs text-zinc-500 font-mono">{labels[status]}</span>
    </div>
  );
}

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('disconnected');
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);
  const configError = getDashboardRuntimeConfigError();
  const runtimeConfig = getDashboardRuntimeConfigOrNull();

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const removeMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(message => message.id !== messageId));
  }, []);

  // Load chat history on mount
  useEffect(() => {
    const sid = getOrCreateSessionId();
    setSessionId(sid);

    if (configError) {
      return;
    }

    void fetch(`/api/sessions/messages?channel=webchat&channelKey=${encodeURIComponent(sid)}`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await response.json() as { success: boolean; data?: Array<{ id: string; role: string; content: string; createdAt: string }>; error?: string };
        if (!response.ok || !body.success) {
          throw new Error(body.error ?? `Failed to load chat history (${response.status})`);
        }
        const loaded: ChatMessage[] = (body.data ?? []).map(m => ({
          id: m.id,
          role: m.role === 'user' ? 'user' : 'agent',
          content: m.content,
          timestamp: m.createdAt,
        }));
        setMessages(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load chat history';
        setError(message);
      });
  }, [configError]);

  // WebSocket connection with reconnect
  useEffect(() => {
    if (!sessionId || configError || !runtimeConfig) return;

    const socket = io(runtimeConfig.wsUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: RECONNECT_BASE_MS,
      reconnectionDelayMax: RECONNECT_MAX_MS,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setWsStatus('connected');
      reconnectDelayRef.current = RECONNECT_BASE_MS;
      socket.emit('subscribe:all');
    });

    socket.on('disconnect', () => {
      setWsStatus('disconnected');
    });

    socket.io.on('reconnect_attempt', () => {
      setWsStatus('reconnecting');
    });

    socket.io.on('reconnect', () => {
      setWsStatus('connected');
      socket.emit('subscribe:all');
    });

    socket.on('event', (payload: { type: string; data: Record<string, unknown> }) => {
      if (payload?.type === 'session:updated') {
        const { sessionId: evtSession, message, role } = payload.data as {
          sessionId?: string;
          message?: string;
          role?: string;
          channel?: string;
        };

        if (evtSession !== sessionId || !message) return;
        if (role !== 'agent') return;

        appendMessage({
          id: `ws-${Date.now()}-${Math.random()}`,
          role: 'agent',
          content: message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, appendMessage, configError, runtimeConfig]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !sessionId) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    appendMessage(userMsg);
    setError(null);
    setInput('');
    setSending(true);

    try {
      const response = await fetch('/api/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            type: 'message',
            channel: 'webchat',
            channelKey: sessionId,
            sender: 'dashboard-chat',
            content: text,
            deliveryTarget: {
              channel: 'webchat',
              channelKey: sessionId,
              metadata: {},
            },
          },
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed with status ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      removeMessage(userMsg.id);
      setInput(text);
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [input, sending, sessionId, appendMessage, removeMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {configError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300 font-mono">
          {configError}
        </div>
      )}
      {error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300 font-mono">
          {error}
        </div>
      )}
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">OpenClaw Chat</h1>
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">webchat</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <StatusDot status={wsStatus} />
            {wsStatus === 'disconnected' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                onClick={() => socketRef.current?.connect()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            )}
            {wsStatus === 'connected'
              ? <Wifi className="w-4 h-4 text-emerald-400" />
              : <WifiOff className="w-4 h-4 text-red-400" />}
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-3xl flex flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-zinc-600 py-20">
            <Bot className="w-10 h-10" />
            <p className="text-sm">Send a message to start chatting with the agent.</p>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-br-sm'
                  : 'bg-zinc-800 text-zinc-200 rounded-bl-sm border border-border/30'
              }`}
            >
              {msg.content}
              <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-emerald-200/70' : 'text-zinc-600'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 border border-border/30 rounded-2xl rounded-bl-sm px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Input */}
      <div className="border-t border-border/50 bg-card/80 backdrop-blur-xl sticky bottom-0">
        <div className="container mx-auto px-4 py-3 max-w-3xl">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 resize-none rounded-xl bg-zinc-900/80 border border-border/40 px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-colors min-h-[44px] max-h-32"
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <Button
              onClick={() => void handleSend()}
              disabled={!input.trim() || sending}
              className="bg-emerald-600 hover:bg-emerald-700 h-11 w-11 p-0 rounded-xl shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-zinc-700 mt-2 font-mono">
            session: {sessionId || '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
