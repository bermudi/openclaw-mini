'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Bot, Plus, Play, Pause, Trash2, Send } from 'lucide-react';
import { StatusBadge } from './status-badges';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface Agent {
  id: string;
  name: string;
  description?: string;
  status: 'idle' | 'busy' | 'error' | 'disabled';
  skills: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AgentListProps {
  agents: Agent[];
  onCreateAgent: (name: string, description: string, skills: string) => Promise<boolean>;
  onDeleteAgent: (agentId: string) => void;
  onToggleAgent: (agent: Agent) => void;
  onSendMessage: (agent: Agent) => void;
}

function AgentCard({
  agent,
  onDelete,
  onToggle,
  onSendMessage,
}: {
  agent: Agent;
  onDelete: (id: string) => void;
  onToggle: (agent: Agent) => void;
  onSendMessage: (agent: Agent) => void;
}) {
  const statusGlow = agent.status === 'busy'
    ? 'ring-1 ring-emerald-500/30'
    : agent.status === 'error'
      ? 'ring-1 ring-red-500/30'
      : '';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={`overflow-hidden bg-card/50 backdrop-blur-sm border-border/50 hover:border-border transition-all duration-300 ${statusGlow}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                {agent.status === 'busy' && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-card animate-pulse" />
                )}
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">{agent.name}</CardTitle>
                <div className="flex items-center gap-1.5">
                  {agent.isDefault && (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                      Default
                    </Badge>
                  )}
                  <StatusBadge status={agent.status} />
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {agent.description && (
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
              {agent.description}
            </p>
          )}
          {agent.skills.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {agent.skills.map((skill) => (
                <Badge key={skill} variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-300 border-0">
                  {skill}
                </Badge>
              ))}
            </div>
          )}
          <Separator className="my-3 bg-border/50" />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 bg-transparent border-border/50 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400 transition-all"
              onClick={() => onSendMessage(agent)}
              disabled={agent.status === 'disabled'}
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              Message
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent border-border/50 hover:bg-zinc-800"
              onClick={() => onToggle(agent)}
            >
              {agent.status === 'disabled' ? (
                <Play className="w-3.5 h-3.5" />
              ) : (
                <Pause className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent border-border/50 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
              onClick={() => onDelete(agent.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function AgentList({ agents, onCreateAgent, onDeleteAgent, onToggleAgent, onSendMessage }: AgentListProps) {
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDescription, setNewAgentDescription] = useState('');
  const [newAgentSkills, setNewAgentSkills] = useState('');
  const [creatingAgent, setCreatingAgent] = useState(false);

  const handleCreate = async () => {
    if (!newAgentName.trim() || creatingAgent) return;

    setCreatingAgent(true);
    const created = await onCreateAgent(newAgentName, newAgentDescription, newAgentSkills);

    if (created) {
      setNewAgentName('');
      setNewAgentDescription('');
      setNewAgentSkills('');
      setCreateAgentOpen(false);
    }

    setCreatingAgent(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Agents</h2>
        <Dialog open={createAgentOpen} onOpenChange={setCreateAgentOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20">
              <Plus className="w-4 h-4 mr-2" />
              Create Agent
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50">
            <DialogHeader>
              <DialogTitle>Create New Agent</DialogTitle>
              <DialogDescription>
                Create a new AI agent with specific skills and capabilities.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Agent Name</Label>
                <Input
                  id="name"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="e.g., Assistant, Researcher, Writer"
                  className="bg-background/50 border-border/50"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={newAgentDescription}
                  onChange={(e) => setNewAgentDescription(e.target.value)}
                  placeholder="What does this agent do?"
                  rows={3}
                  className="bg-background/50 border-border/50"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="skills">Skills (SKILL.md names)</Label>
                <Input
                  id="skills"
                  value={newAgentSkills}
                  onChange={(e) => setNewAgentSkills(e.target.value)}
                  placeholder="e.g., web-search, pdf-gen"
                  className="bg-background/50 border-border/50"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to allow all enabled skills discovered in /skills.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateAgentOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreate()} disabled={!newAgentName.trim() || creatingAgent} className="bg-emerald-600 hover:bg-emerald-700">
                Create Agent
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {agents.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-card/30">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center mx-auto mb-4">
              <Bot className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-lg font-medium mb-2">No agents yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first AI agent to get started.
            </p>
            <Button onClick={() => setCreateAgentOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-2" />
              Create Agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onDelete={onDeleteAgent}
                onToggle={onToggleAgent}
                onSendMessage={onSendMessage}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
