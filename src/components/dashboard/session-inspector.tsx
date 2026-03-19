'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, User, Bot, Settings, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow, format, differenceInDays } from 'date-fns';
import { useState, useEffect, useCallback } from 'react';

interface Agent {
  id: string;
  name: string;
}

interface SessionSummary {
  id: string;
  channel: string;
  channelKey: string;
  lastActive: string;
  messageCount: number;
}

interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  sender?: string;
  channel?: string;
  channelKey?: string;
  timestamp: string;
}

interface SessionDetail {
  id: string;
  context: {
    messages: SessionMessage[];
    metadata: Record<string, unknown>;
  };
}

interface SessionInspectorProps {
  selectedAgent: Agent | null;
}

const channelColors: Record<string, string> = {
  slack: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  discord: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  whatsapp: 'bg-green-500/20 text-green-400 border-green-500/30',
  telegram: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  imessage: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  webhook: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  internal: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const days = differenceInDays(new Date(), date);
  if (days < 1) return formatDistanceToNow(date, { addSuffix: true });
  return format(date, 'MMM d, h:mm a');
}

function MessageBubble({ message }: { message: SessionMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}
    >
      <div className={`max-w-[80%] ${isSystem ? 'w-full' : ''}`}>
        {isSystem ? (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-2 text-center">
            <p className="text-xs text-zinc-500 font-mono">{message.content}</p>
          </div>
        ) : (
          <div className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? 'bg-emerald-600/20 border border-emerald-500/20 rounded-br-md'
              : 'bg-zinc-800/80 border border-zinc-700/50 rounded-bl-md'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center ${isUser ? 'bg-emerald-500/30' : 'bg-zinc-700'}`}>
                {isUser ? <User className="w-2.5 h-2.5 text-emerald-400" /> : <Bot className="w-2.5 h-2.5 text-zinc-400" />}
              </div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                {message.role}
              </span>
              {message.channel && (
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${channelColors[message.channel] || channelColors.internal}`}>
                  {message.channel}
                  {message.channelKey && `:${message.channelKey}`}
                </Badge>
              )}
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
            <p className="text-[10px] text-zinc-600 mt-1">{formatTimestamp(message.timestamp)}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function SessionInspector({ selectedAgent }: SessionInspectorProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (!selectedAgent) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions?agentId=${selectedAgent.id}`);
      const data = await res.json();
      if (data.success) setSessions(data.data || []);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAgent]);

  const fetchSessionDetail = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions?sessionId=${sessionId}`);
      const data = await res.json();
      if (data.success && data.data) setSelectedSession(data.data);
    } catch (err) {
      console.error('Failed to fetch session detail:', err);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    setSelectedSession(null);
  }, [fetchSessions]);

  if (!selectedAgent) {
    return (
      <Card className="border-dashed border-border/50 bg-card/30">
        <CardContent className="py-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-sky-500/10 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-8 h-8 text-sky-400" />
          </div>
          <h3 className="text-lg font-medium mb-2">Select an agent to view sessions</h3>
          <p className="text-muted-foreground">
            Choose an agent from the Agents tab to inspect their conversations.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4 h-[650px]">
      {/* Session List */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <div className="p-3 border-b border-border/30">
          <h3 className="text-sm font-medium text-zinc-400">Sessions for {selectedAgent.name}</h3>
        </div>
        <ScrollArea className="h-[calc(100%-45px)]">
          {loading ? (
            <div className="p-4 text-center text-zinc-500 text-sm">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-center text-zinc-500 text-sm">No sessions yet</div>
          ) : (
            <div className="divide-y divide-border/30">
              {sessions.map((session) => (
                <motion.div
                  key={session.id}
                  className={`p-3 cursor-pointer transition-colors hover:bg-white/[0.02] ${
                    selectedSession?.id === session.id ? 'bg-emerald-500/5 border-l-2 border-l-emerald-500' : ''
                  }`}
                  onClick={() => fetchSessionDetail(session.id)}
                  whileHover={{ x: 2 }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${channelColors[session.channel] || channelColors.internal}`}>
                      {session.channel}
                    </Badge>
                    <span className="text-xs text-zinc-500 font-mono truncate">{session.channelKey}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      {session.messageCount} messages
                    </span>
                    <span>{formatTimestamp(session.lastActive)}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>

      {/* Conversation Thread */}
      <Card className="col-span-2 bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <div className="p-3 border-b border-border/30 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400">
            {selectedSession ? 'Conversation Thread' : 'Select a session'}
          </h3>
          {selectedSession && (
            <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-500">
              {selectedSession.context.messages.length} messages
            </Badge>
          )}
        </div>
        <ScrollArea className="h-[calc(100%-45px)]">
          {!selectedSession ? (
            <div className="flex items-center justify-center h-full p-8 text-zinc-500 text-sm">
              <div className="text-center">
                <Settings className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>Click a session to view the conversation</p>
              </div>
            </div>
          ) : selectedSession.context.messages.length === 0 ? (
            <div className="flex items-center justify-center h-full p-8 text-zinc-500 text-sm">
              <p>No messages in this session</p>
            </div>
          ) : (
            <div className="p-4">
              <AnimatePresence>
                {selectedSession.context.messages.map((msg, i) => (
                  <MessageBubble key={`${i}-${msg.timestamp}`} message={msg} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}
