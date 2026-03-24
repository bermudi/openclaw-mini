// OpenClaw Agent Runtime - Config Check
// Validates config file existence and schema

import fs from 'fs';
import type { CheckResult } from '../types';
import { getConfigPath } from '@/lib/config/loader';

export function checkConfigFile(): CheckResult {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      error: `Config file not found at: ${configPath}`,
      guidance: `Create openclaw.json with providers and agent sections. Example:
{
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
}`,
    };
  }

  return { success: true };
}
