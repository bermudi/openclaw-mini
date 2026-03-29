// OpenClaw Agent Runtime - Type Definitions

// Agent Types
export type AgentStatus = 'idle' | 'busy' | 'error' | 'disabled';

export interface Agent {
  id: string;
  name: string;
  description?: string;
  model?: string;
  contextWindowOverride?: number;
  compactionThreshold?: number;
  status: AgentStatus;
  skills: string[];
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Session Types
export type ChannelType = 'slack' | 'discord' | 'whatsapp' | 'telegram' | 'imessage' | 'webhook' | 'internal' | 'webchat';

export interface DeliveryMetadata {
  chatId?: string;
  channelId?: string;
  threadId?: string;
  userId?: string;
  replyToMessageId?: string;
}

export interface DeliveryTarget {
  channel: ChannelType;
  channelKey: string;
  metadata: DeliveryMetadata;
}

/**
 * Result of downloading a file from a channel.
 */
export interface DownloadedFile {
  localPath: string;
  mimeType: string;
}

/**
 * Interface for downloading files from a channel.
 * Each adapter that supports file downloads implements this.
 */
export interface ChannelFileDownloader {
  downloadFile(fileId: string, destDir: string, filename?: string): Promise<DownloadedFile>;
}

export interface ChannelAdapter {
  readonly channel: ChannelType;
  sendText(target: DeliveryTarget, text: string): Promise<{ externalMessageId?: string }>;
  sendTyping?(target: DeliveryTarget): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  isConnected?(): boolean;
  sendFile?(target: DeliveryTarget, filePath: string, opts?: {
    filename?: string;
    mimeType?: string;
    caption?: string;
  }): Promise<{ externalMessageId?: string }>;
  downloadFile?(fileId: string, destDir: string, filename?: string): Promise<DownloadedFile>;
}

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

// Async Task Registry Types
export type AsyncTaskRegistryStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface AsyncTaskRecord {
  taskId: string;
  skill: string;
  status: AsyncTaskRegistryStatus;
  createdAt: string;
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
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
  spawnDepth?: number;
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
export type MemoryCategory = 'general' | 'preferences' | 'history' | 'context' | 'extracted' | 'archived';

export interface Memory {
  id: string;
  agentId: string;
  key: string;
  value: string; // Markdown content
  category: MemoryCategory;
  confidence: number;
  lastReinforcedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MemoryRetrievalMethod = 'exact' | 'keyword' | 'vector' | 'hybrid' | 'pinned';
export type MemoryRecallMode = 'automatic' | 'search' | 'get';
export type MemoryIndexStatus = 'pending' | 'indexed' | 'failed' | 'stale';

export interface MemoryChunk {
  id: string;
  memoryId: string;
  agentId: string;
  memoryKey: string;
  chunkIndex: number;
  content: string;
  normalizedContent: string;
  contentHash: string;
  tokenEstimate: number;
  charCount: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  embeddingDimensions: number | null;
  embedding: number[] | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryIndexState {
  id: string;
  memoryId: string;
  agentId: string;
  status: MemoryIndexStatus;
  lastContentHash: string | null;
  lastIndexedAt: Date | null;
  lastError: string | null;
  attempts: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  embeddingDimensions: number | null;
  vectorMode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryRecallCandidate {
  key: string;
  memoryId: string;
  value: string;
  snippet: string;
  confidence: number;
  category: MemoryCategory;
  retrievalMethod: MemoryRetrievalMethod;
  score: number;
  tokenEstimate: number;
  chunkId?: string;
}

export interface MemoryRecallLogEntry {
  id: string;
  agentId: string;
  mode: MemoryRecallMode;
  query: string | null;
  retrievalMode: string;
  candidateCounts: Record<string, number>;
  selectedKeys: string[];
  omittedKeys: string[];
  selectedCount: number;
  omittedCount: number;
  estimatedTokens: number;
  details: Record<string, unknown>;
  createdAt: Date;
}

// Attachment Types
export interface Attachment {
  channelFileId: string;
  localPath: string;
  filename: string;
  mimeType: string;
  size?: number;
}

export interface VisionInput {
  channelFileId: string;
  localPath: string;
  mimeType: string;
}

// Input Types
export interface MessageInput {
  type: 'message';
  channel: ChannelType;
  channelKey: string;
  content: string;
  sender?: string;
  deliveryTarget?: DeliveryTarget;
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];
  visionInputs?: VisionInput[];
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

export type Input = MessageInput | WebhookInput | HookInput | A2AInput;

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type { WSEventType, WSEvent } from '@/lib/ws-events';
