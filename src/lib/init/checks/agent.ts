// OpenClaw Agent Runtime - Agent Check
// Ensures default agent exists, creates if missing

import { db } from '@/lib/db';
import { providerRegistry } from '@/lib/services/provider-registry';
import { agentService } from '@/lib/services/agent-service';
import type { CheckResult } from '../types';

export async function checkDefaultAgent(): Promise<CheckResult> {
  try {
    const existingDefault = await db.agent.findFirst({
      where: { isDefault: true },
    });

    if (existingDefault) {
      return { success: true };
    }

    const usableAgents = await agentService.getUsableAgents();
    if (usableAgents.length === 1) {
      await db.agent.update({
        where: { id: usableAgents[0]!.id },
        data: { isDefault: true },
      });
      console.log(`[Init] Promoted existing agent '${usableAgents[0]!.id}' to default agent`);
      return { success: true };
    }

    if (usableAgents.length > 1) {
      return {
        success: false,
        error: 'Multiple usable agents exist, but none is marked as default',
        guidance: 'Mark one agent as default or add an explicit channel binding before starting message-based adapters',
      };
    }

    // Get provider/model from config
    const state = providerRegistry.getState();
    const provider = state.config.agent.provider;
    const model = state.config.agent.model;

    // Verify provider exists in registry
    const providerDef = providerRegistry.get(provider);
    if (!providerDef) {
      return {
        success: false,
        error: `Provider '${provider}' is not registered in the provider registry`,
        guidance: `Check your openclaw.json configuration. Provider '${provider}' must be defined in the 'providers' section.`,
      };
    }

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
