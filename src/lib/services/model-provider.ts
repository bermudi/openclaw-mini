import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { PROVIDER_NAMES, loadCredentialRef, type ProviderName } from '@/lib/subagent-config';
import { modelCatalog } from './model-catalog';
import { createPoeLanguageModel } from './poe-client';

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
  provider: ProviderName;
  model: string;
  apiKey?: string;
  baseURL?: string;
  credentialRef?: string;
  fallbackModel?: string;
}

interface ResolveModelConfigOptions {
  ignoreEnvFallback?: boolean;
}

function parseProviderName(value: string | undefined): ProviderName {
  if (value && PROVIDER_NAMES.includes(value as ProviderName)) {
    return value as ProviderName;
  }

  return 'openai';
}

function parseFallbackModelReference(value: string | undefined): Pick<ProviderConfig, 'provider' | 'model'> | undefined {
  if (!value) {
    return undefined;
  }

  const [providerValue, ...modelParts] = value.split('/');
  const normalizedProvider = providerValue?.trim().toLowerCase();
  const model = modelParts.join('/').trim();

  if (!normalizedProvider || model.length === 0) {
    throw new Error('AI_FALLBACK_MODEL must use provider/model format');
  }

  if (!PROVIDER_NAMES.includes(normalizedProvider as ProviderName)) {
    throw new Error(`AI_FALLBACK_MODEL provider '${providerValue}' is not supported`);
  }

  return {
    provider: normalizedProvider as ProviderName,
    model,
  };
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

function resolveFallbackModelConfig(config: ProviderConfig): ProviderConfig | undefined {
  const fallbackReference = parseFallbackModelReference(config.fallbackModel);

  if (!fallbackReference) {
    return undefined;
  }

  return resolveModelConfig(
    {
      provider: fallbackReference.provider,
      model: fallbackReference.model,
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

function getDefaultBaseUrl(provider: ProviderName): string | undefined {
  if (provider === 'ollama') {
    return 'http://localhost:11434/v1';
  }

  if (provider === 'openrouter') {
    return 'https://openrouter.ai/api/v1';
  }

  if (provider === 'poe') {
    return 'https://api.poe.com';
  }

  return undefined;
}

function getDefaultApiKey(provider: ProviderName): string | undefined {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY;
    case 'ollama':
      return 'ollama';
    case 'poe':
      return process.env.POE_API_KEY;
  }
}

export function getModelConfig(options: ResolveModelConfigOptions = {}): ProviderConfig {
  const provider = parseProviderName(process.env.AI_PROVIDER);
  const model = process.env.AI_MODEL || 'gpt-4.1-mini';
  const baseURL = process.env.AI_BASE_URL;
  return {
    provider,
    model,
    baseURL: baseURL || getDefaultBaseUrl(provider),
    apiKey: getDefaultApiKey(provider),
    fallbackModel: options.ignoreEnvFallback ? undefined : process.env.AI_FALLBACK_MODEL,
  };
}

export function resolveModelConfig(
  overrides?: Partial<ProviderConfig>,
  options: ResolveModelConfigOptions = {},
): ProviderConfig {
  const baseConfig = getModelConfig(options);
  const provider = overrides?.provider ?? baseConfig.provider;
  const credentialRef = overrides?.credentialRef;
  const baseURL = overrides?.baseURL
    ?? (provider === baseConfig.provider ? baseConfig.baseURL : undefined)
    ?? getDefaultBaseUrl(provider);

  return {
    provider,
    model: overrides?.model ?? baseConfig.model,
    baseURL,
    credentialRef,
    apiKey: overrides?.apiKey ?? (credentialRef ? loadCredentialRef(credentialRef) : undefined) ?? getDefaultApiKey(provider),
    fallbackModel: overrides?.fallbackModel ?? baseConfig.fallbackModel,
  };
}

export function getContextWindowSize(model: string): number {
  return modelCatalog.getContextWindowSize(model);
}

export function getLanguageModel(overrides?: Partial<ProviderConfig>): LanguageModel {
  const config = resolveModelConfig(overrides);

  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
      return openai(config.model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
      return anthropic(config.model);
    }
    case 'ollama': {
      const openai = createOpenAI({
        baseURL: config.baseURL || getDefaultBaseUrl('ollama'),
        apiKey: config.apiKey || 'ollama',
      });
      return openai(config.model);
    }
    case 'openrouter': {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL || getDefaultBaseUrl('openrouter'),
      });
      return openai(config.model);
    }
    case 'poe': {
      return createPoeLanguageModel({
        model: config.model,
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    }
  }
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
