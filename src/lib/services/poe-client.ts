import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export type PoeEndpoint = 'anthropic' | 'responses' | 'chat-completions';

export interface PoeLanguageModelConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
}

const POE_BASE_URL = 'https://api.poe.com';
const POE_V1_BASE_URL = `${POE_BASE_URL}/v1`;

export function poeEndpointForModel(model: string): PoeEndpoint {
  const normalized = model.trim().toLowerCase();

  if (normalized.startsWith('claude-')) {
    return 'anthropic';
  }

  if (/^(gpt-|o3(?:$|-)|o4(?:$|-))/.test(normalized)) {
    return 'responses';
  }

  return 'chat-completions';
}

export function getPoeEndpoint(model: string): PoeEndpoint {
  return poeEndpointForModel(model);
}

export function getPoeApiKey(explicitApiKey?: string): string {
  const apiKey = explicitApiKey ?? process.env.POE_API_KEY;

  if (!apiKey) {
    throw new Error('POE_API_KEY is not configured');
  }

  return apiKey;
}

function normalizeBaseUrl(baseURL: string | undefined, endpoint: PoeEndpoint): string {
  const normalizedBase = (baseURL && baseURL.trim().length > 0 ? baseURL : POE_BASE_URL).replace(/\/+$/, '');

  if (endpoint === 'anthropic') {
    return normalizedBase.endsWith('/v1')
      ? normalizedBase.slice(0, -3)
      : normalizedBase;
  }

  return normalizedBase.endsWith('/v1')
    ? normalizedBase
    : `${normalizedBase}/v1`;
}

export function createPoeLanguageModel(config: PoeLanguageModelConfig): LanguageModel {
  const endpoint = getPoeEndpoint(config.model);
  const apiKey = getPoeApiKey(config.apiKey);

  if (endpoint === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey,
      baseURL: normalizeBaseUrl(config.baseURL, endpoint),
    });

    return anthropic(config.model);
  }

  const openai = createOpenAI({
    apiKey,
    baseURL: normalizeBaseUrl(config.baseURL, endpoint),
  });

  if (endpoint === 'responses') {
    return openai.responses(config.model);
  }

  return openai.chat(config.model);
}
