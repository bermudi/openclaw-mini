'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Trash2, Heart, Calendar, Webhook, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

interface Agent {
  id: string;
  name: string;
}

interface Trigger {
  id: string;
  agentId: string;
  name: string;
  type: 'heartbeat' | 'cron' | 'webhook' | 'hook';
  config: {
    interval?: number;
    cronExpression?: string;
    endpoint?: string;
    event?: string;
  };
  enabled: boolean;
  lastTriggered?: string;
  nextTrigger?: string;
  createdAt: string;
}

interface TriggerPanelProps {
  triggers: Trigger[];
  agents: Agent[];
  selectedAgent: Agent | null;
  onCreateTrigger: (agentId: string, name: string, type: string, config: Record<string, unknown>) => void;
  onDeleteTrigger: (triggerId: string) => void;
  onToggleTrigger: (trigger: Trigger) => void;
}

const triggerIcons: Record<string, React.ReactNode> = {
  heartbeat: <Heart className="w-5 h-5 text-rose-400" />,
  cron: <Calendar className="w-5 h-5 text-violet-400" />,
  webhook: <Webhook className="w-5 h-5 text-amber-400" />,
  hook: <Zap className="w-5 h-5 text-emerald-400" />,
};

const triggerColors: Record<string, string> = {
  heartbeat: 'from-rose-500/20 to-rose-600/10 border-rose-500/20',
  cron: 'from-violet-500/20 to-violet-600/10 border-violet-500/20',
  webhook: 'from-amber-500/20 to-amber-600/10 border-amber-500/20',
  hook: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/20',
};

export function TriggerPanel({
  triggers,
  agents,
  selectedAgent,
  onCreateTrigger,
  onDeleteTrigger,
  onToggleTrigger,
}: TriggerPanelProps) {
  const [createTriggerOpen, setCreateTriggerOpen] = useState(false);
  const [triggerAgentId, setTriggerAgentId] = useState(selectedAgent?.id || '');
  const [newTriggerName, setNewTriggerName] = useState('');
  const [newTriggerType, setNewTriggerType] = useState<'heartbeat' | 'cron' | 'webhook' | 'hook'>('heartbeat');
  const [newTriggerInterval, setNewTriggerInterval] = useState('30');
  const [newTriggerCron, setNewTriggerCron] = useState('0 9 * * *');
  const [newTriggerSecret, setNewTriggerSecret] = useState('');

  const handleCreate = () => {
    if (!triggerAgentId || !newTriggerName.trim()) return;
    const config: Record<string, unknown> = {};
    if (newTriggerType === 'heartbeat') config.interval = parseInt(newTriggerInterval);
    else if (newTriggerType === 'cron') config.cronExpression = newTriggerCron;
    else if (newTriggerType === 'webhook') config.secret = newTriggerSecret;

    onCreateTrigger(triggerAgentId, newTriggerName, newTriggerType, config);
    setNewTriggerName('');
    setNewTriggerInterval('30');
    setNewTriggerCron('0 9 * * *');
    setNewTriggerSecret('');
    setCreateTriggerOpen(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Triggers</h2>
        <Dialog open={createTriggerOpen} onOpenChange={setCreateTriggerOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={agents.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20">
              <Plus className="w-4 h-4 mr-2" />
              Create Trigger
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50">
            <DialogHeader>
              <DialogTitle>Create New Trigger</DialogTitle>
              <DialogDescription>Create a trigger to automatically invoke agents.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Agent</Label>
                <Select value={triggerAgentId} onValueChange={setTriggerAgentId}>
                  <SelectTrigger className="bg-background/50 border-border/50">
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="trigger-name">Trigger Name</Label>
                <Input
                  id="trigger-name"
                  value={newTriggerName}
                  onChange={(e) => setNewTriggerName(e.target.value)}
                  placeholder="e.g., Daily Report"
                  className="bg-background/50 border-border/50"
                />
              </div>
              <div className="grid gap-2">
                <Label>Trigger Type</Label>
                <Select value={newTriggerType} onValueChange={(val) => setNewTriggerType(val as typeof newTriggerType)}>
                  <SelectTrigger className="bg-background/50 border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="heartbeat">
                      <div className="flex items-center gap-2"><Heart className="w-4 h-4" /> Heartbeat</div>
                    </SelectItem>
                    <SelectItem value="cron">
                      <div className="flex items-center gap-2"><Calendar className="w-4 h-4" /> Cron</div>
                    </SelectItem>
                    <SelectItem value="webhook">
                      <div className="flex items-center gap-2"><Webhook className="w-4 h-4" /> Webhook</div>
                    </SelectItem>
                    <SelectItem value="hook">
                      <div className="flex items-center gap-2"><Zap className="w-4 h-4" /> Internal Hook</div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newTriggerType === 'heartbeat' && (
                <div className="grid gap-2">
                  <Label htmlFor="interval">Interval (minutes)</Label>
                  <Input id="interval" type="number" value={newTriggerInterval} onChange={(e) => setNewTriggerInterval(e.target.value)} className="bg-background/50 border-border/50" />
                </div>
              )}
              {newTriggerType === 'cron' && (
                <div className="grid gap-2">
                  <Label htmlFor="cron">Cron Expression</Label>
                  <Input id="cron" value={newTriggerCron} onChange={(e) => setNewTriggerCron(e.target.value)} className="bg-background/50 border-border/50 font-mono" />
                  <p className="text-xs text-muted-foreground">Example: &quot;0 9 * * *&quot; = Every day at 9 AM</p>
                </div>
              )}
              {newTriggerType === 'webhook' && (
                <div className="grid gap-2">
                  <Label htmlFor="secret">Webhook Secret (optional)</Label>
                  <Input id="secret" type="password" value={newTriggerSecret} onChange={(e) => setNewTriggerSecret(e.target.value)} className="bg-background/50 border-border/50" />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateTriggerOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!triggerAgentId || !newTriggerName.trim()} className="bg-emerald-600 hover:bg-emerald-700">Create Trigger</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {triggers.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-card/30">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <Zap className="w-8 h-8 text-amber-400" />
            </div>
            <h3 className="text-lg font-medium mb-2">No triggers configured</h3>
            <p className="text-muted-foreground mb-4">Create triggers to enable proactive agent behavior.</p>
            <Button onClick={() => setCreateTriggerOpen(true)} disabled={agents.length === 0} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-2" /> Create Trigger
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          <AnimatePresence>
            {triggers.map((trigger) => {
              const agent = agents.find((a) => a.id === trigger.agentId);
              return (
                <motion.div
                  key={trigger.id}
                  layout
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                >
                  <Card className={`bg-gradient-to-r ${triggerColors[trigger.type] || ''} border-border/50 overflow-hidden`}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-zinc-900/50 flex items-center justify-center">
                            {triggerIcons[trigger.type]}
                          </div>
                          <div>
                            <h3 className="font-medium">{trigger.name}</h3>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>{agent?.name}</span>
                              <span className="text-zinc-600">·</span>
                              <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                                {trigger.type}
                              </Badge>
                              {trigger.type === 'heartbeat' && trigger.config.interval && (
                                <span className="text-xs font-mono">every {trigger.config.interval}m</span>
                              )}
                              {trigger.type === 'cron' && trigger.config.cronExpression && (
                                <span className="text-xs font-mono">{trigger.config.cronExpression}</span>
                              )}
                            </div>
                            {trigger.lastTriggered && (
                              <p className="text-xs text-zinc-500 mt-0.5">
                                Last fired {formatDistanceToNow(new Date(trigger.lastTriggered), { addSuffix: true })}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {trigger.nextTrigger && (
                            <div className="text-xs text-zinc-500 font-mono">
                              Next: {formatDistanceToNow(new Date(trigger.nextTrigger), { addSuffix: true })}
                            </div>
                          )}
                          <Switch
                            checked={trigger.enabled}
                            onCheckedChange={() => onToggleTrigger(trigger)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hover:bg-red-500/10 hover:text-red-400"
                            onClick={() => onDeleteTrigger(trigger.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
