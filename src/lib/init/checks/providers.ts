// OpenClaw Agent Runtime - Provider Keys Check
// Validates provider API key env var resolution

import { loadConfig } from '@/lib/config/loader';
import type { CheckResult } from '../types';

export function checkProviderKeys(): CheckResult {
  try {
    // loadConfig will throw if any provider's apiKey references a missing env var
    const result = loadConfig();

    // Check that at least one provider is configured
    const providerIds = Object.keys(result.config.providers);
    if (providerIds.length === 0) {
      return {
        success: false,
        error: 'No providers configured in config file',
        guidance: 'Add at least one provider to the "providers" section in openclaw.json',
      };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for missing env var error
    const envVarMatch = message.match(/references missing environment variable '([A-Z0-9_]+)' in apiKey/);
    if (envVarMatch) {
      const providerMatch = message.match(/Provider '([^']+)' references/);
      const providerId = providerMatch ? providerMatch[1] : 'unknown';
      const envVar = envVarMatch[1];

      return {
        success: false,
        error: `Provider '${providerId}' references missing environment variable '${envVar}'`,
        guidance: `Set the ${envVar} environment variable or update the apiKey for provider '${providerId}' in openclaw.json`,
      };
    }

    // Check for schema validation error
    if (message.includes('validation') || message.includes('invalid')) {
      return {
        success: false,
        error: `Config validation failed: ${message}`,
        guidance: 'Fix the config file structure to match the expected schema',
      };
    }

    return {
      success: false,
      error: message,
      guidance: 'Check your config file and environment variables',
    };
  }
}
