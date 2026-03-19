/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

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
const HAS_REAL_POE_API_KEY = Boolean(ORIGINAL_ENV.POE_API_KEY);

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

beforeEach(() => {
  restoreEnv();
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  process.env.POE_API_KEY = 'poe-test-key';
  process.env.AI_PROVIDER = 'openai';
  process.env.AI_MODEL = 'gpt-4.1-mini';
  delete process.env.AI_BASE_URL;
  delete process.env.AI_FALLBACK_MODEL;
});

afterEach(() => {
  restoreEnv();
});

describe('poeEndpointForModel', () => {
  test('routes claude models to the anthropic endpoint', async () => {
    const { poeEndpointForModel } = await import('../src/lib/services/poe-client');

    expect(poeEndpointForModel('claude-opus-4.6')).toBe('anthropic');
    expect(poeEndpointForModel('Claude-Sonnet-4.5')).toBe('anthropic');
  });

  test('routes OpenAI reasoning families to the responses endpoint', async () => {
    const { poeEndpointForModel } = await import('../src/lib/services/poe-client');

    expect(poeEndpointForModel('gpt-5-pro')).toBe('responses');
    expect(poeEndpointForModel('o3')).toBe('responses');
    expect(poeEndpointForModel('o4-mini')).toBe('responses');
  });

  test('routes other model families to chat completions', async () => {
    const { poeEndpointForModel } = await import('../src/lib/services/poe-client');

    expect(poeEndpointForModel('grok-4')).toBe('chat-completions');
    expect(poeEndpointForModel('gemini-2.5-pro')).toBe('chat-completions');
  });
});

describe('ModelCatalog', () => {
  test('caches results within the TTL window', async () => {
    const responses = [
      {
        data: [
          {
            id: 'claude-opus-4.6',
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            supported_features: ['tools'],
            context_window: { context_length: 300000 },
          },
        ],
      },
      {
        data: [
          {
            id: 'gpt-5-pro',
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            supported_features: ['web_search'],
            context_window: { context_length: 400000 },
          },
        ],
      },
    ];
    let fetchCount = 0;

    const { ModelCatalog } = await import('../src/lib/services/model-catalog');
    const fetchImpl = (async () => {
      const payload = responses[Math.min(fetchCount, responses.length - 1)];
      fetchCount += 1;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const catalog = new ModelCatalog({
      ttlMs: 60_000,
      fetchImpl,
    });

    const first = await catalog.refresh();
    const second = await catalog.refresh();

    expect(fetchCount).toBe(1);
    expect(first.models[0]?.id).toBe('claude-opus-4.6');
    expect(second.models[0]?.id).toBe('claude-opus-4.6');
  });

  test('filters models by declared capabilities and sorts newer versions first', async () => {
    const { ModelCatalog } = await import('../src/lib/services/model-catalog');
    const fetchImpl = (async () =>
      new Response(JSON.stringify({
        data: [
          {
            id: 'claude-sonnet-4.5',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_features: ['tools'],
            context_window: { context_length: 200000 },
          },
          {
            id: 'claude-opus-4.6',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_features: ['tools', 'web_search', 'extended_thinking'],
            reasoning: { level: 'high' },
            context_window: { context_length: 300000 },
          },
          {
            id: 'grok-4',
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            supported_features: [],
            context_window: { context_length: 128000 },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    const catalog = new ModelCatalog({
      fetchImpl,
    });

    await catalog.refresh(true);

    const visionAndTools = catalog.getModels({ capabilities: ['vision', 'tools'] });
    const reasoning = catalog.getModels({ capabilities: ['reasoning'] });
    const webSearch = catalog.getModels({ capabilities: ['web-search'] });

    expect(visionAndTools.map(model => model.id)).toEqual(['claude-opus-4.6', 'claude-sonnet-4.5']);
    expect(reasoning.map(model => model.id)).toEqual(['claude-opus-4.6']);
    expect(webSearch.map(model => model.id)).toEqual(['claude-opus-4.6']);
    expect(catalog.getContextWindowSize('claude-opus-4.6')).toBe(300000);
  });
});

describe('model fallback', () => {
  test('returns the primary result when no failure occurs', async () => {
    const { runWithModelFallback } = await import('../src/lib/services/model-provider');

    const result = await runWithModelFallback(async ({ config, isFallback }) => ({
      provider: config.provider,
      model: config.model,
      isFallback,
    }));

    expect(result).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      isFallback: false,
    });
  });

  test('retries with the configured fallback on retryable failures', async () => {
    process.env.AI_PROVIDER = 'poe';
    process.env.AI_MODEL = 'gpt-5-pro';
    process.env.AI_FALLBACK_MODEL = 'openai/gpt-4.1-mini';

    const { runWithModelFallback } = await import('../src/lib/services/model-provider');
    const attemptedModels: string[] = [];

    const result = await runWithModelFallback(async ({ config, isFallback }) => {
      attemptedModels.push(`${config.provider}/${config.model}`);

      if (!isFallback) {
        const error = new Error('rate limited');
        Object.assign(error, { status: 429 });
        throw error;
      }

      return `${config.provider}/${config.model}`;
    });

    expect(attemptedModels).toEqual(['poe/gpt-5-pro', 'openai/gpt-4.1-mini']);
    expect(result).toBe('openai/gpt-4.1-mini');
  });

  test('does not retry on non-retryable failures', async () => {
    process.env.AI_FALLBACK_MODEL = 'poe/claude-opus-4.6';

    const { runWithModelFallback } = await import('../src/lib/services/model-provider');
    const attemptedModels: string[] = [];

    await expect(runWithModelFallback(async ({ config }) => {
      attemptedModels.push(`${config.provider}/${config.model}`);
      const error = new Error('bad request');
      Object.assign(error, { status: 400 });
      throw error;
    })).rejects.toThrow('bad request');

    expect(attemptedModels).toEqual(['openai/gpt-4.1-mini']);
  });

  test('surfaces both errors when primary and fallback fail', async () => {
    process.env.AI_FALLBACK_MODEL = 'anthropic/claude-haiku-4.5';

    const { runWithModelFallback } = await import('../src/lib/services/model-provider');

    await expect(runWithModelFallback(async ({ isFallback }) => {
      const error = new Error(isFallback ? 'fallback failed' : 'primary failed');
      Object.assign(error, { status: isFallback ? 401 : 503 });
      throw error;
    })).rejects.toThrow('Fallback model anthropic/claude-haiku-4.5 also failed');
  });
});

describe('poe provider integration', () => {
  const poeTest = HAS_REAL_POE_API_KEY ? test : test.skip;

  poeTest('creates a Poe language model with the configured API key', async () => {
    const { getLanguageModel, resolveModelConfig } = await import('../src/lib/services/model-provider');

    const config = resolveModelConfig({
      provider: 'poe',
      model: 'gpt-5-pro',
    });
    const model = getLanguageModel(config) as { provider?: string; mode?: string; baseURL?: string; apiKey?: string };

    expect(config.apiKey).toBe(process.env.POE_API_KEY);
    expect(model.provider).toBe('openai');
    expect(model.mode).toBe('responses');
    expect(model.baseURL).toBe('https://api.poe.com/v1');
  });
});
