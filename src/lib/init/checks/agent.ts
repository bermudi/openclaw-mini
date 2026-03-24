// OpenClaw Agent Runtime - Agent Check
// Ensures default agent exists, creates if missing

import { db } from '@/lib/db';
import { providerRegistry } from '@/lib/services/provider-registry';
import type { CheckResult } from '../types';

export async function checkDefaultAgent(): Promise<CheckResult> {
  try {
    const existingDefault = await db.agent.findFirst({
      where: { isDefault: true },
    });

    if (existingDefault) {
      return { success: true };
    }

    // Get provider/model from config
    const state = providerRegistry.getState();
    const provider = state.config.agent.provider;
    const model = state.config.agent.model;

    // Create default agent
    await db.agent.create({
      data: {
        id: 'default',
        name: 'Default Agent',
        model,
        isDefault: true,
        status: 'idle',
        skills: '[]',
      },
    });

    console.log(`[Init] Created default agent with provider '${provider}' and model '${model}'`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `Failed to ensure default agent: ${message}`,
      guidance: 'Check database connectivity and try again',
    };
  }
}
