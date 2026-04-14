import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { AgentConfig, RuntimeConfig, RuntimeSectionConfig } from '../src/lib/config/schema';

interface RuntimeProviderConfig {
  apiType: string;
  apiKey: string;
  baseURL?: string;
}

interface RuntimeAgentConfig {
  provider: string;
  model: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  generation?: AgentConfig['generation'];
}

interface RuntimeConfigFixtureData {
  providers: Record<string, RuntimeProviderConfig>;
  agent: RuntimeAgentConfig;
  runtime?: RuntimeSectionConfig;
  mcp?: {
    servers: Record<string, Record<string, unknown>>;
  };
}

export interface RuntimeConfigFixture {
  configPath: string;
  dir: string;
}

export type RuntimeConfigFixtureOverrides = Partial<RuntimeConfig> & {
  providers?: Record<string, RuntimeProviderConfig>;
  agent?: RuntimeAgentConfig;
  runtime?: RuntimeSectionConfig;
  mcp?: {
    servers: Record<string, Record<string, unknown>>;
  };
};

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigFixtureData = {
  providers: {
    openai: {
      apiType: 'openai-chat',
      apiKey: '${OPENAI_API_KEY}',
    },
    anthropic: {
      apiType: 'anthropic',
      apiKey: '${ANTHROPIC_API_KEY}',
    },
    openrouter: {
      apiType: 'openai-chat',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '${OPENROUTER_API_KEY}',
    },
    poe: {
      apiType: 'poe',
      apiKey: '${POE_API_KEY}',
    },
  },
  agent: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
};

function mergeRuntimeConfig(overrides: RuntimeConfigFixtureOverrides = {}): RuntimeConfigFixtureData {
  return {
    providers: {
      ...DEFAULT_RUNTIME_CONFIG.providers,
      ...overrides.providers,
    },
    agent: {
      ...DEFAULT_RUNTIME_CONFIG.agent,
      ...overrides.agent,
    },
    ...(overrides.runtime ? { runtime: overrides.runtime } : {}),
    ...(overrides.mcp ? { mcp: overrides.mcp } : {}),
  };
}

export function writeRuntimeConfig(
  configPath: string,
  overrides: RuntimeConfigFixtureOverrides = {},
): void {
  const config = mergeRuntimeConfig(overrides);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function createRuntimeConfigFixture(
  prefix: string,
  overrides: RuntimeConfigFixtureOverrides = {},
): RuntimeConfigFixture {
  const dir = fs.mkdtempSync(path.join(tmpdir(), prefix));
  const configPath = path.join(dir, 'openclaw.json');
  writeRuntimeConfig(configPath, overrides);
  return { dir, configPath };
}

export function cleanupRuntimeConfigFixture(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
