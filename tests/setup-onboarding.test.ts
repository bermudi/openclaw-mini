/// <reference types="bun-types" />

// Regression tests for the setup onboarding module:
// - diagnostics extraction (doctor.ts)
// - config/env persistence (persist.ts)
// - advanced env override handling (persist.ts)
// - non-destructive workspace onboarding (persist.ts)

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import {
  writeOpenclawConfig,
  writeEnvLocal,
  seedWorkspaceDefaults,
  writeWorkspaceFile,
  readWorkspaceFileContent,
  persistSetupPlan,
  type ConfigWriteInput,
} from '@/lib/setup/persist';
import { discoverSetup } from '@/lib/setup/discovery';
import type { SetupPlan } from '@/lib/setup/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(label: string): string {
  const dir = path.join(tmpdir(), `openclaw-setup-test-${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Config persistence (task 3.1)
// ---------------------------------------------------------------------------

describe('writeOpenclawConfig', () => {
  test('creates a new valid openclaw.json with provider and agent', () => {
    const dir = tmpDir('config-new');
    const configPath = path.join(dir, 'openclaw.json');

    writeOpenclawConfig({
      configPath,
      providers: [{ id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' }],
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    });

    expect(fs.existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed['providers']).toBeTruthy();
    const providers = parsed['providers'] as Record<string, unknown>;
    expect(providers['openai']).toBeTruthy();
    const openai = providers['openai'] as Record<string, string>;
    expect(openai['apiType']).toBe('openai-chat');
    expect(openai['apiKey']).toBe('${OPENAI_API_KEY}');
    const agent = parsed['agent'] as Record<string, string>;
    expect(agent['provider']).toBe('openai');
    expect(agent['model']).toBe('gpt-4.1-mini');
  });

  test('updates existing config in place, preserving untouched keys', () => {
    const dir = tmpDir('config-update');
    const configPath = path.join(dir, 'openclaw.json');

    // Write an initial config with a custom runtime section
    const initial = {
      providers: { openai: { apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' } },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      runtime: { safety: { maxIterations: 8 } },
    };
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf-8');

    // Update only providers and agent
    writeOpenclawConfig({
      configPath,
      providers: [
        { id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' },
        { id: 'anthropic', apiType: 'anthropic', apiKey: '${ANTHROPIC_API_KEY}' },
      ],
      agent: { provider: 'anthropic', model: 'claude-opus-4-5' },
    });

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const runtime = parsed['runtime'] as Record<string, unknown>;
    // runtime section should be preserved
    expect(runtime).toBeTruthy();
    const safety = runtime['safety'] as Record<string, unknown>;
    expect(safety['maxIterations']).toBe(8);
    // new providers should be written
    const providers = parsed['providers'] as Record<string, unknown>;
    expect(Object.keys(providers)).toHaveLength(2);
    expect(providers['anthropic']).toBeTruthy();
  });

  test('writes search section when keys are provided', () => {
    const dir = tmpDir('config-search');
    const configPath = path.join(dir, 'openclaw.json');

    writeOpenclawConfig({
      configPath,
      providers: [{ id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' }],
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      search: { braveApiKey: 'brave-key-123' },
    });

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const search = parsed['search'] as Record<string, string>;
    expect(search['braveApiKey']).toBe('brave-key-123');
    expect(search['tavilyApiKey']).toBeUndefined();
  });

  test('writes fallback provider and model when provided', () => {
    const dir = tmpDir('config-fallback');
    const configPath = path.join(dir, 'openclaw.json');

    writeOpenclawConfig({
      configPath,
      providers: [
        { id: 'openrouter', apiType: 'openai-chat', apiKey: '${OPENROUTER_API_KEY}' },
        { id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' },
      ],
      agent: {
        provider: 'openrouter',
        model: 'openai/gpt-4.1-mini',
        fallbackProvider: 'openai',
        fallbackModel: 'gpt-4.1-mini',
      },
    });

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const agent = parsed['agent'] as Record<string, string>;
    expect(agent['fallbackProvider']).toBe('openai');
    expect(agent['fallbackModel']).toBe('gpt-4.1-mini');
  });

  test('creates parent directories if they do not exist', () => {
    const dir = tmpDir('config-mkdir');
    const configPath = path.join(dir, 'subdir', 'nested', 'openclaw.json');

    writeOpenclawConfig({
      configPath,
      providers: [{ id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' }],
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    });

    expect(fs.existsSync(configPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Env persistence (task 3.2)
// ---------------------------------------------------------------------------

describe('writeEnvLocal', () => {
  test('creates .env.local with provided values', () => {
    const dir = tmpDir('env-new');
    const envPath = path.join(dir, '.env.local');

    writeEnvLocal(envPath, {
      DATABASE_URL: 'file:./db/test.db',
      OPENCLAW_API_KEY: 'my-secret-token',
    });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('DATABASE_URL=file:./db/test.db');
    expect(content).toContain('OPENCLAW_API_KEY=my-secret-token');
  });

  test('updates existing keys in place without losing other lines', () => {
    const dir = tmpDir('env-update');
    const envPath = path.join(dir, '.env.local');

    // Write an initial env file with some existing content
    fs.writeFileSync(
      envPath,
      [
        '# Comment line preserved',
        'DATABASE_URL=file:./old.db',
        'OPENCLAW_API_KEY=old-key',
        'MY_CUSTOM_VAR=should-stay',
        '',
      ].join('\n'),
      'utf-8',
    );

    writeEnvLocal(envPath, {
      DATABASE_URL: 'file:./new.db',
      OPENCLAW_API_KEY: 'new-key',
    });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('DATABASE_URL=file:./new.db');
    expect(content).toContain('OPENCLAW_API_KEY=new-key');
    expect(content).toContain('MY_CUSTOM_VAR=should-stay');
    expect(content).toContain('# Comment line preserved');
    expect(content).not.toContain('file:./old.db');
    expect(content).not.toContain('old-key');
  });

  test('appends new keys not already present', () => {
    const dir = tmpDir('env-append');
    const envPath = path.join(dir, '.env.local');

    fs.writeFileSync(envPath, 'DATABASE_URL=file:./test.db\n', 'utf-8');

    writeEnvLocal(envPath, {
      OPENCLAW_API_KEY: 'new-token',
      TELEGRAM_BOT_TOKEN: 'tg-token',
    });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('OPENCLAW_API_KEY=new-token');
    expect(content).toContain('TELEGRAM_BOT_TOKEN=tg-token');
  });

  test('does not append empty values for new keys', () => {
    const dir = tmpDir('env-empty');
    const envPath = path.join(dir, '.env.local');

    writeEnvLocal(envPath, {
      DATABASE_URL: 'file:./test.db',
      TELEGRAM_BOT_TOKEN: '', // empty — should not be written as a new key
    });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).not.toContain('TELEGRAM_BOT_TOKEN');
  });

  test('handles advanced env-only overrides (task 3.2)', () => {
    const dir = tmpDir('env-advanced');
    const envPath = path.join(dir, '.env.local');

    writeEnvLocal(envPath, {
      OPENCLAW_SESSION_COMPACTION_THRESHOLD: '0.7',
      OPENCLAW_SESSION_RETAIN_COUNT: '100',
      OPENCLAW_HISTORY_CAP_BYTES: '500000',
      OPENCLAW_APP_URL: 'http://my-server:3000',
    });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('OPENCLAW_SESSION_COMPACTION_THRESHOLD=0.7');
    expect(content).toContain('OPENCLAW_SESSION_RETAIN_COUNT=100');
    expect(content).toContain('OPENCLAW_HISTORY_CAP_BYTES=500000');
    expect(content).toContain('OPENCLAW_APP_URL=http://my-server:3000');
  });
});

// ---------------------------------------------------------------------------
// Workspace bootstrap helpers (task 3.3)
// ---------------------------------------------------------------------------

describe('seedWorkspaceDefaults', () => {
  test('creates default bootstrap files in an empty workspace', () => {
    const dir = tmpDir('ws-seed');

    const created = seedWorkspaceDefaults(dir);

    expect(created.length).toBeGreaterThan(0);
    expect(created).toContain('IDENTITY.md');
    expect(created).toContain('SOUL.md');
    expect(created).toContain('AGENTS.md');

    // Files should have content
    const identity = fs.readFileSync(path.join(dir, 'IDENTITY.md'), 'utf-8');
    expect(identity.trim().length).toBeGreaterThan(0);
  });

  test('does NOT overwrite existing files (non-destructive)', () => {
    const dir = tmpDir('ws-nooverwrite');

    // Pre-create IDENTITY.md with custom content
    const customContent = '# My Custom Identity\nThis is my custom agent identity.';
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), customContent, 'utf-8');

    seedWorkspaceDefaults(dir);

    // IDENTITY.md should be unchanged
    const after = fs.readFileSync(path.join(dir, 'IDENTITY.md'), 'utf-8');
    expect(after).toBe(customContent);
  });

  test('creates only missing files when some already exist', () => {
    const dir = tmpDir('ws-partial');

    // Pre-create just IDENTITY.md
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), '# Existing', 'utf-8');

    const created = seedWorkspaceDefaults(dir);

    // IDENTITY.md should NOT be in created list
    expect(created).not.toContain('IDENTITY.md');
    // Other default files should be created
    expect(created).toContain('SOUL.md');
  });

  test('creates the workspace directory if missing', () => {
    const dir = path.join(tmpDir('ws-mkdir'), 'nested', 'workspace');

    seedWorkspaceDefaults(dir);

    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('writeWorkspaceFile', () => {
  test('writes content to a named workspace file', () => {
    const dir = tmpDir('ws-write');

    writeWorkspaceFile(dir, 'IDENTITY.md', '# Updated Identity\nCustom content.');

    const content = fs.readFileSync(path.join(dir, 'IDENTITY.md'), 'utf-8');
    expect(content).toBe('# Updated Identity\nCustom content.');
  });

  test('explicitly resets (overwrites) a file when called directly', () => {
    const dir = tmpDir('ws-reset');
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Old soul', 'utf-8');

    writeWorkspaceFile(dir, 'SOUL.md', '# New soul\nFresh start.');

    const content = fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf-8');
    expect(content).toBe('# New soul\nFresh start.');
  });

  test('rejects invalid filenames', () => {
    const dir = tmpDir('ws-invalid');

    expect(() => writeWorkspaceFile(dir, '../evil.md', 'bad')).toThrow();
    expect(() => writeWorkspaceFile(dir, 'file.txt', 'bad')).toThrow();
    expect(() => writeWorkspaceFile(dir, 'FILE WITH SPACES.md', 'bad')).toThrow();
  });
});

describe('readWorkspaceFileContent', () => {
  test('returns null for missing files', () => {
    const dir = tmpDir('ws-read-null');
    expect(readWorkspaceFileContent(dir, 'MISSING.md')).toBeNull();
  });

  test('reads existing file content', () => {
    const dir = tmpDir('ws-read');
    fs.writeFileSync(path.join(dir, 'USER.md'), '# User\nHello world', 'utf-8');

    const content = readWorkspaceFileContent(dir, 'USER.md');
    expect(content).toBe('# User\nHello world');
  });
});

// ---------------------------------------------------------------------------
// Full plan persistence (integration, tasks 3.1 + 3.2 + 3.3)
// ---------------------------------------------------------------------------

describe('persistSetupPlan', () => {
  test('writes openclaw.json, .env.local, and seeds workspace from a plan', async () => {
    const dir = tmpDir('persist-full');
    const configPath = path.join(dir, 'openclaw.json');
    const envPath = path.join(dir, '.env.local');
    const workspaceDir = path.join(dir, 'workspace');

    const plan: SetupPlan = {
      configPath,
      envFilePath: envPath,
      databaseUrl: 'file:./db/test.db',
      providers: [{ id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' }],
      agentProvider: 'openai',
      agentModel: 'gpt-4.1-mini',
      agentFallbackProvider: '',
      agentFallbackModel: '',
      openclawApiKey: 'test-bearer-token',
      insecureLocal: false,
      telegramBotToken: '',
      telegramWebhookSecret: '',
      telegramTransport: 'webhook',
      whatsappEnabled: false,
      workspaceDir,
      workspaceEdits: {},
      searchBraveApiKey: '',
      searchTavilyApiKey: '',
      browserHeadless: true,
      browserViewportWidth: 1280,
      browserViewportHeight: 720,
      browserNavigationTimeout: 30000,
      advancedEnv: {},
    };

    const result = await persistSetupPlan(plan);

    expect(result.errors).toHaveLength(0);
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(envPath)).toBe(true);
    expect(fs.existsSync(workspaceDir)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const providers = config['providers'] as Record<string, unknown>;
    expect(providers['openai']).toBeTruthy();

    const envContent = fs.readFileSync(envPath, 'utf-8');
    expect(envContent).toContain('DATABASE_URL=file:./db/test.db');
    expect(envContent).toContain('OPENCLAW_API_KEY=test-bearer-token');
  });

  test('writes workspace edits from plan (explicit file reset)', async () => {
    const dir = tmpDir('persist-ws-edits');
    const workspaceDir = path.join(dir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'IDENTITY.md'), '# Old identity', 'utf-8');

    const plan: SetupPlan = {
      configPath: path.join(dir, 'openclaw.json'),
      envFilePath: path.join(dir, '.env.local'),
      databaseUrl: 'file:./db/test.db',
      providers: [{ id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' }],
      agentProvider: 'openai',
      agentModel: 'gpt-4.1-mini',
      agentFallbackProvider: '',
      agentFallbackModel: '',
      openclawApiKey: 'token',
      insecureLocal: false,
      telegramBotToken: '',
      telegramWebhookSecret: '',
      telegramTransport: 'webhook',
      whatsappEnabled: false,
      workspaceDir,
      workspaceEdits: { 'IDENTITY.md': '# New identity\nExplicitly reset by operator.' },
      searchBraveApiKey: '',
      searchTavilyApiKey: '',
      browserHeadless: true,
      browserViewportWidth: 1280,
      browserViewportHeight: 720,
      browserNavigationTimeout: 30000,
      advancedEnv: {},
    };

    const result = await persistSetupPlan(plan);

    expect(result.workspaceFilesWritten).toContain('IDENTITY.md');
    const content = fs.readFileSync(path.join(workspaceDir, 'IDENTITY.md'), 'utf-8');
    expect(content).toContain('New identity');
  });

  test('persists advanced env-only overrides to .env.local', async () => {
    const dir = tmpDir('persist-advanced-env');

    const plan: SetupPlan = {
      configPath: path.join(dir, 'openclaw.json'),
      envFilePath: path.join(dir, '.env.local'),
      databaseUrl: 'file:./db/test.db',
      providers: [{ id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' }],
      agentProvider: 'openai',
      agentModel: 'gpt-4.1-mini',
      agentFallbackProvider: '',
      agentFallbackModel: '',
      openclawApiKey: 'token',
      insecureLocal: false,
      telegramBotToken: '',
      telegramWebhookSecret: '',
      telegramTransport: 'webhook',
      whatsappEnabled: false,
      workspaceDir: path.join(dir, 'workspace'),
      workspaceEdits: {},
      searchBraveApiKey: '',
      searchTavilyApiKey: '',
      browserHeadless: true,
      browserViewportWidth: 1280,
      browserViewportHeight: 720,
      browserNavigationTimeout: 30000,
      advancedEnv: {
        OPENCLAW_SESSION_COMPACTION_THRESHOLD: '0.6',
        OPENCLAW_APP_URL: 'http://my-host:3000',
        OPENCLAW_WS_PORT: '', // blank — should not appear in .env.local
      },
    };

    await persistSetupPlan(plan);

    const content = fs.readFileSync(path.join(dir, '.env.local'), 'utf-8');
    expect(content).toContain('OPENCLAW_SESSION_COMPACTION_THRESHOLD=0.6');
    expect(content).toContain('OPENCLAW_APP_URL=http://my-host:3000');
    expect(content).not.toContain('OPENCLAW_WS_PORT');
  });

  test('insecureLocal=true writes OPENCLAW_ALLOW_INSECURE_LOCAL to env', async () => {
    const dir = tmpDir('persist-insecure');

    const plan: SetupPlan = {
      configPath: path.join(dir, 'openclaw.json'),
      envFilePath: path.join(dir, '.env.local'),
      databaseUrl: 'file:./db/test.db',
      providers: [{ id: 'openai', apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' }],
      agentProvider: 'openai',
      agentModel: 'gpt-4.1-mini',
      agentFallbackProvider: '',
      agentFallbackModel: '',
      openclawApiKey: '',
      insecureLocal: true,
      telegramBotToken: '',
      telegramWebhookSecret: '',
      telegramTransport: 'webhook',
      whatsappEnabled: false,
      workspaceDir: path.join(dir, 'workspace'),
      workspaceEdits: {},
      searchBraveApiKey: '',
      searchTavilyApiKey: '',
      browserHeadless: true,
      browserViewportWidth: 1280,
      browserViewportHeight: 720,
      browserNavigationTimeout: 30000,
      advancedEnv: {},
    };

    await persistSetupPlan(plan);

    const content = fs.readFileSync(path.join(dir, '.env.local'), 'utf-8');
    expect(content).toContain('OPENCLAW_ALLOW_INSECURE_LOCAL=true');
  });
});

// ---------------------------------------------------------------------------
// Discovery (task 2.2)
// ---------------------------------------------------------------------------

describe('discoverSetup', () => {
  test('returns configExists=false when no config file found', () => {
    const originalEnv = process.env.OPENCLAW_CONFIG_PATH;
    // Point to a path that definitely does not exist
    process.env.OPENCLAW_CONFIG_PATH = '/tmp/no-such-config-openclaw-setup-test.json';

    try {
      const discovery = discoverSetup();
      expect(discovery.configExists).toBe(false);
      expect(discovery.existingProviders).toHaveLength(0);
      expect(discovery.existingAgent).toBeNull();
    } finally {
      if (originalEnv === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = originalEnv;
    }
  });

  test('returns configExists=true and prefills providers when config exists', () => {
    const dir = tmpDir('discover-exists');
    const configPath = path.join(dir, 'openclaw.json');

    const config = {
      providers: {
        openai: { apiType: 'openai-chat', apiKey: '${OPENAI_API_KEY}' },
      },
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const originalEnv = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_CONFIG_PATH = configPath;

    try {
      const discovery = discoverSetup();
      expect(discovery.configExists).toBe(true);
      expect(discovery.existingProviders).toHaveLength(1);
      expect(discovery.existingProviders[0]?.id).toBe('openai');
      expect(discovery.existingAgent?.provider).toBe('openai');
      expect(discovery.existingAgent?.model).toBe('gpt-4.1-mini');
    } finally {
      if (originalEnv === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = originalEnv;
    }
  });
});
