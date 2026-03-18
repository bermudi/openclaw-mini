// OpenClaw Agent Runtime - Type Definitions

// Agent Types
export type AgentStatus = 'idle' | 'busy' | 'error' | 'disabled';

export interface Agent {
  id: string;
  name: string;
  description?: string;
  status: AgentStatus;
  skills: string[];
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Session Types
export type ChannelType = 'slack' | 'discord' | 'whatsapp' | 'telegram' | 'imessage' | 'webhook' | 'internal';

export interface Session {
  id: string;
  agentId: string;
  channel: ChannelType;
  channelKey: string;
  sessionScope: string;
  context: Record<string, unknown>;
  lastActive: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Task Types
export type TaskType = 'message' | 'heartbeat' | 'cron' | 'webhook' | 'hook' | 'a2a' | 'subagent';
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Task {
  id: string;
  agentId: string;
  sessionId?: string;
  type: TaskType;
  priority: number;
  status: TaskStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  source?: string;
  parentTaskId?: string | null;
  skillName?: string | null;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ChannelBinding {
  id: string;
  channel: string;
  channelKey: string;
  agentId: string;
  createdAt: Date;
}

// Trigger Types
export type TriggerType = 'heartbeat' | 'cron' | 'webhook' | 'hook';

export interface Trigger {
  id: string;
  agentId: string;
  name: string;
  type: TriggerType;
  config: TriggerConfig;
  enabled: boolean;
  lastTriggered?: Date;
  nextTrigger?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TriggerConfig {
  // Heartbeat config
  interval?: number; // minutes
  
  // Cron config
  cronExpression?: string;
  timezone?: string;
  
  // Webhook config
  endpoint?: string;
  secret?: string;
  method?: string;
  
  // Hook config
  event?: string;
  condition?: Record<string, unknown>;
}

// Memory Types
export type MemoryCategory = 'general' | 'preferences' | 'history' | 'context';

export interface Memory {
  id: string;
  agentId: string;
  key: string;
  value: string; // Markdown content
  category: MemoryCategory;
  createdAt: Date;
  updatedAt: Date;
}

// Input Types
export interface MessageInput {
  type: 'message';
  channel: ChannelType;
  channelKey: string;
  content: string;
  sender?: string;
  metadata?: Record<string, unknown>;
}

export interface HeartbeatInput {
  type: 'heartbeat';
  triggerId: string;
  timestamp: Date;
}

export interface CronInput {
  type: 'cron';
  triggerId: string;
  scheduledTime: Date;
  timestamp: Date;
}

export interface WebhookInput {
  type: 'webhook';
  source: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface HookInput {
  type: 'hook';
  event: string;
  data: Record<string, unknown>;
}

export interface A2AInput {
  type: 'a2a';
  fromAgentId: string;
  toAgentId: string;
  message: string;
  data?: Record<string, unknown>;
}

export type Input = MessageInput | HeartbeatInput | CronInput | WebhookInput | HookInput | A2AInput;

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// WebSocket Event Types
export type WSEventType = 
  | 'task:created'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'agent:status'
  | 'trigger:fired'
  | 'memory:updated';

export interface WSEvent {
  type: WSEventType;
  data: Record<string, unknown>;
  timestamp: Date;
}
