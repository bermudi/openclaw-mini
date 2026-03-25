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

const embeddingProviderSchema = z.enum(['disabled', 'openai', 'google', 'anthropic', 'ollama', 'mock']);
const vectorRetrievalModeSchema = z.enum(['disabled', 'auto', 'sqlite-vec', 'in-process']);
const execTierSchema = z.enum(['locked-down', 'sandbox', 'host']);
const containerRuntimeSchema = z.enum(['docker', 'podman']);
const execLaunchModeSchema = z.enum(['child', 'pty']);
const execMountPermissionSchema = z.enum(['read-only', 'read-write']);

const EXEC_TIER_RANK: Record<z.infer<typeof execTierSchema>, number> = {
  'locked-down': 0,
  sandbox: 1,
  host: 2,
};

export type EmbeddingProvider = z.infer<typeof embeddingProviderSchema>;
export type VectorRetrievalMode = z.infer<typeof vectorRetrievalModeSchema>;
export type ExecTier = z.infer<typeof execTierSchema>;
export type ContainerRuntime = z.infer<typeof containerRuntimeSchema>;
export type ExecLaunchMode = z.infer<typeof execLaunchModeSchema>;
export type ExecMountPermission = z.infer<typeof execMountPermissionSchema>;

const runtimeMemorySchema = z.object({
  embeddingProvider: embeddingProviderSchema.optional(),
  embeddingModel: z.string().trim().min(1).optional(),
  embeddingVersion: z.string().trim().min(1).optional(),
  embeddingDimensions: z.number().int().positive().optional(),
  chunkingThreshold: z.number().int().positive().optional(),
  chunkOverlap: z.number().int().nonnegative().optional(),
  vectorRetrievalMode: vectorRetrievalModeSchema.optional(),
  recallConfidenceThreshold: z.number().min(0).max(1).optional(),
  maxSearchResults: z.number().int().positive().optional(),
}).strict();

export const execMountSchema = z.object({
  alias: z.string().trim().min(1),
  hostPath: z.string().trim().min(1),
  permissions: execMountPermissionSchema,
  createIfMissing: z.boolean().optional(),
}).strict().superRefine((mount, context) => {
  if (!/^[A-Za-z0-9_-]+$/.test(mount.alias)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'mount alias must contain only letters, numbers, underscores, and hyphens',
      path: ['alias'],
    });
  }

  if (mount.alias === 'sandbox') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'mount alias \"sandbox\" is reserved',
      path: ['alias'],
    });
  }
});

const runtimeExecSchema = z.object({
  enabled: z.boolean().optional(),
  allowlist: z.array(z.string().trim().min(1)).optional(),
  defaultTier: execTierSchema.optional(),
  maxTier: execTierSchema.optional(),
  containerRuntime: containerRuntimeSchema.optional(),
  mounts: z.array(execMountSchema).optional(),
  maxTimeout: z.number().int().positive().optional(),
  maxOutputSize: z.number().int().positive().optional(),
  maxSessions: z.number().int().positive().optional(),
  sessionTimeout: z.number().int().positive().optional(),
  sessionBufferSize: z.number().int().positive().optional(),
  foregroundYieldMs: z.number().int().positive().optional(),
  defaultLaunchMode: execLaunchModeSchema.optional(),
  defaultBackground: z.boolean().optional(),
  ptyCols: z.number().int().positive().optional(),
  ptyRows: z.number().int().positive().optional(),
}).strict().superRefine((execConfig, context) => {
  if (execConfig.defaultTier && execConfig.maxTier) {
    if (EXEC_TIER_RANK[execConfig.defaultTier] > EXEC_TIER_RANK[execConfig.maxTier]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'defaultTier cannot be more privileged than maxTier',
        path: ['defaultTier'],
      });
    }
  }

  if (!execConfig.mounts) {
    return;
  }

  const aliases = new Set<string>();
  for (const [index, mount] of execConfig.mounts.entries()) {
    if (aliases.has(mount.alias)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate mount alias '${mount.alias}'`,
        path: ['mounts', index, 'alias'],
      });
      continue;
    }

    aliases.add(mount.alias);
  }
});

const browserViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const browserConfigSchema = z.object({
  headless: z.boolean().optional(),
  viewport: browserViewportSchema.optional(),
  navigationTimeout: z.number().int().positive().optional(),
});

const mcpStringMapSchema = z.record(z.string().trim().min(1), z.string());

const stdioMcpServerSchema = z.object({
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional(),
  env: mcpStringMapSchema.optional(),
  description: z.string().trim().min(1).optional(),
}).strict();

const httpMcpServerSchema = z.object({
  url: z.string().url(),
  headers: mcpStringMapSchema.optional(),
  description: z.string().trim().min(1).optional(),
}).strict();

export const mcpServerSchema = z.union([stdioMcpServerSchema, httpMcpServerSchema]);

const mcpConfigSchema = z.object({
  servers: z.record(z.string().trim().min(1), mcpServerSchema),
}).strict();

export const runtimeSectionSchema = z.object({
  safety: runtimeSafetySchema.optional(),
  retention: runtimeRetentionSchema.optional(),
  logging: runtimeLoggingSchema.optional(),
  performance: runtimePerformanceSchema.optional(),
  exec: runtimeExecSchema.optional(),
  memory: runtimeMemorySchema.optional(),
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

export interface RuntimeMemoryConfig {
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
  embeddingVersion?: string;
  embeddingDimensions?: number;
  chunkingThreshold?: number;
  chunkOverlap?: number;
  vectorRetrievalMode?: VectorRetrievalMode;
  recallConfidenceThreshold?: number;
  maxSearchResults?: number;
}

export interface ExecMountConfig {
  alias?: string;
  hostPath?: string;
  permissions?: ExecMountPermission;
  createIfMissing?: boolean;
}

export interface ExecConfig {
  enabled?: boolean;
  allowlist?: string[];
  defaultTier?: ExecTier;
  maxTier?: ExecTier;
  containerRuntime?: ContainerRuntime;
  mounts?: ExecMountConfig[];
  maxTimeout?: number;
  maxOutputSize?: number;
  maxSessions?: number;
  sessionTimeout?: number;
  sessionBufferSize?: number;
  foregroundYieldMs?: number;
  defaultLaunchMode?: ExecLaunchMode;
  defaultBackground?: boolean;
  ptyCols?: number;
  ptyRows?: number;
}

export interface BrowserViewportConfig {
  width: number;
  height: number;
}

export interface BrowserConfig {
  headless?: boolean;
  viewport?: BrowserViewportConfig;
  navigationTimeout?: number;
}

export type McpServerConfig = z.infer<typeof mcpServerSchema>;

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface SearchConfig {
  braveApiKey?: string;
  tavilyApiKey?: string;
}

export interface RuntimeSectionConfig {
  safety?: RuntimeSafetyConfig;
  retention?: RuntimeRetentionConfig;
  logging?: RuntimeLoggingConfig;
  performance?: RuntimePerformanceConfig;
  exec?: ExecConfig;
  memory?: RuntimeMemoryConfig;
}

const searchConfigSchema = z.object({
  braveApiKey: z.string().trim().min(1).optional(),
  tavilyApiKey: z.string().trim().min(1).optional(),
});

export const providerApiTypeSchema = z.enum([
  'openai-chat',
  'openai-responses',
  'anthropic',
  'poe',
  'gemini',
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
  browser: browserConfigSchema.optional(),
  search: searchConfigSchema.optional(),
  mcp: mcpConfigSchema.optional(),
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
  browser?: BrowserConfig;
  search?: SearchConfig;
  mcp?: McpConfig;
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
    browser: input.browser,
    search: input.search,
    mcp: input.mcp,
  };
}
