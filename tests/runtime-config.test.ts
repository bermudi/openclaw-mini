/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

const ORIGINAL_ENV = { ...process.env };

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

function makeMinimalConfig(runtime?: object) {
  return {
    providers: {
      openai: { id: 'openai', apiType: 'openai-chat' as const, apiKey: 'test-key' },
    },
    agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    ...(runtime !== undefined ? { runtime } : {}),
  };
}

beforeEach(() => {
  restoreEnv();
  delete process.env.OPENCLAW_MAX_SPAWN_DEPTH;
  delete process.env.OPENCLAW_SUBAGENT_TIMEOUT;
  delete process.env.OPENCLAW_SESSION_TOKEN_THRESHOLD;
});

afterEach(async () => {
  const { resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetRuntimeWarningsForTests();
  resetProviderRegistryForTests();
  restoreEnv();
});

// ============================================================
// 8.1 - Schema validation
// ============================================================

describe('runtimeSectionSchema', () => {
  test('accepts a fully specified runtime section', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      safety: { subagentTimeout: 120, maxSpawnDepth: 2, maxIterations: 3, maxDeliveryRetries: 3 },
      retention: { tasks: 14, auditLogs: 30 },
      logging: { prisma: ['error'] },
      performance: {
        pollInterval: 3000,
        heartbeatInterval: 30000,
        deliveryBatchSize: 5,
        contextWindow: 64000,
        compactionThreshold: 0.7,
      },
    });

    expect(result.success).toBe(true);
  });

  test('accepts a partial runtime section (only safety)', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      safety: { subagentTimeout: 60 },
    });

    expect(result.success).toBe(true);
  });

  test('accepts an empty runtime section (all nested sections optional)', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  test('rejects a negative subagentTimeout', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      safety: { subagentTimeout: -1 },
    });

    expect(result.success).toBe(false);
  });

  test('rejects a zero maxSpawnDepth', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      safety: { maxSpawnDepth: 0 },
    });

    expect(result.success).toBe(false);
  });

  test('rejects compactionThreshold outside 0-1 range', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const belowZero = runtimeSectionSchema.safeParse({ performance: { compactionThreshold: -0.1 } });
    const aboveOne = runtimeSectionSchema.safeParse({ performance: { compactionThreshold: 1.5 } });

    expect(belowZero.success).toBe(false);
    expect(aboveOne.success).toBe(false);
  });

  test('rejects invalid prisma log levels', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      logging: { prisma: ['debug'] },
    });

    expect(result.success).toBe(false);
  });

  test('runtimeConfigSchema accepts config with runtime section', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      runtime: {
        safety: { subagentTimeout: 120 },
        performance: { pollInterval: 3000 },
      },
    });

    expect(result.success).toBe(true);
  });

  test('runtimeConfigSchema accepts config without runtime section', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    });

    expect(result.success).toBe(true);
  });
});

// ============================================================
// 8.2 - getRuntimeConfig() with defaults
// ============================================================

describe('getRuntimeConfig() defaults', () => {
  function setupRegistry(runtime?: object) {
    const { providerRegistry } = require('../src/lib/services/provider-registry');
    providerRegistry.reload(makeMinimalConfig(runtime));
    // mark as initialized
    const providerRegistryModule = require('../src/lib/services/provider-registry');
    providerRegistryModule.initialized = true;
  }

  test('returns all default values when no runtime section is configured', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.safety.subagentTimeout).toBe(300);
    expect(config.safety.maxSpawnDepth).toBe(3);
    expect(config.safety.maxIterations).toBe(5);
    expect(config.safety.maxDeliveryRetries).toBe(5);
    expect(config.retention.tasks).toBe(7);
    expect(config.retention.auditLogs).toBe(90);
    expect(config.logging.prisma).toEqual(['error', 'warn']);
    expect(config.performance.pollInterval).toBe(5000);
    expect(config.performance.heartbeatInterval).toBe(60000);
    expect(config.performance.deliveryBatchSize).toBe(10);
    expect(config.performance.contextWindow).toBe(128000);
    expect(config.performance.compactionThreshold).toBe(0.5);
  });

  test('returns configured values from runtime section when present', async () => {
    const runtimeSection = {
      safety: { subagentTimeout: 120, maxSpawnDepth: 2, maxIterations: 3, maxDeliveryRetries: 3 },
      retention: { tasks: 14, auditLogs: 30 },
      logging: { prisma: ['error'] as const },
      performance: {
        pollInterval: 3000,
        heartbeatInterval: 30000,
        deliveryBatchSize: 5,
        contextWindow: 64000,
        compactionThreshold: 0.7,
      },
    };

    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({
          config: makeMinimalConfig(runtimeSection),
          configPath: '/test',
        }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.safety.subagentTimeout).toBe(120);
    expect(config.safety.maxSpawnDepth).toBe(2);
    expect(config.safety.maxIterations).toBe(3);
    expect(config.safety.maxDeliveryRetries).toBe(3);
    expect(config.retention.tasks).toBe(14);
    expect(config.retention.auditLogs).toBe(30);
    expect(config.logging.prisma).toEqual(['error']);
    expect(config.performance.pollInterval).toBe(3000);
    expect(config.performance.heartbeatInterval).toBe(30000);
    expect(config.performance.deliveryBatchSize).toBe(5);
    expect(config.performance.contextWindow).toBe(64000);
    expect(config.performance.compactionThreshold).toBe(0.7);
  });

  test('fills in defaults for missing nested sections', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({
          config: makeMinimalConfig({ safety: { subagentTimeout: 60 } }),
          configPath: '/test',
        }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.safety.subagentTimeout).toBe(60);
    expect(config.safety.maxSpawnDepth).toBe(3);
    expect(config.retention.tasks).toBe(7);
    expect(config.performance.pollInterval).toBe(5000);
  });
});

// ============================================================
// 8.3 - Deprecation warnings
// ============================================================

describe('getRuntimeConfig() deprecation warnings', () => {
  test('emits deprecation warning for OPENCLAW_MAX_SPAWN_DEPTH', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_MAX_SPAWN_DEPTH = '5';

    const warnSpy = spyOn(console, 'warn');
    getRuntimeConfig();

    const warnings = warnSpy.mock.calls.map(call => call[0] as string);
    expect(warnings.some(w => w.includes('OPENCLAW_MAX_SPAWN_DEPTH'))).toBe(true);
    expect(warnings.some(w => w.includes('runtime.safety.maxSpawnDepth'))).toBe(true);

    warnSpy.mockRestore();
  });

  test('uses OPENCLAW_MAX_SPAWN_DEPTH value as fallback when not in config', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_MAX_SPAWN_DEPTH = '7';

    const config = getRuntimeConfig();
    expect(config.safety.maxSpawnDepth).toBe(7);
  });

  test('emits deprecation warning for OPENCLAW_SUBAGENT_TIMEOUT', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_SUBAGENT_TIMEOUT = '600';

    const warnSpy = spyOn(console, 'warn');
    getRuntimeConfig();

    const warnings = warnSpy.mock.calls.map(call => call[0] as string);
    expect(warnings.some(w => w.includes('OPENCLAW_SUBAGENT_TIMEOUT'))).toBe(true);
    expect(warnings.some(w => w.includes('runtime.safety.subagentTimeout'))).toBe(true);

    warnSpy.mockRestore();
  });

  test('uses OPENCLAW_SUBAGENT_TIMEOUT value as fallback when not in config', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_SUBAGENT_TIMEOUT = '600';

    const config = getRuntimeConfig();
    expect(config.safety.subagentTimeout).toBe(600);
  });

  test('emits deprecation warning for OPENCLAW_SESSION_TOKEN_THRESHOLD', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_SESSION_TOKEN_THRESHOLD = '0.8';

    const warnSpy = spyOn(console, 'warn');
    getRuntimeConfig();

    const warnings = warnSpy.mock.calls.map(call => call[0] as string);
    expect(warnings.some(w => w.includes('OPENCLAW_SESSION_TOKEN_THRESHOLD'))).toBe(true);
    expect(warnings.some(w => w.includes('runtime.performance.compactionThreshold'))).toBe(true);

    warnSpy.mockRestore();
  });

  test('uses OPENCLAW_SESSION_TOKEN_THRESHOLD as fallback when not in config', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_SESSION_TOKEN_THRESHOLD = '0.8';

    const config = getRuntimeConfig();
    expect(config.performance.compactionThreshold).toBe(0.8);
  });

  test('config file value takes precedence over env var', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({
          config: makeMinimalConfig({ safety: { subagentTimeout: 120 } }),
          configPath: '/test',
        }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_SUBAGENT_TIMEOUT = '999';

    const config = getRuntimeConfig();
    expect(config.safety.subagentTimeout).toBe(120);
  });

  test('deprecation warning is emitted only once per env var', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_MAX_SPAWN_DEPTH = '5';

    const warnSpy = spyOn(console, 'warn');
    getRuntimeConfig();
    getRuntimeConfig();
    getRuntimeConfig();

    const maxDepthWarnings = warnSpy.mock.calls.filter(
      call => (call[0] as string).includes('OPENCLAW_MAX_SPAWN_DEPTH'),
    );
    expect(maxDepthWarnings).toHaveLength(1);

    warnSpy.mockRestore();
  });
});

// ============================================================
// 8.4 - Exec config section
// ============================================================

describe('runtimeSectionSchema exec section', () => {
  test('accepts a fully specified exec section', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: {
        enabled: true,
        allowlist: ['cat', 'ls', 'grep'],
        maxTimeout: 60,
        maxOutputSize: 50000,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exec?.enabled).toBe(true);
      expect(result.data.exec?.allowlist).toEqual(['cat', 'ls', 'grep']);
      expect(result.data.exec?.maxTimeout).toBe(60);
      expect(result.data.exec?.maxOutputSize).toBe(50000);
    }
  });

  test('accepts a partial exec section (all fields optional)', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: { enabled: true },
    });

    expect(result.success).toBe(true);
  });

  test('accepts an empty exec section', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: {},
    });

    expect(result.success).toBe(true);
  });

  test('rejects non-boolean enabled field', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: { enabled: 'yes' },
    });

    expect(result.success).toBe(false);
  });

  test('rejects non-string items in allowlist', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: { allowlist: ['cat', 123] },
    });

    expect(result.success).toBe(false);
  });

  test('rejects empty strings in allowlist', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: { allowlist: ['cat', ''] },
    });

    expect(result.success).toBe(false);
  });

  test('rejects negative maxTimeout', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: { maxTimeout: -5 },
    });

    expect(result.success).toBe(false);
  });

  test('rejects zero maxTimeout', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: { maxTimeout: 0 },
    });

    expect(result.success).toBe(false);
  });

  test('rejects negative maxOutputSize', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: { maxOutputSize: -100 },
    });

    expect(result.success).toBe(false);
  });

  test('rejects zero maxOutputSize', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: { maxOutputSize: 0 },
    });

    expect(result.success).toBe(false);
  });
});

describe('runtimeConfigSchema search section', () => {
  test('accepts config with valid search API keys', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      search: {
        braveApiKey: 'brave-key',
        tavilyApiKey: 'tavily-key',
      },
    });

    expect(result.success).toBe(true);
  });

  test('accepts config with empty search section', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      search: {},
    });

    expect(result.success).toBe(true);
  });

  test('accepts config with missing search section', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    });

    expect(result.success).toBe(true);
  });
});

describe('getRuntimeConfig() exec defaults', () => {
  test('returns default exec values when no exec section is configured', async () => {
    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({ config: makeMinimalConfig(), configPath: '/test' }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.exec.enabled).toBe(false);
    expect(config.exec.allowlist).toEqual([]);
    expect(config.exec.maxTimeout).toBe(30);
    expect(config.exec.maxOutputSize).toBe(10000);
  });

  test('returns configured exec values from runtime section', async () => {
    const runtimeSection = {
      exec: {
        enabled: true,
        allowlist: ['cat', 'ls', 'grep'],
        maxTimeout: 60,
        maxOutputSize: 50000,
      },
    };

    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({
          config: makeMinimalConfig(runtimeSection),
          configPath: '/test',
        }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.exec.enabled).toBe(true);
    expect(config.exec.allowlist).toEqual(['cat', 'ls', 'grep']);
    expect(config.exec.maxTimeout).toBe(60);
    expect(config.exec.maxOutputSize).toBe(50000);
  });

  test('fills in defaults for partial exec section', async () => {
    const runtimeSection = {
      exec: { enabled: true },
    };

    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({
          config: makeMinimalConfig(runtimeSection),
          configPath: '/test',
        }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.exec.enabled).toBe(true);
    expect(config.exec.allowlist).toEqual([]);
    expect(config.exec.maxTimeout).toBe(30);
    expect(config.exec.maxOutputSize).toBe(10000);
  });

  test('uses defaults for missing allowlist', async () => {
    const runtimeSection = {
      exec: { enabled: true, maxTimeout: 120 },
    };

    mock.module('../src/lib/services/provider-registry', () => ({
      providerRegistry: {
        getState: () => ({
          config: makeMinimalConfig(runtimeSection),
          configPath: '/test',
        }),
      },
      resetProviderRegistryForTests: () => {},
    }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.exec.enabled).toBe(true);
    expect(config.exec.allowlist).toEqual([]);
    expect(config.exec.maxTimeout).toBe(120);
    expect(config.exec.maxOutputSize).toBe(10000);
  });
});
