import { z } from 'zod';

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
  };
}
