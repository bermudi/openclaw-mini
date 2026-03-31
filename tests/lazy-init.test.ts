/// <reference types="bun-types" />

import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'lazy-init.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

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
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-lazy-init-'));
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
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, NO_ENV_FILE: '1' },
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
});

afterEach(async () => {
  const { resetInitForTests } = await import('../src/lib/init');
  const { resetInitForTests: resetLazyInitForTests } = await import('../src/lib/init/lazy');

  resetInitForTests();
  resetLazyInitForTests();
  restoreEnv();

  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  createdDirs.clear();
});

describe('lazy init - ensureInitialized singleton', () => {
  test('first call triggers actual initialization', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {
        "openai": {
          "apiType": "openai-chat",
          "apiKey": "\${OPENAI_API_KEY}"
        }
      },
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { ensureInitialized } = await import('../src/lib/init/lazy');
    const { isInitialized } = await import('../src/lib/init');

    expect(isInitialized()).toBe(false);

    const result = await ensureInitialized();

    expect(result.success).toBe(true);
    expect(isInitialized()).toBe(true);
  });

  test('subsequent calls return cached result without re-running', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {
        "openai": {
          "apiType": "openai-chat",
          "apiKey": "\${OPENAI_API_KEY}"
        }
      },
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { ensureInitialized } = await import('../src/lib/init/lazy');
    const { initialize } = await import('../src/lib/init');

    const initializeSpy = spyOn(await import('../src/lib/init'), 'initialize');

    // First call
    const result1 = await ensureInitialized();
    expect(result1.success).toBe(true);
    expect(initializeSpy).toHaveBeenCalledTimes(1);

    // Second call - should use cached promise
    const result2 = await ensureInitialized();
    expect(result2).toBe(result1);
    expect(initializeSpy).toHaveBeenCalledTimes(1); // Not called again

    initializeSpy.mockRestore();
  });

  test('concurrent calls all receive same promise', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {
        "openai": {
          "apiType": "openai-chat",
          "apiKey": "\${OPENAI_API_KEY}"
        }
      },
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { ensureInitialized } = await import('../src/lib/init/lazy');

    // Fire multiple concurrent calls
    const [result1, result2, result3] = await Promise.all([
      ensureInitialized(),
      ensureInitialized(),
      ensureInitialized(),
    ]);

    // All should be the same object
    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
    expect(result1.success).toBe(true);
  });

  test('returns failure result when initialization fails', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    // Invalid config - missing required fields
    writeConfig(configPath, `{
      "providers": {},
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;

    const { ensureInitialized } = await import('../src/lib/init/lazy');

    const result = await ensureInitialized();

    expect(result.success).toBe(false);
    expect(result.hardFailures.length).toBeGreaterThan(0);
  });

  test('cached failure is returned on subsequent calls', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {},
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;

    const { ensureInitialized } = await import('../src/lib/init/lazy');
    const { initialize } = await import('../src/lib/init');

    const initializeSpy = spyOn(await import('../src/lib/init'), 'initialize');

    // First call fails
    const result1 = await ensureInitialized();
    expect(result1.success).toBe(false);
    expect(initializeSpy).toHaveBeenCalledTimes(1);

    // Second call returns cached failure
    const result2 = await ensureInitialized();
    expect(result2).toBe(result1);
    expect(result2.success).toBe(false);
    expect(initializeSpy).toHaveBeenCalledTimes(1); // Not called again

    initializeSpy.mockRestore();
  });
});

describe('lazy init - withInit wrapper', () => {
  test('executes handler after successful initialization', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {
        "openai": {
          "apiType": "openai-chat",
          "apiKey": "\${OPENAI_API_KEY}"
        }
      },
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { withInit } = await import('../src/lib/api/init-guard');

    const handlerResult = { success: true, data: 'test' };
    const result = await withInit(async () => handlerResult);

    expect(result).toBe(handlerResult);
  });

  test('returns 503 response when initialization fails', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {},
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;

    const { withInit } = await import('../src/lib/api/init-guard');

    const result = await withInit(async () => ({ success: true }));

    // Should be a NextResponse with 503 status
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(503);

    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Service initialization failed');
  });

  test('returns 503 when handler throws error', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {
        "openai": {
          "apiType": "openai-chat",
          "apiKey": "\${OPENAI_API_KEY}"
        }
      },
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { withInit } = await import('../src/lib/api/init-guard');

    const result = await withInit(async () => {
      throw new Error('Handler failed');
    });

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(503);

    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Handler failed');
  });

  test('multiple withInit calls share initialization', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {
        "openai": {
          "apiType": "openai-chat",
          "apiKey": "\${OPENAI_API_KEY}"
        }
      },
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { withInit } = await import('../src/lib/api/init-guard');
    const { initialize } = await import('../src/lib/init');

    const initializeSpy = spyOn(await import('../src/lib/init'), 'initialize');

    // First request
    const result1 = await withInit(async () => 'first');
    expect(result1).toBe('first');
    expect(initializeSpy).toHaveBeenCalledTimes(1);

    // Second request - should use cached init
    const result2 = await withInit(async () => 'second');
    expect(result2).toBe('second');
    expect(initializeSpy).toHaveBeenCalledTimes(1); // Still only called once

    initializeSpy.mockRestore();
  });
});

describe('lazy init - reset for tests', () => {
  test('resetInitForTests clears cached promise', async () => {
    const configPath = path.join(createTempDir(), 'openclaw.json');
    writeConfig(configPath, `{
      "providers": {
        "openai": {
          "apiType": "openai-chat",
          "apiKey": "\${OPENAI_API_KEY}"
        }
      },
      "agent": {
        "provider": "openai",
        "model": "gpt-4.1-mini"
      }
    }`);
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { ensureInitialized, resetInitForTests: resetLazyInitForTests } = await import('../src/lib/init/lazy');
    const { initialize } = await import('../src/lib/init');

    const initializeSpy = spyOn(await import('../src/lib/init'), 'initialize');

    // First call
    await ensureInitialized();
    expect(initializeSpy).toHaveBeenCalledTimes(1);

    // Reset
    resetLazyInitForTests();

    // Second call should trigger initialization again
    await ensureInitialized();
    expect(initializeSpy).toHaveBeenCalledTimes(2);

    initializeSpy.mockRestore();
  });
});

describe('lazy init - instrumentation safety', () => {
  test('instrumentation.ts has no heavy imports that would crash Turbopack', () => {
    const instrumentation = fs.readFileSync('src/instrumentation.ts', 'utf-8');

    // Should not import from heavy init system
    expect(instrumentation).not.toContain("from '@/lib/init'");
    expect(instrumentation).not.toContain('from "@/lib/init"');

    // Should not reference instrumentation-node
    expect(instrumentation).not.toContain('./instrumentation-node');

    // Should be lightweight (only signal handlers)
    expect(instrumentation).toContain('markSkillCacheDirty');
  });

  test('instrumentation-node.ts does not exist', () => {
    expect(fs.existsSync('src/instrumentation-node.ts')).toBe(false);
  });

  test('lazy.ts exists and exports required functions', async () => {
    const lazyModule = await import('../src/lib/init/lazy');

    expect(typeof lazyModule.ensureInitialized).toBe('function');
    expect(typeof lazyModule.resetInitForTests).toBe('function');
  });

  test('init-guard.ts exists and exports withInit', async () => {
    const guardModule = await import('../src/lib/api/init-guard');

    expect(typeof guardModule.withInit).toBe('function');
  });
});

describe('lazy init - API route integration pattern', () => {
  test('api routes use withInit pattern correctly', () => {
    const routes = [
      'src/app/api/agents/route.ts',
      'src/app/api/input/route.ts',
      'src/app/api/tasks/route.ts',
      'src/app/api/sessions/route.ts',
      'src/app/api/triggers/route.ts',
      'src/app/api/skills/route.ts',
      'src/app/api/route.ts',
    ];

    for (const routePath of routes) {
      if (!fs.existsSync(routePath)) {
        continue;
      }

      const content = fs.readFileSync(routePath, 'utf-8');

      // Should import withInit (handle both single and double quotes)
      expect(content).toMatch(/from\s+['"]@\/lib\/api\/init-guard['"]/);

      // Should wrap handler with withInit
      expect(content).toContain('return withInit(async () => {');
    }
  });
});
