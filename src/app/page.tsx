'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Bot,
  Plus,
  Play,
  Pause,
  Trash2,
  Clock,
  Zap,
  MessageSquare,
  Webhook,
  Heart,
  Calendar,
  RefreshCw,
  Activity,
  Send,
  Settings,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Shield,
  Wrench,
  Radio,
  Terminal,
} from 'lucide-react';

// Types
interface Agent {
  id: string;
  name: string;
  description?: string;
  status: 'idle' | 'busy' | 'error' | 'disabled';
  skills: string[];
  createdAt: string;
  updatedAt: string;
}

interface Task {
  id: string;
  agentId: string;
  type: 'message' | 'heartbeat' | 'cron' | 'webhook' | 'hook' | 'a2a';
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  source?: string;
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

interface AuditLog {
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

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { color: string; icon: React.ReactNode }> = {
    idle: { color: 'bg-gray-500', icon: <Pause className="w-3 h-3" /> },
    busy: { color: 'bg-blue-500', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    error: { color: 'bg-red-500', icon: <AlertCircle className="w-3 h-3" /> },
    disabled: { color: 'bg-gray-400', icon: <Pause className="w-3 h-3" /> },
    pending: { color: 'bg-yellow-500', icon: <Clock className="w-3 h-3" /> },
    processing: { color: 'bg-blue-500', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { color: 'bg-green-500', icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { color: 'bg-red-500', icon: <AlertCircle className="w-3 h-3" /> },
  };

  const variant = variants[status] || variants.idle;

  return (
    <Badge variant="secondary" className={`${variant.color} text-white gap-1`}>
      {variant.icon}
      <span className="capitalize">{status}</span>
    </Badge>
  );
}

// Severity badge component
function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    info: 'bg-blue-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
    critical: 'bg-red-700',
  };

  return (
    <Badge variant="secondary" className={`${colors[severity] || 'bg-gray-500'} text-white`}>
      {severity}
    </Badge>
  );
}

// Task type icon
function TaskTypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    message: <MessageSquare className="w-4 h-4" />,
    heartbeat: <Heart className="w-4 h-4" />,
    cron: <Calendar className="w-4 h-4" />,
    webhook: <Webhook className="w-4 h-4" />,
    hook: <Zap className="w-4 h-4" />,
    a2a: <Bot className="w-4 h-4" />,
  };

  return <>{icons[type] || <Activity className="w-4 h-4" />}</>;
}

export default function OpenClawDashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, processing: 0, completed: 0, failed: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [activeTab, setActiveTab] = useState('agents');
  const [wsEvents, setWsEvents] = useState<WSEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Dialog states
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [createTriggerOpen, setCreateTriggerOpen] = useState(false);
  const [sendMessageOpen, setSendMessageOpen] = useState(false);
  const [testToolOpen, setTestToolOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  // Form states
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDescription, setNewAgentDescription] = useState('');
  const [newAgentSkills, setNewAgentSkills] = useState('');
  const [newTriggerName, setNewTriggerName] = useState('');
  const [newTriggerType, setNewTriggerType] = useState<'heartbeat' | 'cron' | 'webhook' | 'hook'>('heartbeat');
  const [newTriggerInterval, setNewTriggerInterval] = useState('30');
  const [newTriggerCron, setNewTriggerCron] = useState('0 9 * * *');
  const [newTriggerSecret, setNewTriggerSecret] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [messageChannel, setMessageChannel] = useState('slack');
  const [toolParams, setToolParams] = useState('{}');
  const [toolResult, setToolResult] = useState<string | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, tasksRes, triggersRes, auditRes, toolsRes] = await Promise.all([
        fetch('/api/agents'),
        fetch('/api/tasks'),
        fetch('/api/triggers'),
        fetch('/api/audit?limit=50'),
        fetch('/api/tools'),
      ]);

      const agentsData = await agentsRes.json();
      const tasksData = await tasksRes.json();
      const triggersData = await triggersRes.json();
      const auditData = await auditRes.json();
      const toolsData = await toolsRes.json();

      if (agentsData.success) setAgents(agentsData.data);
      if (tasksData.success) {
        setTasks(tasksData.data);
        setStats(tasksData.stats);
      }
      if (triggersData.success) setTriggers(triggersData.data);
      if (auditData.success) setAuditLogs(auditData.data);
      if (toolsData.success) setTools(toolsData.data);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // WebSocket connection
  useEffect(() => {
    const connectWS = () => {
      try {
        const ws = new WebSocket('ws://localhost:3003/socket.io/?EIO=4&transport=websocket');
        
        ws.onopen = () => {
          setWsConnected(true);
          // Subscribe to all events
          ws.send(JSON.stringify({ type: 'subscribe:all' }));
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type && data.data) {
              setWsEvents(prev => [data, ...prev].slice(0, 100));
              // Refresh data on relevant events
              if (['task:created', 'task:completed', 'task:failed', 'agent:status'].includes(data.type)) {
                fetchData();
              }
            }
          } catch {
            // Ignore parse errors
          }
        };
        
        ws.onclose = () => {
          setWsConnected(false);
          // Reconnect after 5 seconds
          setTimeout(connectWS, 5000);
        };
        
        ws.onerror = () => {
          setWsConnected(false);
        };
        
        wsRef.current = ws;
      } catch {
        setWsConnected(false);
      }
    };

    connectWS();

    return () => {
      wsRef.current?.close();
    };
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Create agent
  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) return;

    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAgentName,
          description: newAgentDescription,
          skills: newAgentSkills.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });

      if (res.ok) {
        setNewAgentName('');
        setNewAgentDescription('');
        setNewAgentSkills('');
        setCreateAgentOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
  };

  // Delete agent
  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm('Are you sure you want to delete this agent?')) return;

    try {
      await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  };

  // Toggle agent status
  const handleToggleAgent = async (agent: Agent) => {
    const newStatus = agent.status === 'disabled' ? 'idle' : 'disabled';
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchData();
    } catch (error) {
      console.error('Failed to toggle agent:', error);
    }
  };

  // Create trigger
  const handleCreateTrigger = async () => {
    if (!selectedAgent || !newTriggerName.trim()) return;

    try {
      const config: Record<string, unknown> = {};
      if (newTriggerType === 'heartbeat') {
        config.interval = parseInt(newTriggerInterval);
      } else if (newTriggerType === 'cron') {
        config.cronExpression = newTriggerCron;
      } else if (newTriggerType === 'webhook') {
        config.secret = newTriggerSecret;
      }

      const res = await fetch('/api/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          name: newTriggerName,
          type: newTriggerType,
          config,
        }),
      });

      if (res.ok) {
        setNewTriggerName('');
        setNewTriggerInterval('30');
        setNewTriggerCron('0 9 * * *');
        setNewTriggerSecret('');
        setCreateTriggerOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error('Failed to create trigger:', error);
    }
  };

  // Delete trigger
  const handleDeleteTrigger = async (triggerId: string) => {
    try {
      await fetch(`/api/triggers/${triggerId}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error('Failed to delete trigger:', error);
    }
  };

  // Toggle trigger
  const handleToggleTrigger = async (trigger: Trigger) => {
    try {
      await fetch(`/api/triggers/${trigger.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !trigger.enabled }),
      });
      fetchData();
    } catch (error) {
      console.error('Failed to toggle trigger:', error);
    }
  };

  // Send message to agent
  const handleSendMessage = async () => {
    if (!selectedAgent || !messageContent.trim()) return;

    try {
      const res = await fetch('/api/input', {
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

      if (res.ok) {
        setMessageContent('');
        setSendMessageOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  // Execute task
  const handleExecuteTask = async (taskId: string) => {
    try {
      await fetch(`/api/tasks/${taskId}/execute`, { method: 'POST' });
      fetchData();
    } catch (error) {
      console.error('Failed to execute task:', error);
    }
  };

  // Test tool
  const handleTestTool = async () => {
    if (!selectedTool) return;
    setToolResult(null);

    try {
      let params = {};
      if (toolParams.trim()) {
        params = JSON.parse(toolParams);
      }

      const res = await fetch('/api/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: selectedTool.name, params }),
      });

      const data = await res.json();
      setToolResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setToolResult(`Error: ${error}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">OpenClaw Agent Runtime</h1>
                <p className="text-sm text-muted-foreground">Event-driven AI agent orchestration</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs text-muted-foreground">
                  {wsConnected ? 'WS Connected' : 'WS Disconnected'}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={fetchData}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-500" />
              <span className="font-medium">{stats.pending}</span>
              <span className="text-muted-foreground">Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-blue-500" />
              <span className="font-medium">{stats.processing}</span>
              <span className="text-muted-foreground">Processing</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="font-medium">{stats.completed}</span>
              <span className="text-muted-foreground">Completed</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="font-medium">{stats.failed}</span>
              <span className="text-muted-foreground">Failed</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-purple-500" />
              <span className="font-medium">{tools.length}</span>
              <span className="text-muted-foreground">Tools</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="agents" className="gap-2">
              <Bot className="w-4 h-4" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="tasks" className="gap-2">
              <Activity className="w-4 h-4" />
              Task Queue
            </TabsTrigger>
            <TabsTrigger value="triggers" className="gap-2">
              <Zap className="w-4 h-4" />
              Triggers
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-2">
              <Wrench className="w-4 h-4" />
              Tools
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-2">
              <Shield className="w-4 h-4" />
              Audit Log
            </TabsTrigger>
            <TabsTrigger value="events" className="gap-2">
              <Radio className="w-4 h-4" />
              Live Events
            </TabsTrigger>
          </TabsList>

          {/* Agents Tab */}
          <TabsContent value="agents">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Agents</h2>
              <Dialog open={createAgentOpen} onOpenChange={setCreateAgentOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Agent
                  </Button>
                </DialogTrigger>
                <DialogContent>
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
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="skills">Skills (comma-separated)</Label>
                      <Input
                        id="skills"
                        value={newAgentSkills}
                        onChange={(e) => setNewAgentSkills(e.target.value)}
                        placeholder="e.g., research, writing, coding"
                      />
                      <p className="text-xs text-muted-foreground">
                        Available skills: research, writing, coding, communication, data, datetime, general
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateAgentOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateAgent} disabled={!newAgentName.trim()}>
                      Create Agent
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {agents.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Bot className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No agents yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Create your first AI agent to get started.
                  </p>
                  <Button onClick={() => setCreateAgentOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Agent
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {agents.map((agent) => (
                  <Card key={agent.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                            <Bot className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <CardTitle className="text-lg">{agent.name}</CardTitle>
                            <StatusBadge status={agent.status} />
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
                            <Badge key={skill} variant="secondary" className="text-xs">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <Separator className="my-3" />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            setSelectedAgent(agent);
                            setSendMessageOpen(true);
                          }}
                          disabled={agent.status === 'disabled'}
                        >
                          <Send className="w-4 h-4 mr-1" />
                          Message
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleAgent(agent)}
                        >
                          {agent.status === 'disabled' ? (
                            <Play className="w-4 h-4" />
                          ) : (
                            <Pause className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteAgent(agent.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Task Queue</h2>
              <div className="text-sm text-muted-foreground">
                {stats.total} total tasks
              </div>
            </div>

            {tasks.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No tasks in queue</h3>
                  <p className="text-muted-foreground">
                    Tasks will appear here when agents receive inputs.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <ScrollArea className="h-[600px]">
                  <div className="divide-y">
                    {tasks.map((task) => {
                      const agent = agents.find((a) => a.id === task.agentId);
                      return (
                        <div key={task.id} className="p-4 hover:bg-muted/50">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5">
                                <TaskTypeIcon type={task.type} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium capitalize">{task.type}</span>
                                  <StatusBadge status={task.status} />
                                  <Badge variant="outline" className="text-xs">
                                    P{task.priority}
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground line-clamp-1">
                                  {task.source || `Agent: ${agent?.name || 'Unknown'}`}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {new Date(task.createdAt).toLocaleString()}
                                </p>
                                {task.error && (
                                  <p className="text-xs text-red-500 mt-1">{task.error}</p>
                                )}
                                {typeof task.result?.response === 'string' && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                    Result: {task.result.response.substring(0, 200)}...
                                  </p>
                                )}
                                {Array.isArray(task.result?.toolCalls) && (
                                  <p className="text-xs text-purple-500 mt-1">
                                    Tools: {(task.result.toolCalls as Array<{ tool: string }>).map(t => t.tool).join(', ')}
                                  </p>
                                )}
                              </div>
                            </div>
                            {task.status === 'pending' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleExecuteTask(task.id)}
                              >
                                <Play className="w-4 h-4 mr-1" />
                                Execute
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </Card>
            )}
          </TabsContent>

          {/* Triggers Tab */}
          <TabsContent value="triggers">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Triggers</h2>
              <Dialog open={createTriggerOpen} onOpenChange={setCreateTriggerOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" disabled={agents.length === 0}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Trigger
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Trigger</DialogTitle>
                    <DialogDescription>
                      Create a trigger to automatically invoke agents.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label>Agent</Label>
                      <Select
                        value={selectedAgent?.id}
                        onValueChange={(val) => {
                          const agent = agents.find((a) => a.id === val);
                          setSelectedAgent(agent || null);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select an agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name}
                            </SelectItem>
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
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Trigger Type</Label>
                      <Select
                        value={newTriggerType}
                        onValueChange={(val) => setNewTriggerType(val as typeof newTriggerType)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="heartbeat">
                            <div className="flex items-center gap-2">
                              <Heart className="w-4 h-4" />
                              Heartbeat (Interval)
                            </div>
                          </SelectItem>
                          <SelectItem value="cron">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4" />
                              Cron (Scheduled)
                            </div>
                          </SelectItem>
                          <SelectItem value="webhook">
                            <div className="flex items-center gap-2">
                              <Webhook className="w-4 h-4" />
                              Webhook
                            </div>
                          </SelectItem>
                          <SelectItem value="hook">
                            <div className="flex items-center gap-2">
                              <Zap className="w-4 h-4" />
                              Internal Hook
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {newTriggerType === 'heartbeat' && (
                      <div className="grid gap-2">
                        <Label htmlFor="interval">Interval (minutes)</Label>
                        <Input
                          id="interval"
                          type="number"
                          value={newTriggerInterval}
                          onChange={(e) => setNewTriggerInterval(e.target.value)}
                          placeholder="30"
                        />
                      </div>
                    )}
                    {newTriggerType === 'cron' && (
                      <div className="grid gap-2">
                        <Label htmlFor="cron">Cron Expression</Label>
                        <Input
                          id="cron"
                          value={newTriggerCron}
                          onChange={(e) => setNewTriggerCron(e.target.value)}
                          placeholder="0 9 * * *"
                        />
                        <p className="text-xs text-muted-foreground">
                          Example: "0 9 * * *" = Every day at 9:00 AM
                        </p>
                      </div>
                    )}
                    {newTriggerType === 'webhook' && (
                      <div className="grid gap-2">
                        <Label htmlFor="secret">Webhook Secret (optional)</Label>
                        <Input
                          id="secret"
                          type="password"
                          value={newTriggerSecret}
                          onChange={(e) => setNewTriggerSecret(e.target.value)}
                          placeholder="Secret for signature verification"
                        />
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateTriggerOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateTrigger} disabled={!selectedAgent || !newTriggerName.trim()}>
                      Create Trigger
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {triggers.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Zap className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No triggers configured</h3>
                  <p className="text-muted-foreground mb-4">
                    Create triggers to enable proactive agent behavior.
                  </p>
                  <Button onClick={() => setCreateTriggerOpen(true)} disabled={agents.length === 0}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Trigger
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {triggers.map((trigger) => {
                  const agent = agents.find((a) => a.id === trigger.agentId);
                  return (
                    <Card key={trigger.id}>
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                              {trigger.type === 'heartbeat' && <Heart className="w-5 h-5" />}
                              {trigger.type === 'cron' && <Calendar className="w-5 h-5" />}
                              {trigger.type === 'webhook' && <Webhook className="w-5 h-5" />}
                              {trigger.type === 'hook' && <Zap className="w-5 h-5" />}
                            </div>
                            <div>
                              <h3 className="font-medium">{trigger.name}</h3>
                              <p className="text-sm text-muted-foreground">
                                {agent?.name} • {trigger.type}
                                {trigger.type === 'heartbeat' && trigger.config.interval && (
                                  <> • Every {trigger.config.interval} min</>
                                )}
                                {trigger.type === 'cron' && trigger.config.cronExpression && (
                                  <> • {trigger.config.cronExpression}</>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {trigger.nextTrigger && (
                              <div className="text-sm text-muted-foreground">
                                Next: {new Date(trigger.nextTrigger).toLocaleString()}
                              </div>
                            )}
                            <Switch
                              checked={trigger.enabled}
                              onCheckedChange={() => handleToggleTrigger(trigger)}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteTrigger(trigger.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Tools Tab */}
          <TabsContent value="tools">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Available Tools</h2>
              <p className="text-sm text-muted-foreground">
                Tools that agents can use to perform actions
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tools.map((tool) => (
                <Card key={tool.name}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono">{tool.name}</CardTitle>
                      <Badge 
                        variant={tool.riskLevel === 'high' ? 'destructive' : tool.riskLevel === 'medium' ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        {tool.riskLevel}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">{tool.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-3">
                    {tool.parameters.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Parameters:</p>
                        {tool.parameters.map((param) => (
                          <div key={param.name} className="text-xs text-muted-foreground">
                            <span className="font-mono">{param.name}</span>
                            {param.required && <span className="text-red-500">*</span>}
                            <span className="ml-1">({param.type})</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <Separator className="my-3" />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setSelectedTool(tool);
                        setToolParams('{}');
                        setToolResult(null);
                        setTestToolOpen(true);
                      }}
                    >
                      <Terminal className="w-4 h-4 mr-2" />
                      Test Tool
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Audit Log Tab */}
          <TabsContent value="audit">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Audit Log</h2>
              <Badge variant="outline">{auditLogs.length} events</Badge>
            </div>

            {auditLogs.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No audit events</h3>
                  <p className="text-muted-foreground">
                    Events will be logged here as agents perform actions.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <ScrollArea className="h-[600px]">
                  <div className="divide-y">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="p-4 hover:bg-muted/50">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{log.action}</span>
                              <SeverityBadge severity={log.severity} />
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {log.entityType}: {log.entityId}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(log.createdAt).toLocaleString()}
                            </p>
                            {Object.keys(log.details).length > 0 && (
                              <pre className="text-xs text-muted-foreground mt-2 bg-muted p-2 rounded overflow-x-auto">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </Card>
            )}
          </TabsContent>

          {/* Live Events Tab */}
          <TabsContent value="events">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Live Events</h2>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-sm text-muted-foreground">
                  {wsConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>

            {wsEvents.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Radio className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No events yet</h3>
                  <p className="text-muted-foreground">
                    Real-time events will appear here as they occur.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <ScrollArea className="h-[600px]">
                  <div className="divide-y">
                    {wsEvents.map((event, index) => (
                      <div key={index} className="p-4 hover:bg-muted/50">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="secondary">{event.type}</Badge>
                            </div>
                            <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto">
                              {JSON.stringify(event.data, null, 2)}
                            </pre>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(event.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Send Message Dialog */}
      <Dialog open={sendMessageOpen} onOpenChange={setSendMessageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Message to {selectedAgent?.name}</DialogTitle>
            <DialogDescription>
              Send a test message to this agent.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Channel</Label>
              <Select value={messageChannel} onValueChange={setMessageChannel}>
                <SelectTrigger>
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
                placeholder="Type your message... (try: What time is it?)"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendMessageOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendMessage} disabled={!messageContent.trim()}>
              <Send className="w-4 h-4 mr-2" />
              Send Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Tool Dialog */}
      <Dialog open={testToolOpen} onOpenChange={setTestToolOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Test Tool: {selectedTool?.name}</DialogTitle>
            <DialogDescription>
              {selectedTool?.description}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Parameters (JSON)</Label>
              <Textarea
                value={toolParams}
                onChange={(e) => setToolParams(e.target.value)}
                placeholder='{"param1": "value1"}'
                rows={4}
                className="font-mono text-sm"
              />
            </div>
            {toolResult && (
              <div className="grid gap-2">
                <Label>Result</Label>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-64">
                  {toolResult}
                </pre>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestToolOpen(false)}>
              Close
            </Button>
            <Button onClick={handleTestTool}>
              <Play className="w-4 h-4 mr-2" />
              Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
