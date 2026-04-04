import { z } from 'zod';

// ─── Documented validation scope ────────────────────────────────────────────
//
// Fields validated in this pass:
//   Task.payload         – generic JSON object (Record<string, unknown>)
//   Task.result          – generic JSON object or null
//   Session.asyncTaskRegistry – map of taskId → AsyncTaskRecord
//   Trigger.config       – typed TriggerConfig object
//   Agent.skills         – JSON array of skill name strings
//
// Fields intentionally deferred:
//   Session.context      – deprecated column, no longer written by callers
//   Memory.value         – free-form Markdown; shape is intentionally open
//   WebhookLog.payload   – pass-through from external sources; validated upstream
// ────────────────────────────────────────────────────────────────────────────

export class StorageValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly cause: z.ZodError,
  ) {
    super(`Storage validation failed for ${field}: ${cause.message}`);
    this.name = 'StorageValidationError';
  }
}

// ─── Task schemas ────────────────────────────────────────────────────────────

export const taskPayloadSchema = z.record(z.string(), z.unknown());
export type TaskPayload = z.infer<typeof taskPayloadSchema>;

export const taskResultSchema = z.record(z.string(), z.unknown());
export type TaskResult = z.infer<typeof taskResultSchema>;

export function parseTaskPayload(raw: string): TaskPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StorageValidationError(
      'Task.payload',
      new z.ZodError([{
        code: 'custom',
        message: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
        path: [],
      }]),
    );
  }
  const result = taskPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new StorageValidationError('Task.payload', result.error);
  }
  return result.data;
}

export function parseTaskResult(raw: string): TaskResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StorageValidationError(
      'Task.result',
      new z.ZodError([{
        code: 'custom',
        message: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
        path: [],
      }]),
    );
  }
  const result = taskResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new StorageValidationError('Task.result', result.error);
  }
  return result.data;
}

export function serializeTaskPayload(payload: TaskPayload): string {
  const result = taskPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw new StorageValidationError('Task.payload', result.error);
  }
  return JSON.stringify(result.data);
}

export function serializeTaskResult(taskResult: TaskResult): string {
  const result = taskResultSchema.safeParse(taskResult);
  if (!result.success) {
    throw new StorageValidationError('Task.result', result.error);
  }
  return JSON.stringify(result.data);
}

// ─── AsyncTaskRecord / registry schemas ─────────────────────────────────────

const asyncTaskRegistryStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']);

export const asyncTaskRecordSchema = z.object({
  taskId: z.string(),
  skill: z.string(),
  status: asyncTaskRegistryStatusSchema,
  createdAt: z.string(),
  lastCheckedAt: z.string().optional(),
  lastUpdatedAt: z.string().optional(),
});
export type AsyncTaskRecordValidated = z.infer<typeof asyncTaskRecordSchema>;

export const asyncTaskRegistrySchema = z.record(z.string(), asyncTaskRecordSchema);
export type AsyncTaskRegistry = z.infer<typeof asyncTaskRegistrySchema>;

export function parseAsyncTaskRegistry(raw: string): Map<string, AsyncTaskRecordValidated> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StorageValidationError(
      'Session.asyncTaskRegistry',
      new z.ZodError([{
        code: 'custom',
        message: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
        path: [],
      }]),
    );
  }
  const result = asyncTaskRegistrySchema.safeParse(parsed);
  if (!result.success) {
    throw new StorageValidationError('Session.asyncTaskRegistry', result.error);
  }
  return new Map(Object.entries(result.data));
}

export function serializeAsyncTaskRegistry(registry: Map<string, AsyncTaskRecordValidated>): string {
  const obj = Object.fromEntries(registry.entries());
  const result = asyncTaskRegistrySchema.safeParse(obj);
  if (!result.success) {
    throw new StorageValidationError('Session.asyncTaskRegistry', result.error);
  }
  return JSON.stringify(result.data);
}

// ─── TriggerConfig schema ────────────────────────────────────────────────────

export const triggerConfigSchema = z.object({
  interval: z.number().int().positive().optional(),
  cronExpression: z.string().optional(),
  timezone: z.string().optional(),
  endpoint: z.string().optional(),
  secret: z.string().optional(),
  method: z.string().optional(),
  event: z.string().optional(),
  condition: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type TriggerConfigValidated = z.infer<typeof triggerConfigSchema>;

export function parseTriggerConfig(raw: string): TriggerConfigValidated {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StorageValidationError(
      'Trigger.config',
      new z.ZodError([{
        code: 'custom',
        message: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
        path: [],
      }]),
    );
  }
  const result = triggerConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new StorageValidationError('Trigger.config', result.error);
  }
  return result.data;
}

export function serializeTriggerConfig(config: TriggerConfigValidated): string {
  const result = triggerConfigSchema.safeParse(config);
  if (!result.success) {
    throw new StorageValidationError('Trigger.config', result.error);
  }
  return JSON.stringify(result.data);
}

// ─── Agent skills schema ─────────────────────────────────────────────────────

export const agentSkillsSchema = z.array(z.string());
export type AgentSkills = z.infer<typeof agentSkillsSchema>;

export function parseAgentSkills(raw: string): AgentSkills {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StorageValidationError(
      'Agent.skills',
      new z.ZodError([{
        code: 'custom',
        message: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
        path: [],
      }]),
    );
  }
  const result = agentSkillsSchema.safeParse(parsed);
  if (!result.success) {
    throw new StorageValidationError('Agent.skills', result.error);
  }
  return result.data;
}

export function serializeAgentSkills(skills: AgentSkills): string {
  const result = agentSkillsSchema.safeParse(skills);
  if (!result.success) {
    throw new StorageValidationError('Agent.skills', result.error);
  }
  return JSON.stringify(result.data);
}
