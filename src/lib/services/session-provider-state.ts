// OpenClaw Agent Runtime - Session Provider State
// Per-session active provider/model state (ephemeral, in-memory)

import { providerRegistry } from './provider-registry';

export interface ActiveProviderState {
  activeProvider: string;
  activeModel: string;
}

export type SwitchProviderResult =
  | { success: true }
  | { success: false; error: string; available: string[] };

class SessionProviderStateService {
  private readonly sessions = new Map<string, ActiveProviderState>();

  getOrInit(sessionId: string): ActiveProviderState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const { config } = providerRegistry.getState();
    const defaults: ActiveProviderState = {
      activeProvider: config.agent.provider,
      activeModel: config.agent.model,
    };
    this.sessions.set(sessionId, defaults);
    return defaults;
  }

  switchProvider(sessionId: string, providerName: string): SwitchProviderResult {
    const definition = providerRegistry.get(providerName);
    const available = providerRegistry.list().map(p => p.id);

    if (!definition) {
      return {
        success: false,
        error: `Unknown provider '${providerName}'`,
        available,
      };
    }

    const current = this.getOrInit(sessionId);
    this.sessions.set(sessionId, { ...current, activeProvider: providerName });
    return { success: true };
  }

  switchModel(sessionId: string, modelName: string): void {
    const current = this.getOrInit(sessionId);
    this.sessions.set(sessionId, { ...current, activeModel: modelName });
  }

  listProviders(): string[] {
    return providerRegistry.list().map(p => p.id);
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  resetForTests(): void {
    this.sessions.clear();
  }
}

export const sessionProviderState = new SessionProviderStateService();
