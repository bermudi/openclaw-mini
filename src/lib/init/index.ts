// OpenClaw Agent Runtime - Init Module
// Unified initialization with hard/soft requirement validation

import type { InitResult, HardRequirement, SoftRequirement } from './types';
import { formatInitError, printInitError, printInitSuccess } from './format-error';
import { checkConfigFile } from './checks/config';
import { checkProviderKeys } from './checks/providers';
import { checkDatabase } from './checks/database';
import { checkDefaultAgent } from './checks/agent';
import { initializeProviderRegistry } from '@/lib/services/provider-registry';
import { initializeWorkspace } from '@/lib/services/workspace-service';
import { initializeAdapters } from '@/lib/adapters';
import { hookSubscriptionManager } from '@/lib/services/hook-subscription-manager';
import { watchConfig } from '@/lib/config/watcher';
import { registerOptionalTools } from '@/lib/tools';
import { memoryIndexingService } from '@/lib/services/memory-indexing';

let initialized = false;
let initResult: InitResult | null = null;

export function isInitialized(): boolean {
  return initialized;
}

export function getInitResult(): InitResult | null {
  return initResult;
}

export async function initialize(): Promise<InitResult> {
  if (initialized) {
    return initResult!;
  }

  const result: InitResult = {
    success: true,
    hardFailures: [],
    softWarnings: [],
  };

  // === HARD REQUIREMENTS ===

  // 1. Config file exists
  const configCheck = checkConfigFile();
  if (!configCheck.success) {
    result.hardFailures.push({
      type: 'config-file',
      error: configCheck.error!,
      guidance: configCheck.guidance!,
    });
  }

  // 2. Provider keys resolve (also validates schema)
  if (result.hardFailures.length === 0) {
    const providerCheck = checkProviderKeys();
    if (!providerCheck.success) {
      result.hardFailures.push({
        type: 'provider-keys',
        error: providerCheck.error!,
        guidance: providerCheck.guidance!,
      });
    }
  }

  // 3. At least one provider configured
  if (result.hardFailures.length === 0) {
    // Already checked in checkProviderKeys
  }

  // Initialize provider registry if hard requirements pass so far
  if (result.hardFailures.length === 0) {
    try {
      const runtimeState = initializeProviderRegistry();

      // Start config watcher
      try {
        watchConfig({ configPath: runtimeState.configPath });
      } catch (error) {
        console.error('[Init] Config watcher failed:', error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.hardFailures.push({
        type: 'provider-configured',
        error: `Provider registry initialization failed: ${message}`,
        guidance: 'Check your provider configuration in openclaw.json',
      });
    }
  }

  // 4. Database connection and migration
  if (result.hardFailures.length === 0) {
    const dbCheck = await checkDatabase();
    if (!dbCheck.success) {
      result.hardFailures.push({
        type: 'database',
        error: dbCheck.error!,
        guidance: dbCheck.guidance!,
      });
    }
  }

  // 5. Default agent auto-creation
  if (result.hardFailures.length === 0) {
    const agentCheck = await checkDefaultAgent();
    if (!agentCheck.success) {
      result.hardFailures.push({
        type: 'agent',
        error: agentCheck.error!,
        guidance: agentCheck.guidance!,
      });
    }
  }

  // === SOFT REQUIREMENTS (only if hard requirements pass) ===

  if (result.hardFailures.length === 0) {
    // Check Telegram adapter
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      result.softWarnings.push({
        type: 'telegram-adapter',
        warning: 'Telegram adapter not configured (set TELEGRAM_BOT_TOKEN to enable)',
      });
    }

    // Check WhatsApp adapter
    if (process.env.WHATSAPP_ENABLED !== 'true') {
      result.softWarnings.push({
        type: 'whatsapp-adapter',
        warning: 'WhatsApp adapter not configured (set WHATSAPP_ENABLED=true to enable)',
      });
    }

    // Check workspace directory
    try {
      initializeWorkspace();
    } catch (error) {
      result.softWarnings.push({
        type: 'workspace-dir',
        warning: `Workspace directory could not be created: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // Initialize adapters
    initializeAdapters();

    try {
      await registerOptionalTools();
    } catch (error) {
      result.softWarnings.push({
        type: 'browser-tool',
        warning: `Browser tool registration skipped: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      await memoryIndexingService.ensureIndexStructures();
    } catch (error) {
      result.softWarnings.push({
        type: 'memory-index',
        warning: `Memory index bootstrap skipped: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // Initialize hook subscriptions
    let hookTriggerCount = 0;
    try {
      hookTriggerCount = await hookSubscriptionManager.initialize();
    } catch (error) {
      console.error('[Init] Hook subscription manager failed:', error);
      result.softWarnings.push({
        type: 'hook-triggers',
        warning: `Hook triggers could not be initialized: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (hookTriggerCount === 0) {
      result.softWarnings.push({
        type: 'hook-triggers',
        warning: 'No hook triggers configured',
      });
    }
  }

  // === FINALIZE ===

  result.success = result.hardFailures.length === 0;
  initResult = result;
  initialized = true;

  if (!result.success) {
    printInitError(result);
  } else {
    printInitSuccess();
    if (result.softWarnings.length > 0) {
      console.log('Warnings:');
      for (const w of result.softWarnings) {
        console.log(`  • ${w.type}: ${w.warning}`);
      }
    }
  }

  return result;
}

export function resetInitForTests(): void {
  initialized = false;
  initResult = null;
}
