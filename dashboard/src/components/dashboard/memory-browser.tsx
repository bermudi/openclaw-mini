'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brain, ChevronRight, Clock, Tag, Database } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { useState, useEffect, useCallback } from 'react';
import { runtimeJson } from '@/lib/dashboard-runtime-client';

interface Agent {
  id: string;
  name: string;
}

interface Memory {
  id: string;
  agentId: string;
  key: string;
  value: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

interface MemoryBrowserProps {
  selectedAgent: Agent | null;
}

const categoryColors: Record<string, string> = {
  general: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  preferences: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  history: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  context: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
};

function HistoryTimeline({ value }: { value: string }) {
  // Try to parse history entries - they may be JSON array or newline-separated
  let entries: string[] = [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      entries = parsed.map((e: unknown) =>
        typeof e === 'string' ? e : JSON.stringify(e, null, 2)
      );
    }
  } catch {
    entries = value.split('\n').filter(Boolean);
  }

  if (entries.length === 0) {
    return <p className="text-sm text-zinc-400 font-mono whitespace-pre-wrap">{value}</p>;
  }

  return (
    <div className="space-y-2 pl-3 border-l border-zinc-700/50">
      {entries.map((entry, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -5 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="relative"
        >
          <div className="absolute -left-[13px] top-1.5 w-2 h-2 rounded-full bg-sky-500/50 border border-sky-400/50" />
          <p className="text-xs text-zinc-400 font-mono pl-2 leading-relaxed">{entry}</p>
        </motion.div>
      ))}
    </div>
  );
}

export function MemoryBrowser({ selectedAgent }: MemoryBrowserProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMemories = useCallback(async () => {
    if (!selectedAgent) return;
    setLoading(true);
    try {
      const data = await runtimeJson<{ success: boolean; data?: Memory[] }>(
        `/api/agents/${selectedAgent.id}/memory`,
      );
      if (data.success) setMemories(data.data ?? []);
    } catch (err) {
      console.error('Failed to fetch memories:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAgent]);

  useEffect(() => {
    fetchMemories();
    setExpandedId(null);
  }, [fetchMemories]);

  if (!selectedAgent) {
    return (
      <Card className="border-dashed border-border/50 bg-card/30">
        <CardContent className="py-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
            <Brain className="w-8 h-8 text-violet-400" />
          </div>
          <h3 className="text-lg font-medium mb-2">Select an agent to browse memories</h3>
          <p className="text-muted-foreground">
            Choose an agent from the Agents tab to inspect their memory.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group by category
  const grouped = memories.reduce<Record<string, Memory[]>>((acc, mem) => {
    const cat = mem.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(mem);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Memory</h2>
          <Badge variant="outline" className="border-zinc-700 text-zinc-400 font-mono text-xs">
            {selectedAgent.name}
          </Badge>
        </div>
        <span className="text-sm text-zinc-500 font-mono">{memories.length} entries</span>
      </div>

      {loading ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="py-12 text-center text-zinc-500">Loading...</CardContent>
        </Card>
      ) : memories.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-card/30">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Database className="w-8 h-8 text-zinc-500" />
            </div>
            <h3 className="text-lg font-medium mb-2">No memories yet</h3>
            <p className="text-muted-foreground">
              Memories will appear here as the agent learns and stores context.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, mems]) => (
            <Card key={category} className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
              <div className="p-3 border-b border-border/30 flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-zinc-500" />
                <h3 className="text-sm font-medium capitalize">{category}</h3>
                <Badge variant="outline" className={`text-[10px] ${categoryColors[category] || categoryColors.general}`}>
                  {mems.length}
                </Badge>
              </div>
              <ScrollArea className={mems.length > 5 ? 'h-[400px]' : ''}>
                <div className="divide-y divide-border/30">
                  {mems.map((mem) => {
                    const isExpanded = expandedId === mem.id;
                    return (
                      <motion.div
                        key={mem.id}
                        className="p-3 hover:bg-white/[0.02] transition-colors cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : mem.id)}
                      >
                        <div className="flex items-start gap-2">
                          <ChevronRight className={`w-4 h-4 text-zinc-500 mt-0.5 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-medium text-sm font-mono">{mem.key}</span>
                            </div>
                            {!isExpanded && (
                              <p className="text-xs text-zinc-500 line-clamp-1 font-mono">
                                {mem.value.substring(0, 100)}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <Clock className="w-3 h-3 text-zinc-600" />
                              <span className="text-[10px] text-zinc-600">
                                {formatDistanceToNow(new Date(mem.updatedAt), { addSuffix: true })}
                              </span>
                            </div>

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden mt-3"
                                >
                                  {category === 'history' ? (
                                    <HistoryTimeline value={mem.value} />
                                  ) : (
                                    <pre className="text-xs text-zinc-400 bg-zinc-900/50 p-3 rounded-lg overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap">
                                      {mem.value}
                                    </pre>
                                  )}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
