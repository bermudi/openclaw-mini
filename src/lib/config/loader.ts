import fs from 'fs';
import os from 'os';
import path from 'path';
import JSON5 from 'json5';
import { normalizeRuntimeConfig, runtimeConfigSchema, type ProviderApiType, type RuntimeConfig } from '@/lib/config/schema';

export type RuntimeConfigSource = 'config-file' | 'env';

export interface LoadConfigOptions {
  configPath?: string;
  fallbackToEnvOnFileError?: boolean;
}

export interface LoadConfigResult {
  config: RuntimeConfig;
  configPath: string;
  source: RuntimeConfigSource;
}

const LEGACY_PROVIDER_IDS = ['openai', 'anthropic', 'openrouter', 'ollama', 'poe'] as const;

const warnedDeprecations = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedDeprecations.has(key)) {
    return;
  }

  warnedDeprecations.add(key);
  console.warn(message);
}

function replaceApiKeyEnvReference(apiKey: string, providerId: string): string {
  const match = apiKey.trim().match(/^\$\{([A-Z0-9_]+)\}$/);
  if (!match) {
    return apiKey;
  }

  const envVarName = match[1];
  const value = process.env[envVarName];

  if (!value) {
    throw new Error(`Provider '${providerId}' references missing environment variable '${envVarName}' in apiKey`);
  }

  return value;
}

function substituteEnvVarsInApiKeys(rawConfig: unknown): unknown {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return rawConfig;
  }

  const config = rawConfig as {
    providers?: Record<string, { apiKey?: unknown }>;
  };

  if (!config.providers || typeof config.providers !== 'object') {
    return rawConfig;
  }

  const clonedProviders = Object.entries(config.providers).reduce<Record<string, Record<string, unknown>>>((accumulator, [providerId, providerConfig]) => {
    const nextProviderConfig = { ...(providerConfig as Record<string, unknown>) };

    if (typeof nextProviderConfig.apiKey === 'string') {
      nextProviderConfig.apiKey = replaceApiKeyEnvReference(nextProviderConfig.apiKey, providerId);
    }

    accumulator[providerId] = nextProviderConfig;
    return accumulator;
  }, {});

  return {
    ...(rawConfig as Record<string, unknown>),
    providers: clonedProviders,
  };
}

function getProviderApiType(providerId: string): ProviderApiType {
  switch (providerId) {
    case 'openai':
    case 'ollama':
    case 'openrouter':
      return 'openai-chat';
    case 'anthropic':
      return 'anthropic';
    case 'poe':
      return 'poe';
    default:
      return 'openai-chat';
  }
}

function getDefaultProviderBaseUrl(providerId: string): string | undefined {
  switch (providerId) {
    case 'ollama':
      return 'http://localhost:11434/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'poe':
      return 'https://api.poe.com';
    default:
      return undefined;
  }
}

function getDefaultProviderApiKey(providerId: string): string {
  switch (providerId) {
    case 'openai':
      return process.env.OPENAI_API_KEY ?? '';
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY ?? '';
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY ?? '';
    case 'ollama':
      return 'ollama';
    case 'poe':
      return process.env.POE_API_KEY ?? '';
    default:
      return '';
  }
}

function parseDeprecatedFallbackModel(value: string | undefined): Pick<RuntimeConfig['agent'], 'fallbackProvider' | 'fallbackModel'> {
  if (!value) {
    return {};
  }

  const [providerValue, ...modelParts] = value.split('/');
  const fallbackProvider = providerValue?.trim();
  const fallbackModel = modelParts.join('/').trim();

  if (!fallbackProvider || fallbackModel.length === 0) {
    throw new Error('AI_FALLBACK_MODEL must use provider/model format');
  }

  return {
    fallbackProvider,
    fallbackModel,
  };
}

function warnEnvVarDeprecations(): void {
  const deprecatedEnvVars = [
    'AI_PROVIDER',
    'AI_MODEL',
    'AI_BASE_URL',
    'AI_FALLBACK_MODEL',
  ].filter(envVarName => process.env[envVarName]);

  if (deprecatedEnvVars.length === 0) {
    return;
  }

  warnOnce(
    'runtime-provider-config-env-vars',
    `[provider-config] Using deprecated environment variable configuration (${deprecatedEnvVars.join(', ')}). Migrate to openclaw.json.`,
  );
}

export function getConfigPath(): string {
  if (process.env.OPENCLAW_CONFIG_PATH?.trim()) {
    return process.env.OPENCLAW_CONFIG_PATH.trim();
  }

  const baseDirectory = process.env.OPENCLAW_CONFIG_DIR?.trim()
    || process.env.OPENCLAW_STATE_DIR?.trim()
    || path.join(os.homedir(), '.openclaw');

  return path.join(baseDirectory, 'openclaw.json');
}

export function generateConfigFromEnvVars(): RuntimeConfig {
  warnEnvVarDeprecations();

  const provider = process.env.AI_PROVIDER?.trim() || 'openai';
  const model = process.env.AI_MODEL?.trim() || 'gpt-4.1-mini';
  const baseURL = process.env.AI_BASE_URL?.trim() || undefined;
  const fallback = parseDeprecatedFallbackModel(process.env.AI_FALLBACK_MODEL);
  const providerIds = new Set<string>([
    ...LEGACY_PROVIDER_IDS,
    provider,
    ...(fallback.fallbackProvider ? [fallback.fallbackProvider] : []),
  ]);

  const providers = Array.from(providerIds).reduce<RuntimeConfig['providers']>((accumulator, providerId) => {
    accumulator[providerId] = {
      id: providerId,
      apiType: getProviderApiType(providerId),
      baseURL: providerId === provider ? (baseURL ?? getDefaultProviderBaseUrl(providerId)) : getDefaultProviderBaseUrl(providerId),
      apiKey: getDefaultProviderApiKey(providerId),
    };
    return accumulator;
  }, {});

  return {
    providers,
    agent: {
      provider,
      model,
      fallbackProvider: fallback.fallbackProvider,
      fallbackModel: fallback.fallbackModel,
    },
  };
}

function parseConfigFile(configPath: string): RuntimeConfig {
  const fileContents = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON5.parse(fileContents) as unknown;
  const substituted = substituteEnvVarsInApiKeys(parsed);
  const validated = runtimeConfigSchema.parse(substituted);
  return normalizeRuntimeConfig(validated);
}

export function loadConfig(options: LoadConfigOptions = {}): LoadConfigResult {
  const configPath = options.configPath ?? getConfigPath();

  if (!fs.existsSync(configPath)) {
    return {
      config: generateConfigFromEnvVars(),
      configPath,
      source: 'env',
    };
  }

  try {
    return {
      config: parseConfigFile(configPath),
      configPath,
      source: 'config-file',
    };
  } catch (error) {
    if (!options.fallbackToEnvOnFileError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[provider-config] Failed to load ${configPath}: ${message}. Falling back to deprecated environment variables.`);
    return {
      config: generateConfigFromEnvVars(),
      configPath,
      source: 'env',
    };
  }
}
