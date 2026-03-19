import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { PROVIDER_NAMES, loadCredentialRef, type ProviderName } from '@/lib/subagent-config';

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4.1': 1047576,
  'gpt-4.1-mini': 1047576,
  'gpt-4.1-nano': 1047576,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  'claude-3-7-sonnet-latest': 200000,
  'claude-3-5-sonnet-latest': 200000,
  'claude-3-5-haiku-latest': 200000,
};

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  baseURL?: string;
  credentialRef?: string;
}

function parseProviderName(value: string | undefined): ProviderName {
  if (value && PROVIDER_NAMES.includes(value as ProviderName)) {
    return value as ProviderName;
  }

  return 'openai';
}

function getDefaultBaseUrl(provider: ProviderName): string | undefined {
  if (provider === 'ollama') {
    return 'http://localhost:11434/v1';
  }

  if (provider === 'openrouter') {
    return 'https://openrouter.ai/api/v1';
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
  }
}

export function getModelConfig(): ProviderConfig {
  const provider = parseProviderName(process.env.AI_PROVIDER);
  const model = process.env.AI_MODEL || 'gpt-4.1-mini';
  const baseURL = process.env.AI_BASE_URL;
  return {
    provider,
    model,
    baseURL: baseURL || getDefaultBaseUrl(provider),
    apiKey: getDefaultApiKey(provider),
  };
}

export function resolveModelConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  const baseConfig = getModelConfig();
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
  };
}

export function getContextWindowSize(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 8192;
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
  }
}
