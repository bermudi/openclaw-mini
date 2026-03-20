import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { loadConfig, type LoadConfigResult } from '@/lib/config/loader';
import { providerApiTypeSchema, type ProviderDefinition, type RuntimeConfig } from '@/lib/config/schema';
import { createPoeLanguageModel } from '@/lib/services/poe-client';

interface OpenAIModelFactory {
  (model: string): LanguageModel;
  chat(model: string): LanguageModel;
  responses(model: string): LanguageModel;
}

interface AnthropicModelFactory {
  (model: string): LanguageModel;
}

export interface ProviderRegistryState {
  config: RuntimeConfig;
  configPath: string;
}

function createOpenAIProvider(definition: ProviderDefinition): OpenAIModelFactory {
  return createOpenAI({
    apiKey: definition.apiKey,
    baseURL: definition.baseURL,
  }) as OpenAIModelFactory;
}

function createAnthropicProvider(definition: ProviderDefinition): AnthropicModelFactory {
  return createAnthropic({
    apiKey: definition.apiKey,
    baseURL: definition.baseURL,
  }) as AnthropicModelFactory;
}

export function createLanguageModel(
  definition: ProviderDefinition,
  model: string,
): LanguageModel {
  switch (definition.apiType) {
    case 'openai-chat': {
      const openai = createOpenAIProvider(definition);
      return openai.chat(model);
    }
    case 'openai-responses': {
      const openai = createOpenAIProvider(definition);
      return openai.responses(model);
    }
    case 'anthropic': {
      const anthropic = createAnthropicProvider(definition);
      return anthropic(model);
    }
    case 'poe': {
      return createPoeLanguageModel({
        model,
        apiKey: definition.apiKey,
        baseURL: definition.baseURL,
      });
    }
  }
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderDefinition>();
  private readonly modelCache = new Map<string, LanguageModel>();
  private runtimeConfig: RuntimeConfig | null = null;
  private configPath = '';

  register(definition: ProviderDefinition): void {
    providerApiTypeSchema.parse(definition.apiType);

    if (!definition.id.trim()) {
      throw new Error('Provider id is required');
    }

    this.providers.set(definition.id, {
      id: definition.id,
      apiType: definition.apiType,
      baseURL: definition.baseURL,
      apiKey: definition.apiKey,
    });
  }

  get(id: string): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  list(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  reload(config: RuntimeConfig): void {
    this.providers.clear();

    for (const definition of Object.values(config.providers)) {
      this.register(definition);
    }

    this.runtimeConfig = config;
    this.modelCache.clear();
  }

  setState(state: ProviderRegistryState): void {
    this.configPath = state.configPath;
    this.reload(state.config);
  }

  getState(): ProviderRegistryState {
    if (!this.runtimeConfig) {
      throw new Error('Provider registry failed to initialize runtime config');
    }

    return {
      config: this.runtimeConfig,
      configPath: this.configPath,
    };
  }

  getLanguageModel(
    providerId: string,
    model: string,
    overrides?: Partial<Pick<ProviderDefinition, 'apiKey' | 'baseURL'>>,
  ): LanguageModel {
    const definition = this.get(providerId);

    if (!definition) {
      throw new Error(`Provider '${providerId}' is not registered`);
    }

    const resolvedDefinition: ProviderDefinition = {
      ...definition,
      apiKey: overrides?.apiKey ?? definition.apiKey,
      baseURL: overrides?.baseURL ?? definition.baseURL,
    };
    const cacheKey = JSON.stringify([
      providerId,
      model,
      resolvedDefinition.baseURL ?? '',
      resolvedDefinition.apiKey,
      resolvedDefinition.apiType,
    ]);
    const cachedModel = this.modelCache.get(cacheKey);

    if (cachedModel) {
      return cachedModel;
    }

    const languageModel = createLanguageModel(resolvedDefinition, model);
    this.modelCache.set(cacheKey, languageModel);
    return languageModel;
  }

  reset(): void {
    this.providers.clear();
    this.modelCache.clear();
    this.runtimeConfig = null;
    this.configPath = '';
  }
}

export const providerRegistry = new ProviderRegistry();

let initialized = false;

function applyLoadedConfig(result: LoadConfigResult): LoadConfigResult {
  providerRegistry.setState({
    config: result.config,
    configPath: result.configPath,
  });
  initialized = true;
  return result;
}

export function initializeProviderRegistry(): LoadConfigResult {
  return applyLoadedConfig(loadConfig());
}

export function ensureProviderRegistryInitialized(): ProviderRegistryState {
  if (!initialized) {
    initializeProviderRegistry();
  }

  return providerRegistry.getState();
}

export function resetProviderRegistryForTests(): void {
  providerRegistry.reset();
  initialized = false;
}
