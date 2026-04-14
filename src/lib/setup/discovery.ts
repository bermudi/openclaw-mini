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

function extractExec(
  raw: Record<string, unknown>,
): SetupDiscovery['existingExec'] {
  const runtime = raw['runtime'];
  if (!runtime || typeof runtime !== 'object') {
    return null;
  }
  const r = runtime as Record<string, unknown>;
  const exec = r['exec'];
  if (!exec || typeof exec !== 'object') {
    return null;
  }
  const e = exec as Record<string, unknown>;
  return {
    enabled: typeof e['enabled'] === 'boolean' ? e['enabled'] : undefined,
    defaultTier: typeof e['defaultTier'] === 'string' ? e['defaultTier'] : undefined,
    maxTier: typeof e['maxTier'] === 'string' ? e['maxTier'] : undefined,
    defaultLaunchMode: typeof e['defaultLaunchMode'] === 'string' ? e['defaultLaunchMode'] : undefined,
    defaultBackground: typeof e['defaultBackground'] === 'boolean' ? e['defaultBackground'] : undefined,
  };
}

function extractChannels(
  raw: Record<string, unknown>,
): SetupDiscovery['existingChannels'] {
  const channels = raw['channels'];
  if (!channels || typeof channels !== 'object') {
    return null;
  }
  const c = channels as Record<string, unknown>;
  const telegram = c['telegram'];
  if (!telegram || typeof telegram !== 'object') {
    return null;
  }
  const t = telegram as Record<string, unknown>;
  return {
    telegram: {
      botToken: typeof t['botToken'] === 'string' ? t['botToken'] : undefined,
      webhookSecret: typeof t['webhookSecret'] === 'string' ? t['webhookSecret'] : undefined,
      transport: typeof t['transport'] === 'string' ? t['transport'] : undefined,
    },
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
  let existingExec: SetupDiscovery['existingExec'] = null;
  let existingChannels: SetupDiscovery['existingChannels'] = null;

  if (configExists) {
    const raw = readRawConfig(configPath);
    if (raw) {
      existingProviders = extractProviders(raw);
      existingAgent = extractAgent(raw);
      existingSearch = extractSearch(raw);
      existingExec = extractExec(raw);
      existingChannels = extractChannels(raw);
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
    existingExec,
    existingChannels,
    envVars: {
      databaseUrl: process.env.DATABASE_URL,
      openclawApiKey: process.env.OPENCLAW_API_KEY,
      insecureLocal: parseBool(process.env.OPENCLAW_ALLOW_INSECURE_LOCAL),
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
