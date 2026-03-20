import fs, { type FSWatcher } from 'fs';
import { loadConfig } from '@/lib/config/loader';
import { providerRegistry } from '@/lib/services/provider-registry';

export interface WatchConfigOptions {
  configPath: string;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 500;

let activeWatcher: FSWatcher | null = null;
let activeWatcherPath: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownHooksRegistered = false;

function clearPendingReload(): void {
  if (!debounceTimer) {
    return;
  }

  clearTimeout(debounceTimer);
  debounceTimer = null;
}

function closeWatcher(): void {
  clearPendingReload();
  activeWatcher?.close();
  activeWatcher = null;
  activeWatcherPath = null;
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) {
    return;
  }

  shutdownHooksRegistered = true;

  const shutdown = () => {
    closeWatcher();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

function reloadFromConfigPath(configPath: string): void {
  try {
    const result = loadConfig({
      configPath,
    });

    providerRegistry.setState({
      config: result.config,
      configPath: result.configPath,
    });

    console.info(
      `[provider-config] Reloaded provider registry (${providerRegistry.list().map(provider => provider.id).join(', ') || 'no providers'})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[provider-config] Failed to reload ${configPath}: ${message}`);
  }
}

export function watchConfig(options: WatchConfigOptions): FSWatcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  if (activeWatcher && activeWatcherPath === options.configPath) {
    return activeWatcher;
  }

  closeWatcher();
  registerShutdownHooks();

  activeWatcherPath = options.configPath;
  activeWatcher = fs.watch(options.configPath, () => {
    clearPendingReload();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      reloadFromConfigPath(options.configPath);
    }, debounceMs);
  });

  return activeWatcher;
}

export function stopWatchingConfig(): void {
  closeWatcher();
}
