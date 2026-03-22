import { z } from 'zod';

const prismaLogLevelSchema = z.enum(['query', 'info', 'warn', 'error']);

export type PrismaLogLevel = z.infer<typeof prismaLogLevelSchema>;

const runtimeSafetySchema = z.object({
  subagentTimeout: z.number().int().positive().optional(),
  maxSpawnDepth: z.number().int().positive().optional(),
  maxIterations: z.number().int().positive().optional(),
  maxDeliveryRetries: z.number().int().positive().optional(),
});

const runtimeRetentionSchema = z.object({
  tasks: z.number().int().positive().optional(),
  auditLogs: z.number().int().positive().optional(),
});

const runtimeLoggingSchema = z.object({
  prisma: z.array(prismaLogLevelSchema).optional(),
});

const runtimePerformanceSchema = z.object({
  pollInterval: z.number().int().positive().optional(),
  heartbeatInterval: z.number().int().positive().optional(),
  deliveryBatchSize: z.number().int().positive().optional(),
  contextWindow: z.number().int().positive().optional(),
  compactionThreshold: z.number().min(0).max(1).optional(),
});

export const runtimeSectionSchema = z.object({
  safety: runtimeSafetySchema.optional(),
  retention: runtimeRetentionSchema.optional(),
  logging: runtimeLoggingSchema.optional(),
  performance: runtimePerformanceSchema.optional(),
});

export interface RuntimeSafetyConfig {
  subagentTimeout?: number;
  maxSpawnDepth?: number;
  maxIterations?: number;
  maxDeliveryRetries?: number;
}

export interface RuntimeRetentionConfig {
  tasks?: number;
  auditLogs?: number;
}

export interface RuntimeLoggingConfig {
  prisma?: PrismaLogLevel[];
}

export interface RuntimePerformanceConfig {
  pollInterval?: number;
  heartbeatInterval?: number;
  deliveryBatchSize?: number;
  contextWindow?: number;
  compactionThreshold?: number;
}

export interface RuntimeSectionConfig {
  safety?: RuntimeSafetyConfig;
  retention?: RuntimeRetentionConfig;
  logging?: RuntimeLoggingConfig;
  performance?: RuntimePerformanceConfig;
}

export const providerApiTypeSchema = z.enum([
  'openai-chat',
  'openai-responses',
  'anthropic',
  'poe',
]);

export type ProviderApiType = z.infer<typeof providerApiTypeSchema>;

const providerConfigSchema = z.object({
  apiType: providerApiTypeSchema,
  baseURL: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().min(1),
}).strict();

const providersSchema = z.record(z.string().trim().min(1), providerConfigSchema)
  .superRefine((providers, context) => {
    for (const providerId of Object.keys(providers)) {
      const normalized = providerId.trim();
      if (normalized !== providerId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'provider identifiers must not contain leading or trailing whitespace',
          path: [providerId],
        });
      }
    }
  });

const agentConfigSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  fallbackProvider: z.string().trim().min(1).optional(),
  fallbackModel: z.string().trim().min(1).optional(),
}).strict().superRefine((agent, context) => {
  const hasFallbackProvider = typeof agent.fallbackProvider === 'string';
  const hasFallbackModel = typeof agent.fallbackModel === 'string';

  if (hasFallbackProvider !== hasFallbackModel) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'fallbackProvider and fallbackModel must be provided together',
      path: hasFallbackProvider ? ['fallbackModel'] : ['fallbackProvider'],
    });
  }
});

export const runtimeConfigSchema = z.object({
  providers: providersSchema,
  agent: agentConfigSchema,
  runtime: runtimeSectionSchema.optional(),
}).strict().superRefine((config, context) => {
  if (!(config.agent.provider in config.providers)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `agent provider '${config.agent.provider}' is not defined in providers`,
      path: ['agent', 'provider'],
    });
  }

  if (config.agent.fallbackProvider && !(config.agent.fallbackProvider in config.providers)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `fallback provider '${config.agent.fallbackProvider}' is not defined in providers`,
      path: ['agent', 'fallbackProvider'],
    });
  }
});

export interface ProviderDefinition {
  id: string;
  apiType: ProviderApiType;
  baseURL?: string;
  apiKey: string;
}

export interface AgentConfig {
  provider: string;
  model: string;
  fallbackProvider?: string;
  fallbackModel?: string;
}

export interface RuntimeConfig {
  providers: Record<string, ProviderDefinition>;
  agent: AgentConfig;
  runtime?: RuntimeSectionConfig;
}

export function normalizeRuntimeConfig(input: z.infer<typeof runtimeConfigSchema>): RuntimeConfig {
  const providers = Object.entries(input.providers).reduce<Record<string, ProviderDefinition>>((accumulator, [id, definition]) => {
    accumulator[id] = {
      id,
      apiType: definition.apiType,
      baseURL: definition.baseURL,
      apiKey: definition.apiKey,
    };
    return accumulator;
  }, {});

  return {
    providers,
    agent: {
      provider: input.agent.provider,
      model: input.agent.model,
      fallbackProvider: input.agent.fallbackProvider,
      fallbackModel: input.agent.fallbackModel,
    },
    runtime: input.runtime,
  };
}
