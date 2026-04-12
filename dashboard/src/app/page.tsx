'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
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
} from '@/components/ui/dialog';
import {
  Bot,
  Play,
  Clock,
  Zap,
  MessageSquare,
  RefreshCw,
  Activity,
  Send,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Shield,
  Wrench,
  Radio,
  Terminal,
  Brain,
} from 'lucide-react';

import { AgentList } from '@/components/dashboard/agent-card';
import { TaskList } from '@/components/dashboard/task-list';
import { TriggerPanel } from '@/components/dashboard/trigger-panel';
import { AuditLog } from '@/components/dashboard/audit-log';
import { EventStream } from '@/components/dashboard/event-stream';
import { SessionInspector } from '@/components/dashboard/session-inspector';
import { WorkspaceEditor } from '@/components/dashboard/workspace-editor';
import { MemoryBrowser } from '@/components/dashboard/memory-browser';
import { useOpenClawEvents, ConnectionStatus } from '@/hooks/use-openclaw-events';
import { useToast } from '@/hooks/use-toast';
import { getDashboardRuntimeConfigError, runtimeJson } from '@/lib/dashboard-runtime-client';

// Types
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

interface Task {
  id: string;
  agentId: string;
  type: 'message' | 'heartbeat' | 'cron' | 'webhook' | 'hook' | 'a2a' | 'subagent';
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
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

interface Stats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

const emptyStats: Stats = {
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
  total: 0,
};

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  severity: string;
  createdAt: string;
}

interface Tool {
  name: string;
  description: string;
  parameters: Array<{ name: string; type: string; description: string; required: boolean }>;
  riskLevel: string;
}

interface WSEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const config = {
    connected: { color: 'bg-emerald-400 shadow-emerald-400/50 shadow-sm', label: 'connected', animate: '' },
    disconnected: { color: 'bg-red-500', label: 'disconnected', animate: '' },
    reconnecting: { color: 'bg-amber-400 shadow-amber-400/50 shadow-sm', label: 'reconnecting', animate: 'animate-pulse' },
  };
  const c = config[status];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${c.color} ${c.animate}`} />
      <span className="text-xs text-zinc-500 font-mono">{c.label}</span>
    </div>
  );
}

export default function OpenClawDashboard() {
  const configError = getDashboardRuntimeConfigError();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [activeTab, setActiveTab] = useState('agents');
  const [wsEvents, setWsEvents] = useState<WSEvent[]>([]);

  // Dialog states
  const [sendMessageOpen, setSendMessageOpen] = useState(false);
  const [testToolOpen, setTestToolOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  // Form states
  const [messageContent, setMessageContent] = useState('');
  const [messageChannel, setMessageChannel] = useState('slack');
  const [toolParams, setToolParams] = useState('{}');
  const [toolResult, setToolResult] = useState<string | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (configError) {
      setLoading(false);
      return;
    }

    try {
      const [agentsData, tasksData, triggersData, auditData, toolsData] = await Promise.allSettled([
        runtimeJson<{ success: boolean; data?: Agent[] }>('/api/agents'),
        runtimeJson<{ success: boolean; data?: Task[]; stats?: Stats }>('/api/tasks'),
        runtimeJson<{ success: boolean; data?: Trigger[] }>('/api/triggers'),
        runtimeJson<{ success: boolean; data?: AuditLogEntry[] }>('/api/audit?limit=50'),
        runtimeJson<{ success: boolean; data?: Tool[] }>('/api/tools'),
      ]);

      if (agentsData.status === 'fulfilled' && agentsData.value.success) {
        setAgents(agentsData.value.data ?? []);
      }
      if (tasksData.status === 'fulfilled' && tasksData.value.success) {
        setTasks(tasksData.value.data ?? []);
        setStats(tasksData.value.stats ?? emptyStats);
      }
      if (triggersData.status === 'fulfilled' && triggersData.value.success) {
        setTriggers(triggersData.value.data ?? []);
      }
      if (auditData.status === 'fulfilled' && auditData.value.success) {
        setAuditLogs(auditData.value.data ?? []);
      }
      if (toolsData.status === 'fulfilled' && toolsData.value.success) {
        setTools(toolsData.value.data ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [configError]);

  // Real-time WebSocket events via socket.io
  const { connected: wsConnected, connectionStatus } = useOpenClawEvents({
    onTaskCreated: (data) => {
      setTasks(prev => [data as unknown as Task, ...prev]);
      setStats(prev => ({ ...prev, pending: prev.pending + 1, total: prev.total + 1 }));
      setWsEvents(prev => [{ type: 'task:created', data, timestamp: new Date().toISOString() }, ...prev].slice(0, 100));
    },
    onTaskStarted: (data) => {
      const taskId = data.taskId as string;
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'processing' as const } : t));
      setStats(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), processing: prev.processing + 1 }));
      setWsEvents(prev => [{ type: 'task:started', data, timestamp: new Date().toISOString() }, ...prev].slice(0, 100));
    },
    onTaskCompleted: (data) => {
      const taskId = data.taskId as string;
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed' as const, result: data.result as Record<string, unknown> } : t));
      setStats(prev => ({ ...prev, processing: Math.max(0, prev.processing - 1), completed: prev.completed + 1 }));
      setWsEvents(prev => [{ type: 'task:completed', data, timestamp: new Date().toISOString() }, ...prev].slice(0, 100));
    },
    onTaskFailed: (data) => {
      const taskId = data.taskId as string;
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'failed' as const, error: data.error as string } : t));
      setStats(prev => ({ ...prev, processing: Math.max(0, prev.processing - 1), failed: prev.failed + 1 }));
      setWsEvents(prev => [{ type: 'task:failed', data, timestamp: new Date().toISOString() }, ...prev].slice(0, 100));
    },
    onAgentStatus: (data) => {
      const agentId = data.agentId as string;
      const status = data.status as Agent['status'];
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status } : a));
      setWsEvents(prev => [{ type: 'agent:status', data, timestamp: new Date().toISOString() }, ...prev].slice(0, 100));
    },
    onTriggerFired: (data) => {
      const triggerId = data.triggerId as string;
      setTriggers(prev => prev.map(t => t.id === triggerId ? { ...t, lastTriggered: new Date().toISOString() } : t));
      setWsEvents(prev => [{ type: 'trigger:fired', data, timestamp: new Date().toISOString() }, ...prev].slice(0, 100));
    },
    onStatsUpdate: (data) => {
      setStats(data as unknown as Stats);
      setWsEvents(prev => [{ type: 'stats:update', data, timestamp: new Date().toISOString() }, ...prev].slice(0, 100));
    },
    onReconnect: () => {
      fetchData();
    },
  });

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Action handlers
  const handleCreateAgent = async (name: string, description: string, skills: string): Promise<boolean> => {
    try {
      const res = await runtimeJson<{ success: boolean; data?: Agent; error?: string }>('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          skills: skills.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      if (!res.success || !res.data) {
        toast({
          title: 'Create failed',
          description: res.error || 'Agent creation did not return an agent',
          variant: 'destructive',
        });
        return false;
      }

      const createdAgent = res.data;

      setAgents((prev) => {
        const nextAgents = prev.filter((agent) => agent.id !== createdAgent.id);
        return [createdAgent, ...nextAgents];
      });
      toast({
        title: 'Agent created',
        description: `${createdAgent.name} is now available in Agents.`,
      });
      void fetchData();
      return true;
    } catch (error) {
      console.error('Failed to create agent:', error);
      toast({
        title: 'Create failed',
        description: error instanceof Error ? error.message : 'Network error',
        variant: 'destructive',
      });
      return false;
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm('Are you sure you want to delete this agent?')) return;
    try {
      await runtimeJson(`/api/agents/${agentId}`, { method: 'DELETE' });
      if (selectedAgent?.id === agentId) setSelectedAgent(null);
      fetchData();
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  };

  const handleToggleAgent = async (agent: Agent) => {
    const newStatus = agent.status === 'disabled' ? 'idle' : 'disabled';
    try {
      await runtimeJson(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchData();
    } catch (error) {
      console.error('Failed to toggle agent:', error);
    }
  };

  const handleCreateTrigger = async (agentId: string, name: string, type: string, config: Record<string, unknown>) => {
    try {
      const res = await runtimeJson<{ success: boolean }>('/api/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, name, type, config }),
      });
      if (res.success) fetchData();
    } catch (error) {
      console.error('Failed to create trigger:', error);
    }
  };

  const handleDeleteTrigger = async (triggerId: string) => {
    try {
      await runtimeJson(`/api/triggers/${triggerId}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error('Failed to delete trigger:', error);
    }
  };

  const handleToggleTrigger = async (trigger: Trigger) => {
    try {
      await runtimeJson(`/api/triggers/${trigger.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !trigger.enabled }),
      });
      fetchData();
    } catch (error) {
      console.error('Failed to toggle trigger:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedAgent || !messageContent.trim()) return;
    try {
      const res = await runtimeJson<{ success: boolean }>('/api/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          input: {
            type: 'message',
            channel: messageChannel,
            channelKey: `test-channel-${Date.now()}`,
            content: messageContent,
            sender: 'dashboard-user',
          },
        }),
      });
      if (res.success) {
        setMessageContent('');
        setSendMessageOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleExecuteTask = async (taskId: string) => {
    try {
      await runtimeJson(`/api/tasks/${taskId}/execute`, { method: 'POST' });
      fetchData();
    } catch (error) {
      console.error('Failed to execute task:', error);
    }
  };

  const handleTestTool = async () => {
    if (!selectedTool) return;
    setToolResult(null);
    try {
      let params = {};
      if (toolParams.trim()) params = JSON.parse(toolParams);
      const res = await runtimeJson<unknown>('/api/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: selectedTool.name, params }),
      });
      setToolResult(JSON.stringify(res, null, 2));
    } catch (error) {
      setToolResult(`Error: ${error}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 animate-pulse">
            <Bot className="w-7 h-7 text-white" />
          </div>
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
          {configError && (
            <div className="text-xs text-red-400 font-mono max-w-md text-center">
              Config Error: {configError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {configError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300 font-mono">
          {configError}
        </div>
      )}
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight">OpenClaw</h1>
                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">agent runtime</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <ConnectionIndicator status={connectionStatus} />
              <Separator orientation="vertical" className="h-4 bg-border/30" />
              <Button variant="ghost" size="sm" onClick={fetchData} className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800">
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="border-b border-border/30 bg-card/30">
        <div className="container mx-auto px-4 py-2.5">
          <div className="flex items-center gap-6 text-xs">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-mono font-bold text-amber-400">{stats.pending}</span>
              <span className="text-zinc-500">pending</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-mono font-bold text-sky-400">{stats.processing}</span>
              <span className="text-zinc-500">processing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-mono font-bold text-emerald-400">{stats.completed}</span>
              <span className="text-zinc-500">completed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              <span className="font-mono font-bold text-red-400">{stats.failed}</span>
              <span className="text-zinc-500">failed</span>
            </div>
            <Separator orientation="vertical" className="h-3 bg-border/30" />
            <div className="flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-violet-400" />
              <span className="font-mono font-bold text-violet-400">{tools.length}</span>
              <span className="text-zinc-500">tools</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-teal-400" />
              <span className="font-mono font-bold text-teal-400">{agents.length}</span>
              <span className="text-zinc-500">agents</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 bg-zinc-900/50 border border-border/30 p-1">
            <TabsTrigger value="agents" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-emerald-400 text-xs">
              <Bot className="w-3.5 h-3.5" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="tasks" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-sky-400 text-xs">
              <Activity className="w-3.5 h-3.5" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="triggers" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-amber-400 text-xs">
              <Zap className="w-3.5 h-3.5" />
              Triggers
            </TabsTrigger>
            <TabsTrigger value="sessions" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-pink-400 text-xs">
              <MessageSquare className="w-3.5 h-3.5" />
              Sessions
            </TabsTrigger>
            <TabsTrigger value="workspace" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-400 text-xs">
              <FileText className="w-3.5 h-3.5" />
              Workspace
            </TabsTrigger>
            <TabsTrigger value="memory" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-violet-400 text-xs">
              <Brain className="w-3.5 h-3.5" />
              Memory
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-indigo-400 text-xs">
              <Wrench className="w-3.5 h-3.5" />
              Tools
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-orange-400 text-xs">
              <Shield className="w-3.5 h-3.5" />
              Audit
            </TabsTrigger>
            <TabsTrigger value="events" className="gap-1.5 data-[state=active]:bg-zinc-800 data-[state=active]:text-emerald-400 text-xs">
              <Radio className="w-3.5 h-3.5" />
              Live
            </TabsTrigger>
          </TabsList>

          {/* Agents Tab */}
          <TabsContent value="agents">
            <AgentList
              agents={agents}
              onCreateAgent={handleCreateAgent}
              onDeleteAgent={handleDeleteAgent}
              onToggleAgent={handleToggleAgent}
              onSendMessage={(agent) => { setSelectedAgent(agent); setSendMessageOpen(true); }}
            />
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks">
            <TaskList tasks={tasks} stats={stats} agents={agents} onExecuteTask={handleExecuteTask} />
          </TabsContent>

          {/* Triggers Tab */}
          <TabsContent value="triggers">
            <TriggerPanel
              triggers={triggers}
              agents={agents}
              selectedAgent={selectedAgent}
              onCreateTrigger={handleCreateTrigger}
              onDeleteTrigger={handleDeleteTrigger}
              onToggleTrigger={handleToggleTrigger}
            />
          </TabsContent>

          {/* Sessions Tab */}
          <TabsContent value="sessions">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Sessions</h2>
              {agents.length > 0 && (
                <Select value={selectedAgent?.id || ''} onValueChange={(val) => setSelectedAgent(agents.find(a => a.id === val) || null)}>
                  <SelectTrigger className="w-48 bg-zinc-900/50 border-border/30 text-sm">
                    <SelectValue placeholder="Select agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <SessionInspector selectedAgent={selectedAgent} />
          </TabsContent>

          {/* Workspace Tab */}
          <TabsContent value="workspace">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Workspace</h2>
            </div>
            <WorkspaceEditor />
          </TabsContent>

          {/* Memory Tab */}
          <TabsContent value="memory">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Memory</h2>
              {agents.length > 0 && (
                <Select value={selectedAgent?.id || ''} onValueChange={(val) => setSelectedAgent(agents.find(a => a.id === val) || null)}>
                  <SelectTrigger className="w-48 bg-zinc-900/50 border-border/30 text-sm">
                    <SelectValue placeholder="Select agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <MemoryBrowser selectedAgent={selectedAgent} />
          </TabsContent>

          {/* Tools Tab */}
          <TabsContent value="tools">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Available Tools</h2>
              <span className="text-xs text-zinc-500 font-mono">{tools.length} registered</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tools.map((tool) => (
                <Card key={tool.name} className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-border transition-all">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono text-zinc-200">{tool.name}</CardTitle>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          tool.riskLevel === 'high'
                            ? 'border-red-500/30 text-red-400'
                            : tool.riskLevel === 'medium'
                              ? 'border-amber-500/30 text-amber-400'
                              : 'border-zinc-700 text-zinc-400'
                        }`}
                      >
                        {tool.riskLevel}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">{tool.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-3">
                    {tool.parameters.length > 0 && (
                      <div className="space-y-1 mb-3">
                        {tool.parameters.map((param) => (
                          <div key={param.name} className="text-xs text-zinc-500">
                            <span className="font-mono text-zinc-400">{param.name}</span>
                            {param.required && <span className="text-red-400">*</span>}
                            <span className="ml-1 text-zinc-600">({param.type})</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <Separator className="my-3 bg-border/30" />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-transparent border-border/50 hover:bg-indigo-500/10 hover:border-indigo-500/30 hover:text-indigo-400"
                      onClick={() => {
                        setSelectedTool(tool);
                        setToolParams('{}');
                        setToolResult(null);
                        setTestToolOpen(true);
                      }}
                    >
                      <Terminal className="w-3.5 h-3.5 mr-2" />
                      Test Tool
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Audit Log Tab */}
          <TabsContent value="audit">
            <AuditLog auditLogs={auditLogs} />
          </TabsContent>

          {/* Live Events Tab */}
          <TabsContent value="events">
            <EventStream wsEvents={wsEvents} wsConnected={wsConnected} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Send Message Dialog */}
      <Dialog open={sendMessageOpen} onOpenChange={setSendMessageOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>Send Message to {selectedAgent?.name}</DialogTitle>
            <DialogDescription>Send a test message to this agent.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Channel</Label>
              <Select value={messageChannel} onValueChange={setMessageChannel}>
                <SelectTrigger className="bg-background/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="imessage">iMessage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                placeholder="Type your message..."
                rows={4}
                className="bg-background/50 border-border/50"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendMessageOpen(false)}>Cancel</Button>
            <Button onClick={handleSendMessage} disabled={!messageContent.trim()} className="bg-emerald-600 hover:bg-emerald-700">
              <Send className="w-4 h-4 mr-2" />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Tool Dialog */}
      <Dialog open={testToolOpen} onOpenChange={setTestToolOpen}>
        <DialogContent className="max-w-2xl bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-mono">{selectedTool?.name}</DialogTitle>
            <DialogDescription>{selectedTool?.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Parameters (JSON)</Label>
              <Textarea
                value={toolParams}
                onChange={(e) => setToolParams(e.target.value)}
                placeholder='{"param1": "value1"}'
                rows={4}
                className="font-mono text-sm bg-zinc-900/50 border-border/30"
              />
            </div>
            {toolResult && (
              <div className="grid gap-2">
                <Label>Result</Label>
                <pre className="text-xs bg-zinc-900/50 p-3 rounded-lg overflow-x-auto max-h-64 font-mono text-zinc-400">
                  {toolResult}
                </pre>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestToolOpen(false)}>Close</Button>
            <Button onClick={handleTestTool} className="bg-indigo-600 hover:bg-indigo-700">
              <Play className="w-4 h-4 mr-2" />
              Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
