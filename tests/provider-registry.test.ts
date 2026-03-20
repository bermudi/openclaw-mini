/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

mock.module('@ai-sdk/openai', () => ({
  createOpenAI: ({ baseURL, apiKey }: { baseURL?: string; apiKey?: string }) => {
    const provider = Object.assign(
      (model: string) => ({ provider: 'openai', mode: 'default', model, baseURL, apiKey }),
      {
        responses: (model: string) => ({ provider: 'openai', mode: 'responses', model, baseURL, apiKey }),
        chat: (model: string) => ({ provider: 'openai', mode: 'chat', model, baseURL, apiKey }),
      },
    );

    return provider;
  },
}));

mock.module('@ai-sdk/anthropic', () => ({
  createAnthropic: ({ baseURL, apiKey }: { baseURL?: string; apiKey?: string }) =>
    (model: string) => ({ provider: 'anthropic', model, baseURL, apiKey }),
}));

const ORIGINAL_ENV = { ...process.env };
const createdDirs = new Set<string>();

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-provider-registry-'));
  createdDirs.add(dir);
  return dir;
}

function writeConfig(configPath: string, content: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, content, 'utf-8');
}

beforeEach(() => {
  restoreEnv();
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.POE_API_KEY = 'poe-test-key';
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_DIR;
  delete process.env.OPENCLAW_STATE_DIR;
});

afterEach(async () => {
  const { stopWatchingConfig } = await import('../src/lib/config/watcher');
  stopWatchingConfig();
  restoreEnv();

  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  createdDirs.clear();
});

describe('loadConfig', () => {
  test('parses JSON5 config files with comments and validates the provider map', async () => {
    const configDir = createTempDir();
    const configPath = path.join(configDir, 'openclaw.json');
    writeConfig(configPath, `{
      // Provider config with comments
      providers: {
        openai: {
          apiType: 'openai-chat',
          apiKey: '\${OPENAI_API_KEY}',
        },
      },
      agent: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
      },
    }`);

    const { loadConfig } = await import('../src/lib/config/loader');
    const result = loadConfig({ configPath });

    expect(result.source).toBe('config-file');
    expect(result.config.agent.provider).toBe('openai');
    expect(result.config.providers.openai?.apiKey).toBe('openai-test-key');
  });

  test('falls back to environment variables when the config file is missing', async () => {
    process.env.AI_PROVIDER = 'poe';
    process.env.AI_MODEL = 'gpt-5-pro';
    process.env.AI_FALLBACK_MODEL = 'openai/gpt-4.1-mini';

    const { loadConfig } = await import('../src/lib/config/loader');
    const result = loadConfig({ configPath: path.join(createTempDir(), 'missing-openclaw.json') });

    expect(result.source).toBe('env');
    expect(result.config.agent.provider).toBe('poe');
    expect(result.config.agent.model).toBe('gpt-5-pro');
    expect(result.config.agent.fallbackProvider).toBe('openai');
    expect(result.config.agent.fallbackModel).toBe('gpt-4.1-mini');
    expect(result.config.providers.openrouter?.baseURL).toBe('https://openrouter.ai/api/v1');
  });

  test('rejects invalid config files unless startup fallback is enabled', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      providers: {
        openai: {
          apiType: 'openai-chat',
          apiKey: '\${OPENAI_API_KEY}',
        },
      },
      agent: {
        provider: 'missing',
        model: 'gpt-4.1-mini',
      },
    }`);
    process.env.AI_PROVIDER = 'openai';
    process.env.AI_MODEL = 'gpt-4.1-mini';

    const { loadConfig } = await import('../src/lib/config/loader');

    expect(() => loadConfig({ configPath })).toThrow("agent provider 'missing' is not defined in providers");

    const fallbackResult = loadConfig({
      configPath,
      fallbackToEnvOnFileError: true,
    });

    expect(fallbackResult.source).toBe('env');
    expect(fallbackResult.config.agent.provider).toBe('openai');
  });
});

describe('ProviderRegistry', () => {
  test('reload replaces providers and invalidates cached models', async () => {
    const { ProviderRegistry } = await import('../src/lib/services/provider-registry');
    const registry = new ProviderRegistry();

    registry.reload({
      providers: {
        openai: {
          id: 'openai',
          apiType: 'openai-chat',
          apiKey: 'openai-test-key',
        },
      },
      agent: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
      },
    });

    const firstModel = registry.getLanguageModel('openai', 'gpt-4.1-mini');
    const secondModel = registry.getLanguageModel('openai', 'gpt-4.1-mini');

    expect(firstModel).toBe(secondModel);
    expect(registry.get('openai')?.apiType).toBe('openai-chat');

    registry.reload({
      providers: {
        anthropic: {
          id: 'anthropic',
          apiType: 'anthropic',
          apiKey: 'anthropic-test-key',
        },
      },
      agent: {
        provider: 'anthropic',
        model: 'claude-haiku-4.5',
      },
    });

    expect(registry.get('openai')).toBeUndefined();
    expect(registry.list().map(provider => provider.id)).toEqual(['anthropic']);

    const reloadedModel = registry.getLanguageModel('anthropic', 'claude-haiku-4.5') as { provider?: string; model?: string };
    expect(reloadedModel.provider).toBe('anthropic');
    expect(reloadedModel.model).toBe('claude-haiku-4.5');
  });

  test('selects the correct SDK adapter for each supported apiType', async () => {
    const { ProviderRegistry } = await import('../src/lib/services/provider-registry');
    const registry = new ProviderRegistry();

    registry.reload({
      providers: {
        chat: {
          id: 'chat',
          apiType: 'openai-chat',
          apiKey: 'chat-key',
        },
        responses: {
          id: 'responses',
          apiType: 'openai-responses',
          apiKey: 'responses-key',
        },
        anthropic: {
          id: 'anthropic',
          apiType: 'anthropic',
          apiKey: 'anthropic-key',
        },
        poe: {
          id: 'poe',
          apiType: 'poe',
          apiKey: 'poe-key',
        },
      },
      agent: {
        provider: 'chat',
        model: 'gpt-4.1-mini',
      },
    });

    const chatModel = registry.getLanguageModel('chat', 'gpt-4.1-mini') as { provider?: string; mode?: string };
    const responsesModel = registry.getLanguageModel('responses', 'gpt-5-pro') as { provider?: string; mode?: string };
    const anthropicModel = registry.getLanguageModel('anthropic', 'claude-haiku-4.5') as { provider?: string; model?: string };
    const poeModel = registry.getLanguageModel('poe', 'gpt-5-pro') as { provider?: string; mode?: string };

    expect(chatModel.provider).toBe('openai');
    expect(chatModel.mode).toBe('chat');
    expect(responsesModel.provider).toBe('openai');
    expect(responsesModel.mode).toBe('responses');
    expect(anthropicModel.provider).toBe('anthropic');
    expect(anthropicModel.model).toBe('claude-haiku-4.5');
    expect(poeModel.provider).toBe('openai');
    expect(poeModel.mode).toBe('responses');
  });
});

describe('watchConfig', () => {
  test('reloads the provider registry after debounced config changes', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      providers: {
        openai: {
          apiType: 'openai-chat',
          apiKey: 'openai-test-key',
        },
      },
      agent: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
      },
    }`);

    process.env.OPENCLAW_CONFIG_PATH = configPath;

    const infoMessages: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      infoMessages.push(args.map(value => String(value)).join(' '));
    };

    const { watchConfig } = await import('../src/lib/config/watcher');
    const { initializeProviderRegistry, providerRegistry } = await import('../src/lib/services/provider-registry');

    initializeProviderRegistry();
    watchConfig({ configPath, debounceMs: 100 });

    writeConfig(configPath, `{
      providers: {
        anthropic: {
          apiType: 'anthropic',
          apiKey: 'anthropic-test-key',
        },
      },
      agent: {
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
      },
    }`);
    writeConfig(configPath, `{
      providers: {
        openrouter: {
          apiType: 'openai-chat',
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: 'openrouter-test-key',
        },
      },
      agent: {
        provider: 'openrouter',
        model: 'openai/gpt-4.1-mini',
      },
    }`);

    await Bun.sleep(350);

    console.info = originalInfo;

    const state = providerRegistry.getState();
    expect(state.config.agent.provider).toBe('openrouter');
    expect(state.config.agent.model).toBe('openai/gpt-4.1-mini');
    expect(infoMessages.filter(message => message.includes('Reloaded provider registry'))).toHaveLength(1);
  });
});
