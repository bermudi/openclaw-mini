import fs from 'fs';
import os from 'os';
import path from 'path';
import JSON5 from 'json5';
import { normalizeRuntimeConfig, runtimeConfigSchema, type RuntimeConfig } from '@/lib/config/schema';

export interface LoadConfigOptions {
  configPath?: string;
}

export interface LoadConfigResult {
  config: RuntimeConfig;
  configPath: string;
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

export function getConfigPath(): string {
  if (process.env.OPENCLAW_CONFIG_PATH?.trim()) {
    return process.env.OPENCLAW_CONFIG_PATH.trim();
  }

  const baseDirectory = process.env.OPENCLAW_CONFIG_DIR?.trim()
    || process.env.OPENCLAW_STATE_DIR?.trim()
    || path.join(os.homedir(), '.openclaw');

  return path.join(baseDirectory, 'openclaw.json');
}

function parseConfigFile(configPath: string): RuntimeConfig {
  const fileContents = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON5.parse(fileContents) as unknown;
  const substituted = substituteEnvVarsInApiKeys(parsed);
  const validated = runtimeConfigSchema.parse(substituted);
  return normalizeRuntimeConfig(validated);
}

function buildMissingConfigFileError(configPath: string): Error {
  return new Error(
    [
      `[provider-config] Missing runtime config file: ${configPath}`,
      'Create openclaw.json with providers and agent sections. Example:',
      '{',
      '  "providers": {',
      '    "openai": {',
      '      "apiType": "openai-chat",',
      '      "apiKey": "${OPENAI_API_KEY}"',
      '    }',
      '  },',
      '  "agent": {',
      '    "provider": "openai",',
      '    "model": "gpt-4.1-mini"',
      '  }',
      '}',
    ].join('\n'),
  );
}

export function loadConfig(options: LoadConfigOptions = {}): LoadConfigResult {
  const configPath = options.configPath ?? getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw buildMissingConfigFileError(configPath);
  }

  return {
    config: parseConfigFile(configPath),
    configPath,
  };
}
