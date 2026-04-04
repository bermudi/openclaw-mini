'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { StatusBadge, TaskTypeIcon } from './status-badges';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

interface Agent {
  id: string;
  name: string;
}

interface Task {
  id: string;
  agentId: string;
  type: string;
  priority: number;
  status: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  source?: string;
  parentTaskId?: string | null;
  skillName?: string | null;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface Stats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

interface TaskListProps {
  tasks: Task[];
  stats: Stats;
  agents: Agent[];
  onExecuteTask: (taskId: string) => void;
}

function TaskRow({ task, agent, onExecute }: { task: Task; agent?: Agent; onExecute: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="group"
    >
      <div
        className="p-4 hover:bg-white/[0.02] transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-1 p-1.5 rounded-lg bg-zinc-800/80">
              <TaskTypeIcon type={task.type} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium capitalize text-sm">{task.type}</span>
                <StatusBadge status={task.status} />
                <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                  P{task.priority}
                </Badge>
                {task.skillName && (
                  <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-400">
                    {task.skillName}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-1">
                {task.source || `Agent: ${agent?.name || 'Unknown'}`}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
              </p>
              {task.error && (
                <p className="text-xs text-red-400 mt-1 font-mono">{task.error}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task.status === 'pending' && (
              <Button
                variant="outline"
                size="sm"
                className="bg-transparent border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                onClick={(e) => { e.stopPropagation(); onExecute(task.id); }}
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                Execute
              </Button>
            )}
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-zinc-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pl-14 space-y-2">
              {typeof task.result?.response === 'string' && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Response</p>
                  <p className="text-xs text-zinc-300 bg-zinc-900/50 rounded-lg p-3 font-mono leading-relaxed">
                    {task.result.response}
                  </p>
                </div>
              )}
              {Array.isArray(task.result?.toolCalls) && (task.result.toolCalls as Array<{ tool: string }>).length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Tool Calls</p>
                  <div className="flex flex-wrap gap-1">
                    {(task.result.toolCalls as Array<{ tool: string }>).map((t, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] border-violet-500/30 text-violet-400">
                        {t.tool}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Payload</p>
                <pre className="text-xs text-zinc-400 bg-zinc-900/50 rounded-lg p-3 overflow-x-auto font-mono">
                  {JSON.stringify(task.payload, null, 2)}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function TaskList({ tasks, stats, agents, onExecuteTask }: TaskListProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Task Queue</h2>
        <span className="text-sm text-zinc-500 font-mono">{stats.total} total</span>
      </div>

      {tasks.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-card/30">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-sky-500/10 flex items-center justify-center mx-auto mb-4">
              <Activity className="w-8 h-8 text-sky-400" />
            </div>
            <h3 className="text-lg font-medium mb-2">No tasks in queue</h3>
            <p className="text-muted-foreground">
              Tasks will appear here when agents receive inputs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
          <ScrollArea className="h-[600px]">
            <div className="divide-y divide-border/30">
              {tasks.map((task) => {
                const agent = agents.find((a) => a.id === task.agentId);
                return (
                  <TaskRow
                    key={task.id}
                    task={task}
                    agent={agent}
                    onExecute={onExecuteTask}
                  />
                );
              })}
            </div>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
