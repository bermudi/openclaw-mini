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

interface MissingEnvVarError {
  providerId: string;
  envVarName: string;
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

function substituteEnvVarsInApiKeys(rawConfig: unknown): { config: unknown; missingEnvVars: MissingEnvVarError[] } {
  const missingEnvVars: MissingEnvVarError[] = [];

  if (!rawConfig || typeof rawConfig !== 'object') {
    return { config: rawConfig, missingEnvVars };
  }

  const config = rawConfig as {
    providers?: Record<string, { apiKey?: unknown }>;
  };

  if (!config.providers || typeof config.providers !== 'object') {
    return { config: rawConfig, missingEnvVars };
  }

  const clonedProviders = Object.entries(config.providers).reduce<Record<string, Record<string, unknown>>>((accumulator, [providerId, providerConfig]) => {
    const nextProviderConfig = { ...(providerConfig as Record<string, unknown>) };

    if (typeof nextProviderConfig.apiKey === 'string') {
      try {
        nextProviderConfig.apiKey = replaceApiKeyEnvReference(nextProviderConfig.apiKey, providerId);
      } catch (error) {
        const envVarMatch = error instanceof Error ? error.message.match(/environment variable '([A-Z0-9_]+)'/) : null;
        if (envVarMatch) {
          missingEnvVars.push({ providerId, envVarName: envVarMatch[1] });
        }
      }
    }

    accumulator[providerId] = nextProviderConfig;
    return accumulator;
  }, {});

  return {
    config: {
      ...(rawConfig as Record<string, unknown>),
      providers: clonedProviders,
    },
    missingEnvVars,
  };
}

function buildMissingEnvVarsError(missingEnvVars: MissingEnvVarError[]): Error {
  const details = missingEnvVars
    .map(({ providerId, envVarName }) => `  - Provider '${providerId}' needs ${envVarName}`)
    .join('\n');
  return new Error(`Multiple missing environment variables:\n${details}`);
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

function parseConfigFile(configPath: string): { config: RuntimeConfig; missingEnvVars: MissingEnvVarError[] } {
  const fileContents = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON5.parse(fileContents) as unknown;
  const { config: substituted, missingEnvVars } = substituteEnvVarsInApiKeys(parsed);
  const validated = runtimeConfigSchema.parse(substituted);
  return { config: normalizeRuntimeConfig(validated), missingEnvVars };
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

  const { config, missingEnvVars } = parseConfigFile(configPath);

  if (missingEnvVars.length > 0) {
    throw buildMissingEnvVarsError(missingEnvVars);
  }

  return {
    config,
    configPath,
  };
}
