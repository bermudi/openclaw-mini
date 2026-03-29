// Setup module - persistence helpers for openclaw.json, .env.local, and workspace bootstrap

import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';
import type { ProviderRawEntry, SetupPersistResult, SetupPlan } from './types';
import { DEFAULT_WORKSPACE_FILES } from '@/lib/services/workspace-service';

// ---------------------------------------------------------------------------
// openclaw.json helpers (task 3.1)
// ---------------------------------------------------------------------------

export interface ConfigWriteInput {
  configPath: string;
  providers: ProviderRawEntry[];
  agent: {
    provider: string;
    model: string;
    fallbackProvider?: string;
    fallbackModel?: string;
  };
  runtime?: Record<string, unknown>;
  search?: { braveApiKey?: string; tavilyApiKey?: string };
  browser?: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    navigationTimeout?: number;
  };
  mcp?: Record<string, unknown>;
}

function buildProvidersObject(
  providers: ProviderRawEntry[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const p of providers) {
    const entry: Record<string, unknown> = {
      apiType: p.apiType,
      apiKey: p.apiKey,
    };
    if (p.baseURL) {
      entry['baseURL'] = p.baseURL;
    }
    result[p.id] = entry;
  }
  return result;
}

function buildAgentObject(agent: ConfigWriteInput['agent']): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    provider: agent.provider,
    model: agent.model,
  };
  if (agent.fallbackProvider) obj['fallbackProvider'] = agent.fallbackProvider;
  if (agent.fallbackModel) obj['fallbackModel'] = agent.fallbackModel;
  return obj;
}

function buildSearchObject(
  search?: ConfigWriteInput['search'],
): Record<string, string> | null {
  if (!search) return null;
  const obj: Record<string, string> = {};
  if (search.braveApiKey?.trim()) obj['braveApiKey'] = search.braveApiKey.trim();
  if (search.tavilyApiKey?.trim()) obj['tavilyApiKey'] = search.tavilyApiKey.trim();
  return Object.keys(obj).length > 0 ? obj : null;
}

function buildBrowserObject(
  browser?: ConfigWriteInput['browser'],
): Record<string, unknown> | null {
  if (!browser) return null;
  const obj: Record<string, unknown> = {};
  if (browser.headless !== undefined) obj['headless'] = browser.headless;
  if (browser.viewport) obj['viewport'] = browser.viewport;
  if (browser.navigationTimeout !== undefined) obj['navigationTimeout'] = browser.navigationTimeout;
  return Object.keys(obj).length > 0 ? obj : null;
}

/**
 * Read existing raw config (for merging unknown/untouched sections).
 */
function readExistingRaw(configPath: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON5.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Write or update openclaw.json at the given path.
 * Merges the provided sections onto any existing config, preserving unknown top-level keys.
 * Uses JSON (not JSON5) for deterministic output.
 */
export function writeOpenclawConfig(input: ConfigWriteInput): void {
  const existing = readExistingRaw(input.configPath);

  const config: Record<string, unknown> = {
    ...existing,
    providers: buildProvidersObject(input.providers),
    agent: buildAgentObject(input.agent),
  };

  const searchObj = buildSearchObject(input.search);
  if (searchObj) {
    config['search'] = searchObj;
  } else if (config['search'] !== undefined && !input.search) {
    // preserve existing search section if caller didn't touch it
  }

  const browserObj = buildBrowserObject(input.browser);
  if (browserObj) {
    config['browser'] = browserObj;
  }

  if (input.runtime && Object.keys(input.runtime).length > 0) {
    config['runtime'] = input.runtime;
  }

  if (input.mcp && Object.keys(input.mcp).length > 0) {
    config['mcp'] = input.mcp;
  }

  const dir = path.dirname(input.configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(input.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// .env.local helpers (task 3.2)
// ---------------------------------------------------------------------------

function parseEnvFile(filePath: string): Array<{ raw: string; key?: string; value?: string }> {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  return lines.map(raw => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return { raw };
    }
    const eqIndex = raw.indexOf('=');
    if (eqIndex === -1) {
      return { raw };
    }
    const key = raw.slice(0, eqIndex).trim();
    const value = raw.slice(eqIndex + 1);
    return { raw, key, value };
  });
}

function serializeEnvFile(
  lines: Array<{ raw: string; key?: string; value?: string }>,
): string {
  return lines.map(l => {
    if (l.key !== undefined) {
      return `${l.key}=${l.value ?? ''}`;
    }
    return l.raw;
  }).join('\n');
}

/**
 * Write managed key=value pairs to .env.local.
 * Existing lines are preserved; managed keys are updated in place or appended.
 * Blank values are omitted (not written) unless already present.
 */
export function writeEnvLocal(
  filePath: string,
  values: Record<string, string>,
): void {
  const lines = parseEnvFile(filePath);

  const updatedKeys = new Set<string>();

  // Update existing keys in place
  for (const line of lines) {
    if (line.key && line.key in values) {
      const newValue = values[line.key] ?? '';
      line.value = newValue;
      updatedKeys.add(line.key);
    }
  }

  // Append keys not already in the file (skip empty values for new keys)
  const newLines: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!updatedKeys.has(key) && value.trim()) {
      newLines.push(`${key}=${value}`);
    }
  }

  if (newLines.length > 0) {
    // Ensure there's a trailing newline before appending
    const lastLine = lines[lines.length - 1];
    if (lastLine && lastLine.raw.trim() !== '') {
      lines.push({ raw: '' });
    }
    for (const line of newLines) {
      lines.push({ raw: line, key: line.split('=')[0], value: line.split('=').slice(1).join('=') });
    }
  }

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, serializeEnvFile(lines), 'utf-8');
}

// ---------------------------------------------------------------------------
// Workspace bootstrap helpers (task 3.3)
// ---------------------------------------------------------------------------

export type BootstrapFileName = keyof typeof DEFAULT_WORKSPACE_FILES;

/**
 * Seed the workspace with default bootstrap files if the directory is empty.
 * Returns the list of file names created.
 * Does NOT overwrite existing files.
 */
export function seedWorkspaceDefaults(workspaceDir: string): string[] {
  fs.mkdirSync(workspaceDir, { recursive: true });
  const existing = new Set(fs.readdirSync(workspaceDir));
  const created: string[] = [];

  for (const [fileName, content] of Object.entries(DEFAULT_WORKSPACE_FILES)) {
    if (!existing.has(fileName)) {
      fs.writeFileSync(path.join(workspaceDir, fileName), `${(content as string).trim()}\n`, 'utf-8');
      created.push(fileName);
    }
  }

  return created;
}

/**
 * Write a single workspace bootstrap file, replacing its content.
 * Validates the filename for safety (letters, numbers, underscores, hyphens + .md).
 */
export function writeWorkspaceFile(
  workspaceDir: string,
  fileName: string,
  content: string,
): void {
  if (!/^[A-Za-z0-9_-]+\.md$/.test(fileName)) {
    throw new Error(`Invalid workspace filename: ${fileName}`);
  }
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, fileName), content, 'utf-8');
}

/**
 * Read a workspace bootstrap file. Returns null if missing.
 */
export function readWorkspaceFileContent(
  workspaceDir: string,
  fileName: string,
): string | null {
  if (!/^[A-Za-z0-9_-]+\.md$/.test(fileName)) {
    return null;
  }
  const filePath = path.join(workspaceDir, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Full plan persistence (orchestrates all three steps)
// ---------------------------------------------------------------------------

export async function persistSetupPlan(plan: SetupPlan): Promise<SetupPersistResult> {
  const errors: string[] = [];
  const workspaceFilesWritten: string[] = [];

  // 1. Write openclaw.json
  try {
    const braveKey = plan.searchBraveApiKey.trim();
    const tavilyKey = plan.searchTavilyApiKey.trim();
    const searchInput =
      braveKey || tavilyKey
        ? { braveApiKey: braveKey || undefined, tavilyApiKey: tavilyKey || undefined }
        : undefined;

    const browserInput =
      !plan.browserHeadless ||
      plan.browserViewportWidth !== 1280 ||
      plan.browserViewportHeight !== 720 ||
      plan.browserNavigationTimeout !== 30000
        ? {
            headless: plan.browserHeadless,
            viewport: { width: plan.browserViewportWidth, height: plan.browserViewportHeight },
            navigationTimeout: plan.browserNavigationTimeout,
          }
        : undefined;

    const agentInput: ConfigWriteInput['agent'] = {
      provider: plan.agentProvider,
      model: plan.agentModel,
    };
    if (plan.agentFallbackProvider.trim() && plan.agentFallbackModel.trim()) {
      agentInput.fallbackProvider = plan.agentFallbackProvider;
      agentInput.fallbackModel = plan.agentFallbackModel;
    }

    writeOpenclawConfig({
      configPath: plan.configPath ?? '',
      providers: plan.providers,
      agent: agentInput,
      search: searchInput,
      browser: browserInput,
    });
  } catch (err) {
    errors.push(`Config write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Write .env.local
  try {
    const envValues: Record<string, string> = {};
    if (plan.databaseUrl.trim()) envValues['DATABASE_URL'] = plan.databaseUrl.trim();
    if (plan.openclawApiKey.trim()) envValues['OPENCLAW_API_KEY'] = plan.openclawApiKey.trim();
    if (plan.insecureLocal) envValues['OPENCLAW_ALLOW_INSECURE_LOCAL'] = 'true';
    if (plan.telegramBotToken.trim()) envValues['TELEGRAM_BOT_TOKEN'] = plan.telegramBotToken.trim();
    if (plan.telegramWebhookSecret.trim()) envValues['TELEGRAM_WEBHOOK_SECRET'] = plan.telegramWebhookSecret.trim();
    if (plan.telegramTransport.trim() && plan.telegramTransport !== 'webhook') {
      envValues['TELEGRAM_TRANSPORT'] = plan.telegramTransport.trim();
    }
    if (plan.whatsappEnabled) envValues['WHATSAPP_ENABLED'] = 'true';
    if (plan.workspaceDir.trim()) envValues['OPENCLAW_WORKSPACE_DIR'] = plan.workspaceDir.trim();

    // Advanced env knobs
    for (const [key, value] of Object.entries(plan.advancedEnv)) {
      if (value.trim()) envValues[key] = value.trim();
    }

    writeEnvLocal(plan.envFilePath ?? '.env.local', envValues);
  } catch (err) {
    errors.push(`Env write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Write workspace files
  try {
    // Ensure workspace exists (seed defaults if empty)
    seedWorkspaceDefaults(plan.workspaceDir);

    // Apply explicit edits
    for (const [fileName, content] of Object.entries(plan.workspaceEdits)) {
      writeWorkspaceFile(plan.workspaceDir, fileName, content);
      workspaceFilesWritten.push(fileName);
    }
  } catch (err) {
    errors.push(`Workspace write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    configPath: plan.configPath ?? '',
    envFilePath: plan.envFilePath ?? '.env.local',
    workspaceFilesWritten,
    errors,
  };
}
