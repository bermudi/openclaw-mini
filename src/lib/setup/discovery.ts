// Setup module - discover current config, env, and workspace state

import fs from 'fs';
import path from 'path';
import os from 'os';
import JSON5 from 'json5';
import { getConfigPath } from '@/lib/config/loader';
import { getWorkspaceDir } from '@/lib/services/workspace-service';
import type { SetupDiscovery, ProviderRawEntry } from './types';

function resolveEnvFilePath(): string {
  const dir = process.cwd();
  return path.join(dir, '.env.local');
}

function readRawConfig(configPath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON5.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractProviders(raw: Record<string, unknown>): ProviderRawEntry[] {
  const providers = raw['providers'];
  if (!providers || typeof providers !== 'object') {
    return [];
  }

  return Object.entries(providers as Record<string, unknown>).map(([id, def]) => {
    const d = (def ?? {}) as Record<string, unknown>;
    return {
      id,
      apiType: String(d['apiType'] ?? 'openai-chat'),
      baseURL: d['baseURL'] ? String(d['baseURL']) : undefined,
      apiKey: String(d['apiKey'] ?? ''),
    };
  });
}

function extractAgent(
  raw: Record<string, unknown>,
): SetupDiscovery['existingAgent'] {
  const agent = raw['agent'];
  if (!agent || typeof agent !== 'object') {
    return null;
  }
  const a = agent as Record<string, unknown>;
  return {
    provider: String(a['provider'] ?? ''),
    model: String(a['model'] ?? ''),
    fallbackProvider: a['fallbackProvider'] ? String(a['fallbackProvider']) : undefined,
    fallbackModel: a['fallbackModel'] ? String(a['fallbackModel']) : undefined,
  };
}

function extractSearch(
  raw: Record<string, unknown>,
): SetupDiscovery['existingSearch'] {
  const search = raw['search'];
  if (!search || typeof search !== 'object') {
    return null;
  }
  const s = search as Record<string, string>;
  return {
    braveApiKey: s['braveApiKey'],
    tavilyApiKey: s['tavilyApiKey'],
  };
}

function parseBool(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * Inspect the current install state and return structured discovery results.
 * Reads config files and environment variables without triggering runtime initialization.
 */
export function discoverSetup(): SetupDiscovery {
  const configPath = getConfigPath();
  const configExists = fs.existsSync(configPath);
  const envFilePath = resolveEnvFilePath();
  const workspaceDir = getWorkspaceDir();
  const workspaceExists = fs.existsSync(workspaceDir);

  let workspaceFiles: string[] = [];
  if (workspaceExists) {
    try {
      workspaceFiles = fs
        .readdirSync(workspaceDir)
        .filter(f => /^[A-Za-z0-9_-]+\.md$/.test(f))
        .sort();
    } catch {
      workspaceFiles = [];
    }
  }

  let existingProviders: ProviderRawEntry[] = [];
  let existingAgent: SetupDiscovery['existingAgent'] = null;
  let existingRuntime: Record<string, unknown> | null = null;
  let existingSearch: SetupDiscovery['existingSearch'] = null;
  let existingBrowser: Record<string, unknown> | null = null;
  let existingMcp: Record<string, unknown> | null = null;

  if (configExists) {
    const raw = readRawConfig(configPath);
    if (raw) {
      existingProviders = extractProviders(raw);
      existingAgent = extractAgent(raw);
      existingSearch = extractSearch(raw);
      existingRuntime = (raw['runtime'] as Record<string, unknown>) ?? null;
      existingBrowser = (raw['browser'] as Record<string, unknown>) ?? null;
      existingMcp = (raw['mcp'] as Record<string, unknown>) ?? null;
    }
  }

  return {
    configPath,
    configExists,
    envFilePath,
    workspaceDir,
    workspaceExists,
    workspaceFiles,
    existingProviders,
    existingAgent,
    existingRuntime,
    existingSearch,
    existingBrowser,
    existingMcp,
    envVars: {
      databaseUrl: process.env.DATABASE_URL,
      openclawApiKey: process.env.OPENCLAW_API_KEY,
      insecureLocal: parseBool(process.env.OPENCLAW_ALLOW_INSECURE_LOCAL),
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      telegramTransport: process.env.TELEGRAM_TRANSPORT,
      whatsappEnabled: parseBool(process.env.WHATSAPP_ENABLED),
      workspaceDirOverride: process.env.OPENCLAW_WORKSPACE_DIR,
      sessionCompactionThreshold: process.env.OPENCLAW_SESSION_COMPACTION_THRESHOLD,
      sessionRetainCount: process.env.OPENCLAW_SESSION_RETAIN_COUNT,
      historyCapBytes: process.env.OPENCLAW_HISTORY_CAP_BYTES,
      historyRetentionDays: process.env.OPENCLAW_HISTORY_RETENTION_DAYS,
      openclawAppUrl: process.env.OPENCLAW_APP_URL,
      openclawWsPort: process.env.OPENCLAW_WS_PORT,
      openclawWsUrl: process.env.OPENCLAW_WS_URL,
    },
  };
}
