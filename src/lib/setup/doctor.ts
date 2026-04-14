// Setup module - structured read-only startup diagnostics
// Reuses existing init checks without triggering runtime side-effects

import type { DiagnosticsResult } from './types';
import { checkConfigFile } from '@/lib/init/checks/config';
import { checkProviderKeys } from '@/lib/init/checks/providers';
import { checkDatabase } from '@/lib/init/checks/database';
import { getTelegramConfig } from '@/lib/config/runtime';
import {
  getInternalAuthStartupStatus,
  INTERNAL_AUTH_ENV_VAR,
  INSECURE_LOCAL_AUTH_ENV_VAR,
} from '@/lib/internal-auth';
import { getRuntimeConfig } from '@/lib/config/runtime';
import { getExecStartupDiagnostics } from '@/lib/services/exec-runtime';

/**
 * Run startup requirement checks in read-only mode.
 * Does NOT initialize adapters, backplane clients, workspace, or optional tools.
 * Safe to call before the Next.js app boots.
 */
export async function getStartupDiagnostics(): Promise<DiagnosticsResult> {
  const hardFailures: DiagnosticsResult['hardFailures'] = [];
  const softWarnings: DiagnosticsResult['softWarnings'] = [];

  // 1. Config file existence
  const configCheck = checkConfigFile();
  if (!configCheck.success) {
    hardFailures.push({
      type: 'config-file',
      error: configCheck.error!,
      guidance: configCheck.guidance!,
    });
  }

  // 2. Provider keys resolve (also validates schema)
  if (hardFailures.length === 0) {
    const providerCheck = checkProviderKeys();
    if (!providerCheck.success) {
      hardFailures.push({
        type: 'provider-keys',
        error: providerCheck.error!,
        guidance: providerCheck.guidance!,
      });
    }
  }

  // 3. Exec runtime diagnostics (graceful if provider registry not initialized)
  if (hardFailures.length === 0) {
    try {
      const execConfig = getRuntimeConfig().exec;
      const diagnostics = getExecStartupDiagnostics({
        enabled: execConfig.enabled,
        defaultTier: execConfig.defaultTier,
        maxTier: execConfig.maxTier,
        containerRuntime: execConfig.containerRuntime,
      });
      if (execConfig.enabled && !diagnostics.defaultTierViable) {
        hardFailures.push({
          type: 'exec-runtime',
          error: `Exec default tier '${diagnostics.defaultTier}' requires Docker or Podman, but none is available`,
          guidance: 'Install Docker or Podman, or set runtime.exec.defaultTier to host before enabling exec',
        });
      } else if (execConfig.enabled && !diagnostics.containerRuntime) {
        softWarnings.push({
          type: 'exec-runtime',
          warning: 'Docker/Podman not detected; sandbox and locked-down tiers will fail until a container runtime is installed',
        });
      }
    } catch {
      // getRuntimeConfig returns defaults gracefully; skip exec check if it throws
    }
  }

  // 4. Internal auth
  if (hardFailures.length === 0) {
    const authStatus = getInternalAuthStartupStatus();
    if (authStatus.error) {
      hardFailures.push({
        type: 'internal-auth',
        error: authStatus.error,
        guidance: `Set ${INTERNAL_AUTH_ENV_VAR} for secure bearer auth, or set ${INSECURE_LOCAL_AUTH_ENV_VAR}=true for local-only testing`,
      });
    } else if (authStatus.warning) {
      softWarnings.push({ type: 'internal-auth', warning: authStatus.warning });
    }
  }

  // 5. Database (async, connects to verify migration state)
  if (hardFailures.length === 0) {
    const dbCheck = await checkDatabase();
    if (!dbCheck.success) {
      hardFailures.push({
        type: 'database',
        error: dbCheck.error!,
        guidance: dbCheck.guidance!,
      });
    }
  }

  // 6. Soft: optional adapters
  const telegramConfig = getTelegramConfig();
  if (!telegramConfig) {
    softWarnings.push({
      type: 'telegram-adapter',
      warning: 'Telegram not configured (set channels.telegram.botToken in openclaw.json to enable)',
    });
  }

  if (process.env.WHATSAPP_ENABLED !== 'true') {
    softWarnings.push({
      type: 'whatsapp-adapter',
      warning: 'WhatsApp not configured (set WHATSAPP_ENABLED=true to enable)',
    });
  }

  return {
    hardFailures,
    softWarnings,
    ready: hardFailures.length === 0,
  };
}
