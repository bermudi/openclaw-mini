import type { LanguageModel } from 'ai';
import { loadCredentialRef } from '@/lib/credentials';
import { modelCatalog } from './model-catalog';
import { ensureProviderRegistryInitialized, providerRegistry } from './provider-registry';
import { getRuntimeConfig } from '@/lib/config/runtime';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  credentialRef?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
}

interface ResolveModelConfigOptions {
  ignoreEnvFallback?: boolean;
}

interface AgentContextWindowInput {
  model?: string | null;
  contextWindowOverride?: number | null;
}

interface AgentCompactionThresholdInput {
  compactionThreshold?: number | null;
}


function extractStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };

  const directStatus = typeof candidate.status === 'number'
    ? candidate.status
    : typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : typeof candidate.response?.status === 'number'
        ? candidate.response.status
        : undefined;

  if (typeof directStatus === 'number') {
    return directStatus;
  }

  return extractStatusCode(candidate.cause);
}

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as { code?: unknown; cause?: unknown };

  if (typeof candidate.code === 'string') {
    return candidate.code;
  }

  return extractErrorCode(candidate.cause);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown provider error';
}

function getRuntimeState() {
  return ensureProviderRegistryInitialized();
}

function resolveFallbackModelConfig(config: ProviderConfig): ProviderConfig | undefined {
  if (!config.fallbackProvider || !config.fallbackModel) {
    return undefined;
  }

  return resolveModelConfig(
    {
      provider: config.fallbackProvider,
      model: config.fallbackModel,
      fallbackProvider: undefined,
      fallbackModel: undefined,
    },
    { ignoreEnvFallback: true },
  );
}

export function isRetryableModelError(error: unknown): boolean {
  const statusCode = extractStatusCode(error);

  if (typeof statusCode === 'number') {
    if (NON_RETRYABLE_STATUS_CODES.has(statusCode)) {
      return false;
    }

    if (RETRYABLE_STATUS_CODES.has(statusCode)) {
      return true;
    }
  }

  const errorCode = extractErrorCode(error);
  if (errorCode && RETRYABLE_NETWORK_CODES.has(errorCode.toUpperCase())) {
    return true;
  }

  return false;
}

export function getModelConfig(options: ResolveModelConfigOptions = {}): ProviderConfig {
  const { config } = getRuntimeState();
  const providerDefinition = providerRegistry.get(config.agent.provider);

  if (!providerDefinition) {
    throw new Error(`Provider '${config.agent.provider}' is not registered`);
  }

  return {
    provider: config.agent.provider,
    model: config.agent.model,
    baseURL: providerDefinition.baseURL,
    apiKey: providerDefinition.apiKey,
    fallbackProvider: options.ignoreEnvFallback ? undefined : config.agent.fallbackProvider,
    fallbackModel: options.ignoreEnvFallback ? undefined : config.agent.fallbackModel,
  };
}

export function resolveModelConfig(
  overrides?: Partial<ProviderConfig>,
  options: ResolveModelConfigOptions = {},
): ProviderConfig {
  const baseConfig = getModelConfig(options);
  const provider = overrides?.provider ?? baseConfig.provider;
  const providerDefinition = providerRegistry.get(provider);

  if (!providerDefinition) {
    throw new Error(`Provider '${provider}' is not registered`);
  }

  const credentialRef = overrides?.credentialRef;
  const baseURL = overrides?.baseURL
    ?? (provider === baseConfig.provider ? baseConfig.baseURL : undefined)
    ?? providerDefinition.baseURL;
  const apiKey = overrides?.apiKey
    ?? (credentialRef ? loadCredentialRef(credentialRef) : undefined)
    ?? (provider === baseConfig.provider ? baseConfig.apiKey : undefined)
    ?? providerDefinition.apiKey;

  return {
    provider,
    model: overrides?.model ?? baseConfig.model,
    baseURL,
    credentialRef,
    apiKey,
    fallbackProvider: overrides?.fallbackProvider ?? baseConfig.fallbackProvider,
    fallbackModel: overrides?.fallbackModel ?? baseConfig.fallbackModel,
  };
}

export function getContextWindowSize(model: string): number {
  return modelCatalog.getContextWindowSize(model);
}

export async function resolveAgentContextWindow(
  agent: AgentContextWindowInput,
): Promise<number> {
  if (
    typeof agent.contextWindowOverride === 'number'
    && Number.isInteger(agent.contextWindowOverride)
    && agent.contextWindowOverride > 0
  ) {
    return agent.contextWindowOverride;
  }

  if (agent.model) {
    const agentModelWindow = modelCatalog.getContextWindowSize(agent.model);
    if (agentModelWindow > 0) {
      return agentModelWindow;
    }
  }

  try {
    const globalModel = getModelConfig().model;
    const globalModelWindow = modelCatalog.getContextWindowSize(globalModel);

    if (globalModelWindow > 0) {
      return globalModelWindow;
    }
  } catch {
  }

  return getRuntimeConfig().performance.contextWindow;
}

export function resolveCompactionThreshold(
  agent: AgentCompactionThresholdInput,
): number {
  if (typeof agent.compactionThreshold === 'number') {
    return agent.compactionThreshold;
  }

  return getRuntimeConfig().performance.compactionThreshold;
}

export function getLanguageModel(overrides?: Partial<ProviderConfig>): LanguageModel {
  const config = resolveModelConfig(overrides);

  return providerRegistry.getLanguageModel(config.provider, config.model, {
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}

export async function runWithModelFallback<T>(
  operation: (input: { model: LanguageModel; config: ProviderConfig; isFallback: boolean }) => Promise<T>,
  overrides?: Partial<ProviderConfig>,
): Promise<T> {
  const primaryConfig = resolveModelConfig(overrides);

  try {
    return await operation({
      model: getLanguageModel(primaryConfig),
      config: primaryConfig,
      isFallback: false,
    });
  } catch (error) {
    const fallbackConfig = resolveFallbackModelConfig(primaryConfig);

    if (!fallbackConfig || !isRetryableModelError(error)) {
      throw error;
    }

    try {
      return await operation({
        model: getLanguageModel(fallbackConfig),
        config: fallbackConfig,
        isFallback: true,
      });
    } catch (fallbackError) {
      throw new AggregateError(
        [error, fallbackError],
        `Primary model ${primaryConfig.provider}/${primaryConfig.model} failed: ${getErrorMessage(error)}. Fallback model ${fallbackConfig.provider}/${fallbackConfig.model} also failed: ${getErrorMessage(fallbackError)}`,
      );
    }
  }
}
