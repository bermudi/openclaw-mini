/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'init-system.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

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

mock.module('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: ({ baseURL, apiKey }: { baseURL?: string; apiKey?: string }) =>
    (model: string) => ({ provider: 'gemini', model, baseURL, apiKey }),
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
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-init-'));
  createdDirs.add(dir);
  return dir;
}

function writeConfig(configPath: string, content: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, content, 'utf-8');
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = 'test-key';

  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  fs.rmSync(TEST_DB_PATH, { force: true });
  fs.rmSync(`${TEST_DB_PATH}-wal`, { force: true });
  fs.rmSync(`${TEST_DB_PATH}-shm`, { force: true });

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push', '--accept-data-loss'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare test database: ${dbPush.stderr.toString()}`);
  }

  const { resetDbClientForTests } = await import('../src/lib/db');
  await resetDbClientForTests();
});

beforeEach(() => {
  restoreEnv();
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_DIR;
  delete process.env.OPENCLAW_STATE_DIR;
});

afterEach(async () => {
  const { stopWatchingConfig } = await import('../src/lib/config/watcher');
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  const { resetInitForTests } = await import('../src/lib/init');
  const { resetAdapterInitializationForTests } = await import('../src/lib/adapters');
  const { resetExecRuntimeStateForTests } = await import('../src/lib/services/exec-runtime');
  const { resetDbClientForTests } = await import('../src/lib/db');
  
  stopWatchingConfig();
  resetProviderRegistryForTests();
  resetInitForTests();
  resetAdapterInitializationForTests();
  resetExecRuntimeStateForTests();
  await resetDbClientForTests();
  restoreEnv();

  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  createdDirs.clear();
});

afterAll(async () => {
  const { resetDbClientForTests } = await import('../src/lib/db');
  await resetDbClientForTests();
});

describe('init system - config file checks', () => {
  test('5.1: fails when config file is missing', async () => {
    const configPath = path.join(createTempDir(), 'missing-openclaw.json');
    process.env.OPENCLAW_CONFIG_PATH = configPath;

    const { initialize } = await import('../src/lib/init');
    const result = await initialize();

    expect(result.success).toBe(false);
    expect(result.hardFailures).toHaveLength(1);
    expect(result.hardFailures[0].type).toBe('config-file');
    expect(result.hardFailures[0].error).toContain('Config file not found');
    expect(result.hardFailures[0].guidance).toContain('Create openclaw.json');
  });

  test('5.2: fails when config schema is invalid', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      providers: {
        openai: {
          apiType: 'openai-chat',
          apiKey: '\${OPENAI_API_KEY}',
        },
      },
      agent: {
        provider: 'nonexistent',
        model: 'gpt-4',
      },
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;

    const { initialize } = await import('../src/lib/init');
    const result = await initialize();

    expect(result.success).toBe(false);
    expect(result.hardFailures.length).toBeGreaterThan(0);
    expect(result.hardFailures[0].error).toContain('nonexistent');
  });
});

describe('init system - provider key checks', () => {
  test('5.3: fails when provider env var is missing', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      providers: {
        openai: {
          apiType: 'openai-chat',
          apiKey: '\${MISSING_API_KEY}',
        },
      },
      agent: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
      },
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    delete process.env.MISSING_API_KEY;

    const { initialize } = await import('../src/lib/init');
    const result = await initialize();

    expect(result.success).toBe(false);
    expect(result.hardFailures).toHaveLength(1);
    expect(result.hardFailures[0].type).toBe('provider-keys');
    expect(result.hardFailures[0].error).toContain('MISSING_API_KEY');
  });
});

describe('init system - database checks', () => {
  test('5.4: fails when DATABASE_URL is not set', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    delete process.env.DATABASE_URL;

    const { initialize } = await import('../src/lib/init');
    const result = await initialize();

    expect(result.success).toBe(false);
    expect(result.hardFailures).toHaveLength(1);
    expect(result.hardFailures[0].type).toBe('database');
    expect(result.hardFailures[0].error).toContain('DATABASE_URL');
  });
});

describe('init system - successful initialization', () => {
  test('5.6: initializes successfully with valid config', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { initialize, isInitialized, resetInitForTests } = await import('../src/lib/init');
    
    resetInitForTests();
    
    const result = await initialize();

    expect(result.success).toBe(true);
    expect(isInitialized()).toBe(true);
  });

  test('5.7: initialize() is idempotent', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { initialize, isInitialized, resetInitForTests } = await import('../src/lib/init');
    
    resetInitForTests();
    
    const result1 = await initialize();
    expect(result1.success).toBe(true);
    expect(isInitialized()).toBe(true);

    // Second call should return immediately without re-running checks
    const result2 = await initialize();
    expect(result2).toBe(result1);
  });
});

describe('init system - exec runtime diagnostics', () => {
  test('fails startup validation when default isolated tier requires containers but none are available', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
      runtime: {
        exec: {
          enabled: true,
          defaultTier: 'sandbox',
        },
      },
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = 'file:./db/custom.db';

    const { setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');
    setDetectedContainerRuntimeForTests(null);

    const { initialize, resetInitForTests } = await import('../src/lib/init');
    resetInitForTests();

    const result = await initialize();

    expect(result.success).toBe(false);
    expect(result.hardFailures.some(failure => failure.type === 'exec-runtime')).toBe(true);
  });

  test('emits a soft warning when exec is enabled with host default but containers are unavailable', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
      runtime: {
        exec: {
          enabled: true,
          defaultTier: 'host',
        },
      },
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = 'file:./db/custom.db';

    const { setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');
    setDetectedContainerRuntimeForTests(null);

    const { initialize, resetInitForTests } = await import('../src/lib/init');
    resetInitForTests();

    const result = await initialize();

    expect(result.success).toBe(true);
    expect(result.softWarnings.some(warning => warning.type === 'exec-runtime')).toBe(true);
  });

  test('logs startup diagnostics for container runtime availability and default-tier viability', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
      runtime: {
        exec: {
          enabled: true,
          defaultTier: 'host',
        },
      },
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = 'file:./db/custom.db';

    const { setDetectedContainerRuntimeForTests } = await import('../src/lib/services/exec-runtime');
    setDetectedContainerRuntimeForTests(null);

    const infoSpy = spyOn(console, 'info');
    const { initialize, resetInitForTests } = await import('../src/lib/init');
    resetInitForTests();

    const result = await initialize();

    expect(result.success).toBe(true);
    const infoMessages = infoSpy.mock.calls.map(call => String(call[0]));
    expect(infoMessages.some(message => message.includes('Container runtime detected: none'))).toBe(true);
    expect(infoMessages.some(message => message.includes("Default exec tier 'host' is viable at startup"))).toBe(true);

    infoSpy.mockRestore();
  });
});

describe('init system - soft warnings', () => {
  test('warns when Telegram adapter is not configured', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = 'file:./db/custom.db';
    delete process.env.TELEGRAM_BOT_TOKEN;

    const { initialize, resetInitForTests } = await import('../src/lib/init');
    resetInitForTests();
    
    const result = await initialize();

    expect(result.success).toBe(true);
    expect(result.softWarnings.some(w => w.type === 'telegram-adapter')).toBe(true);
  });

  test('warns when WhatsApp adapter is not configured', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = 'file:./db/custom.db';
    delete process.env.WHATSAPP_ENABLED;

    const { initialize, resetInitForTests } = await import('../src/lib/init');
    resetInitForTests();
    
    const result = await initialize();

    expect(result.success).toBe(true);
    expect(result.softWarnings.some(w => w.type === 'whatsapp-adapter')).toBe(true);
  });

  test('continues initialization when optional browser tool registration fails', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
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
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = 'file:./db/custom.db';

    const toolsModule = await import('../src/lib/tools');
    const registerOptionalToolsSpy = spyOn(toolsModule, 'registerOptionalTools');
    registerOptionalToolsSpy.mockImplementation(async () => {
      throw new Error('boom');
    });

    const { initialize, resetInitForTests } = await import('../src/lib/init');
    resetInitForTests();

    const result = await initialize();

    expect(result.success).toBe(true);
    expect(result.softWarnings.some(w => w.type === 'browser-tool' && w.warning.includes('boom'))).toBe(true);

    registerOptionalToolsSpy.mockRestore();
  });
});
