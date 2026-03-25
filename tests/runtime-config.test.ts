/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

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

function makeMinimalConfig(runtime?: object, extra?: Record<string, unknown>) {
  return {
    providers: {
      openai: { id: 'openai', apiType: 'openai-chat' as const, apiKey: 'test-key' },
    },
    agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    ...(runtime !== undefined ? { runtime } : {}),
    ...(extra ?? {}),
  };
}

async function setProviderRegistryState(config: ReturnType<typeof makeMinimalConfig> = makeMinimalConfig()): Promise<void> {
  const { setProviderRegistryStateForTests } = await import('../src/lib/services/provider-registry');
  setProviderRegistryStateForTests({ config, configPath: '/test' });
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
  const { resetExecRuntimeStateForTests } = await import('../src/lib/services/exec-runtime');
  resetRuntimeWarningsForTests();
  resetProviderRegistryForTests();
  resetExecRuntimeStateForTests();
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
  test('returns all default values when no runtime section is configured', async () => {
    await setProviderRegistryState();

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

    await setProviderRegistryState(makeMinimalConfig(runtimeSection));

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
    await setProviderRegistryState(makeMinimalConfig({ safety: { subagentTimeout: 60 } }));

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
    await setProviderRegistryState();

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
    await setProviderRegistryState();

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_MAX_SPAWN_DEPTH = '7';

    const config = getRuntimeConfig();
    expect(config.safety.maxSpawnDepth).toBe(7);
  });

  test('emits deprecation warning for OPENCLAW_SUBAGENT_TIMEOUT', async () => {
    await setProviderRegistryState();

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
    await setProviderRegistryState();

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_SUBAGENT_TIMEOUT = '600';

    const config = getRuntimeConfig();
    expect(config.safety.subagentTimeout).toBe(600);
  });

  test('emits deprecation warning for OPENCLAW_SESSION_TOKEN_THRESHOLD', async () => {
    await setProviderRegistryState();

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
    await setProviderRegistryState();

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_SESSION_TOKEN_THRESHOLD = '0.8';

    const config = getRuntimeConfig();
    expect(config.performance.compactionThreshold).toBe(0.8);
  });

  test('config file value takes precedence over env var', async () => {
    await setProviderRegistryState(makeMinimalConfig({ safety: { subagentTimeout: 120 } }));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    process.env.OPENCLAW_SUBAGENT_TIMEOUT = '999';

    const config = getRuntimeConfig();
    expect(config.safety.subagentTimeout).toBe(120);
  });

  test('deprecation warning is emitted only once per env var', async () => {
    await setProviderRegistryState();

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
        defaultTier: 'host',
        maxTier: 'host',
        containerRuntime: 'docker',
        mounts: [
          {
            alias: 'workspace',
            hostPath: '/tmp/workspace',
            permissions: 'read-write',
            createIfMissing: true,
          },
        ],
        maxTimeout: 60,
        maxOutputSize: 50000,
        maxSessions: 4,
        sessionTimeout: 900,
        sessionBufferSize: 250000,
        foregroundYieldMs: 1500,
        defaultLaunchMode: 'pty',
        defaultBackground: true,
        ptyCols: 180,
        ptyRows: 50,
        forcePtyFallback: true,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exec?.enabled).toBe(true);
      expect(result.data.exec?.allowlist).toEqual(['cat', 'ls', 'grep']);
      expect(result.data.exec?.defaultTier).toBe('host');
      expect(result.data.exec?.maxTier).toBe('host');
      expect(result.data.exec?.containerRuntime).toBe('docker');
      expect(result.data.exec?.mounts).toEqual([
        {
          alias: 'workspace',
          hostPath: '/tmp/workspace',
          permissions: 'read-write',
          createIfMissing: true,
        },
      ]);
      expect(result.data.exec?.maxTimeout).toBe(60);
      expect(result.data.exec?.maxOutputSize).toBe(50000);
      expect(result.data.exec?.maxSessions).toBe(4);
      expect(result.data.exec?.sessionTimeout).toBe(900);
      expect(result.data.exec?.sessionBufferSize).toBe(250000);
      expect(result.data.exec?.foregroundYieldMs).toBe(1500);
      expect(result.data.exec?.defaultLaunchMode).toBe('pty');
      expect(result.data.exec?.defaultBackground).toBe(true);
      expect(result.data.exec?.ptyCols).toBe(180);
      expect(result.data.exec?.ptyRows).toBe(50);
      expect(result.data.exec?.forcePtyFallback).toBe(true);
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

  test('rejects defaultTier that is more privileged than maxTier', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const result = runtimeSectionSchema.safeParse({
      exec: {
        defaultTier: 'host',
        maxTier: 'sandbox',
      },
    });

    expect(result.success).toBe(false);
  });

  test('rejects duplicate mount aliases and reserved sandbox alias', async () => {
    const { runtimeSectionSchema } = await import('../src/lib/config/schema');

    const duplicateAlias = runtimeSectionSchema.safeParse({
      exec: {
        mounts: [
          { alias: 'workspace', hostPath: '/tmp/a', permissions: 'read-only' },
          { alias: 'workspace', hostPath: '/tmp/b', permissions: 'read-write' },
        ],
      },
    });

    const reservedAlias = runtimeSectionSchema.safeParse({
      exec: {
        mounts: [
          { alias: 'sandbox', hostPath: '/tmp/a', permissions: 'read-only' },
        ],
      },
    });

    expect(duplicateAlias.success).toBe(false);
    expect(reservedAlias.success).toBe(false);
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

describe('runtimeConfigSchema browser section', () => {
  test('accepts config with valid browser settings', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      browser: {
        headless: false,
        viewport: { width: 1920, height: 1080 },
        navigationTimeout: 45000,
      },
    });

    expect(result.success).toBe(true);
  });

  test('accepts config without browser section', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    });

    expect(result.success).toBe(true);
  });

  test('applies browser defaults for partial config', async () => {
    await setProviderRegistryState(makeMinimalConfig(undefined, {
      browser: { headless: false },
    }));

    const { getBrowserConfig } = await import('../src/lib/config/runtime');
    const config = getBrowserConfig();

    expect(config.headless).toBe(false);
    expect(config.viewport).toEqual({ width: 1280, height: 720 });
    expect(config.navigationTimeout).toBe(30000);
  });

  test('returns browser defaults when config omits browser section', async () => {
    await setProviderRegistryState();

    const { getBrowserConfig } = await import('../src/lib/config/runtime');
    const config = getBrowserConfig();

    expect(config).toEqual({
      headless: true,
      viewport: { width: 1280, height: 720 },
      navigationTimeout: 30000,
    });
  });

  test('rejects invalid browser viewport values', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      browser: {
        viewport: { width: 0, height: 720 },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('runtimeConfigSchema mcp section', () => {
  test('accepts stdio MCP server config', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      mcp: {
        servers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_TOKEN: '$GITHUB_TOKEN' },
            description: 'GitHub API operations',
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test('accepts HTTP MCP server config', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      mcp: {
        servers: {
          api: {
            url: 'http://localhost:3001/mcp',
            headers: { Authorization: 'Bearer $TOKEN' },
            description: 'Custom API server',
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test('rejects MCP server with both command and url', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      mcp: {
        servers: {
          invalid: {
            command: 'npx',
            url: 'http://localhost:3001/mcp',
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test('rejects MCP server with neither command nor url', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      mcp: {
        servers: {
          invalid: {
            description: 'broken',
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test('accepts empty mcp.servers object', async () => {
    const { runtimeConfigSchema } = await import('../src/lib/config/schema');

    const result = runtimeConfigSchema.safeParse({
      providers: {
        openai: { apiType: 'openai-chat', apiKey: 'test-key' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      mcp: { servers: {} },
    });

    expect(result.success).toBe(true);
  });

  test('accepts missing mcp section and getMcpServers returns empty record', async () => {
    await setProviderRegistryState();

    const { getMcpServers } = await import('../src/lib/config/runtime');

    expect(getMcpServers()).toEqual({});
  });

  test('getMcpServers returns configured servers', async () => {
    await setProviderRegistryState(makeMinimalConfig(undefined, {
      mcp: {
        servers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            description: 'GitHub API operations',
          },
          api: {
            url: 'http://localhost:3001/mcp',
            description: 'Custom API server',
          },
        },
      },
    }));

    const { getMcpServers } = await import('../src/lib/config/runtime');

    expect(getMcpServers()).toEqual({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        description: 'GitHub API operations',
      },
      api: {
        url: 'http://localhost:3001/mcp',
        description: 'Custom API server',
      },
    });
  });
});

describe('getRuntimeConfig() exec defaults', () => {
  test('returns default exec values when no exec section is configured', async () => {
    await setProviderRegistryState();

    const { setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');
    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    setDetectedContainerRuntimeForTests(null);
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.exec.enabled).toBe(false);
    expect(config.exec.allowlist).toEqual([]);
    expect(config.exec.defaultTier).toBe('host');
    expect(config.exec.maxTier).toBe('host');
    expect(config.exec.containerRuntime).toBeNull();
    expect(config.exec.mounts).toEqual([]);
    expect(config.exec.maxTimeout).toBe(30);
    expect(config.exec.maxOutputSize).toBe(10000);
    expect(config.exec.maxSessions).toBe(8);
    expect(config.exec.sessionTimeout).toBe(300);
    expect(config.exec.sessionBufferSize).toBe(100000);
    expect(config.exec.foregroundYieldMs).toBe(1000);
    expect(config.exec.defaultLaunchMode).toBe('child');
    expect(config.exec.defaultBackground).toBe(false);
    expect(config.exec.ptyCols).toBe(120);
    expect(config.exec.ptyRows).toBe(30);
    expect(config.exec.forcePtyFallback).toBe(false);
  });

  test('returns configured exec values from runtime section', async () => {
    const runtimeSection = {
      exec: {
        enabled: true,
        allowlist: ['cat', 'ls', 'grep'],
        defaultTier: 'sandbox' as const,
        maxTier: 'host' as const,
        containerRuntime: 'podman' as const,
        mounts: [
          {
            alias: 'workspace',
            hostPath: '/tmp/workspace',
            permissions: 'read-write' as const,
            createIfMissing: true,
          },
        ],
        maxTimeout: 60,
        maxOutputSize: 50000,
        maxSessions: 2,
        sessionTimeout: 120,
        sessionBufferSize: 32000,
        foregroundYieldMs: 1400,
        defaultLaunchMode: 'pty' as const,
        defaultBackground: true,
        ptyCols: 160,
        ptyRows: 44,
        forcePtyFallback: true,
      },
    };

    await setProviderRegistryState(makeMinimalConfig(runtimeSection));

    const { setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');
    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    setDetectedContainerRuntimeForTests('podman');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.exec.enabled).toBe(true);
    expect(config.exec.allowlist).toEqual(['cat', 'ls', 'grep']);
    expect(config.exec.defaultTier).toBe('sandbox');
    expect(config.exec.maxTier).toBe('host');
    expect(config.exec.containerRuntime).toBe('podman');
    expect(config.exec.mounts).toEqual([
      {
        alias: 'workspace',
        hostPath: '/tmp/workspace',
        permissions: 'read-write',
        createIfMissing: true,
      },
    ]);
    expect(config.exec.maxTimeout).toBe(60);
    expect(config.exec.maxOutputSize).toBe(50000);
    expect(config.exec.maxSessions).toBe(2);
    expect(config.exec.sessionTimeout).toBe(120);
    expect(config.exec.sessionBufferSize).toBe(32000);
    expect(config.exec.foregroundYieldMs).toBe(1400);
    expect(config.exec.defaultLaunchMode).toBe('pty');
    expect(config.exec.defaultBackground).toBe(true);
    expect(config.exec.ptyCols).toBe(160);
    expect(config.exec.ptyRows).toBe(44);
    expect(config.exec.forcePtyFallback).toBe(true);
  });

  test('fills in defaults for partial exec section', async () => {
    const runtimeSection = {
      exec: { enabled: true },
    };

    await setProviderRegistryState(makeMinimalConfig(runtimeSection));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.exec.enabled).toBe(true);
    expect(config.exec.allowlist).toEqual([]);
    expect(config.exec.defaultTier).toBe('host');
    expect(config.exec.maxTier).toBe('host');
    expect(config.exec.mounts).toEqual([]);
    expect(config.exec.maxTimeout).toBe(30);
    expect(config.exec.maxOutputSize).toBe(10000);
    expect(config.exec.maxSessions).toBe(8);
    expect(config.exec.sessionTimeout).toBe(300);
    expect(config.exec.sessionBufferSize).toBe(100000);
    expect(config.exec.foregroundYieldMs).toBe(1000);
    expect(config.exec.defaultLaunchMode).toBe('child');
    expect(config.exec.defaultBackground).toBe(false);
    expect(config.exec.ptyCols).toBe(120);
    expect(config.exec.ptyRows).toBe(30);
    expect(config.exec.forcePtyFallback).toBe(false);
  });

  test('uses defaults for missing allowlist', async () => {
    const runtimeSection = {
      exec: { enabled: true, maxTimeout: 120 },
    };

    await setProviderRegistryState(makeMinimalConfig(runtimeSection));

    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');
    resetRuntimeWarningsForTests();

    const config = getRuntimeConfig();

    expect(config.exec.enabled).toBe(true);
    expect(config.exec.allowlist).toEqual([]);
    expect(config.exec.defaultTier).toBe('host');
    expect(config.exec.maxTier).toBe('host');
    expect(config.exec.maxTimeout).toBe(120);
    expect(config.exec.maxOutputSize).toBe(10000);
  });
});

describe('exec runtime helpers', () => {
  test('encodes privilege ordering consistently for locked-down < sandbox < host', async () => {
    const { compareExecTiers } = await import('../src/lib/services/exec-runtime');

    expect(compareExecTiers('locked-down', 'sandbox')).toBeLessThan(0);
    expect(compareExecTiers('sandbox', 'host')).toBeLessThan(0);
    expect(compareExecTiers('host', 'host')).toBe(0);
  });

  test('detects container runtime and reports startup viability', async () => {
    const { getExecStartupDiagnostics, setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');

    setDetectedContainerRuntimeForTests('docker');
    const available = getExecStartupDiagnostics({
      enabled: true,
      defaultTier: 'sandbox',
      maxTier: 'host',
      containerRuntime: 'docker',
    });

    expect(available.containerRuntime).toBe('docker');
    expect(available.defaultTierViable).toBe(true);

    setDetectedContainerRuntimeForTests(null);
    const unavailable = getExecStartupDiagnostics({
      enabled: true,
      defaultTier: 'locked-down',
      maxTier: 'host',
      containerRuntime: null,
    });

    expect(unavailable.containerRuntime).toBeNull();
    expect(unavailable.defaultTierViable).toBe(false);
    expect(unavailable.messages.some(message => message.includes('requires Docker or Podman'))).toBe(true);
  });

  test('validates explicitly configured container runtimes and does not silently fall back to another runtime', async () => {
    const { setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');
    const { getRuntimeConfig, resetRuntimeWarningsForTests } = await import('../src/lib/config/runtime');

    await setProviderRegistryState(makeMinimalConfig({
      exec: {
        enabled: true,
        containerRuntime: 'docker',
      },
    }));
    setDetectedContainerRuntimeForTests('podman');
    resetRuntimeWarningsForTests();

    expect(getRuntimeConfig().exec.containerRuntime).toBeNull();

    await setProviderRegistryState(makeMinimalConfig({
      exec: {
        enabled: true,
        containerRuntime: 'podman',
      },
    }));
    setDetectedContainerRuntimeForTests('podman');
    resetRuntimeWarningsForTests();

    expect(getRuntimeConfig().exec.containerRuntime).toBe('podman');
  });
});
