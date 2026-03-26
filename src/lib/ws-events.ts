export type WSEventType =
  | 'task:created'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'agent:status'
  | 'trigger:fired'
  | 'memory:updated'
  | 'memory:index-requested'
  | 'stats:update'
  | 'tool:called'
  | 'session:updated'
  | 'session:created'
  | 'subagent:completed'
  | 'subagent:failed';

export interface WSBroadcastEvent {
  type: WSEventType;
  data: Record<string, unknown>;
  source?: string;
}

export interface WSEvent extends WSBroadcastEvent {
  timestamp: string;
}
