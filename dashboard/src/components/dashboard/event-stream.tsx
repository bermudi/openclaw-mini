'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Radio } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';

interface WSEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface EventStreamProps {
  wsEvents: WSEvent[];
  wsConnected: boolean;
}

const eventColors: Record<string, string> = {
  'task:created': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  'task:started': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'task:completed': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'task:failed': 'bg-red-500/20 text-red-400 border-red-500/30',
  'agent:status': 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  'trigger:fired': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'memory:updated': 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  'tool:called': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  'session:updated': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'stats:update': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

export function EventStream({ wsEvents, wsConnected }: EventStreamProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Live Events</h2>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse shadow-emerald-400/50 shadow-sm' : 'bg-red-500'}`} />
          <span className="text-xs text-zinc-500 font-mono">
            {wsConnected ? 'streaming' : 'disconnected'}
          </span>
        </div>
      </div>

      {wsEvents.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-card/30">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <Radio className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-lg font-medium mb-2">No events yet</h3>
            <p className="text-muted-foreground">
              Real-time events will appear here as they occur.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
          <ScrollArea className="h-[600px]">
            <div className="divide-y divide-border/30">
              <AnimatePresence initial={false}>
                {wsEvents.map((event, index) => (
                  <motion.div
                    key={`${event.type}-${event.timestamp}-${index}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.2 }}
                    className="p-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className={`text-[10px] font-mono ${eventColors[event.type] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'}`}>
                            {event.type}
                          </Badge>
                          <span className="text-[10px] text-zinc-600 font-mono">
                            {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                          </span>
                        </div>
                        <pre className="text-xs text-zinc-400 bg-zinc-900/50 p-3 rounded-lg overflow-x-auto font-mono leading-relaxed">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
