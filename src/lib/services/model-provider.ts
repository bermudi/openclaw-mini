import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

export type ProviderName = 'openai' | 'anthropic' | 'ollama';

interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export function getModelConfig(): ProviderConfig {
  const provider = (process.env.AI_PROVIDER || 'openai') as ProviderName;
  const model = process.env.AI_MODEL || 'gpt-4.1-mini';
  const baseURL = process.env.AI_BASE_URL;
  return { provider, model, baseURL };
}

export function getLanguageModel(): LanguageModel {
  const config = getModelConfig();

  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: config.baseURL });
      return openai(config.model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: config.baseURL });
      return anthropic(config.model);
    }
    case 'ollama': {
      const openai = createOpenAI({
        baseURL: config.baseURL || 'http://localhost:11434/v1',
        apiKey: 'ollama',
      });
      return openai(config.model);
    }
  }
}
