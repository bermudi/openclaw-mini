// Setup module - build an initial SetupPlan from discovery results

import type { SetupDiscovery, SetupPlan } from './types';

/**
 * Build the initial form state for the TUI by prefilling values from discovery.
 * All fields are strings/booleans ready for the form; the TUI mutates this via setState.
 */
export function buildInitialPlan(discovery: SetupDiscovery): SetupPlan {
  return {
    configPath: discovery.configPath,
    envFilePath: discovery.envFilePath,
    databaseUrl: discovery.envVars.databaseUrl ?? '',
    providers: discovery.existingProviders,
    agentProvider: discovery.existingAgent?.provider ?? '',
    agentModel: discovery.existingAgent?.model ?? '',
    agentFallbackProvider: discovery.existingAgent?.fallbackProvider ?? '',
    agentFallbackModel: discovery.existingAgent?.fallbackModel ?? '',
    openclawApiKey: discovery.envVars.openclawApiKey ?? '',
    insecureLocal: discovery.envVars.insecureLocal ?? false,
    telegramBotToken: discovery.envVars.telegramBotToken ?? '',
    telegramWebhookSecret: discovery.envVars.telegramWebhookSecret ?? '',
    telegramTransport: discovery.envVars.telegramTransport ?? 'webhook',
    whatsappEnabled: discovery.envVars.whatsappEnabled ?? false,
    workspaceDir: discovery.workspaceDir,
    workspaceEdits: {},
    searchBraveApiKey: (discovery.existingSearch?.braveApiKey as string | undefined) ?? '',
    searchTavilyApiKey: (discovery.existingSearch?.tavilyApiKey as string | undefined) ?? '',
    browserHeadless: true,
    browserViewportWidth: 1280,
    browserViewportHeight: 720,
    browserNavigationTimeout: 30000,
    advancedEnv: {
      OPENCLAW_SESSION_COMPACTION_THRESHOLD: discovery.envVars.sessionCompactionThreshold ?? '',
      OPENCLAW_SESSION_RETAIN_COUNT: discovery.envVars.sessionRetainCount ?? '',
      OPENCLAW_HISTORY_CAP_BYTES: discovery.envVars.historyCapBytes ?? '',
      OPENCLAW_HISTORY_RETENTION_DAYS: discovery.envVars.historyRetentionDays ?? '',
      OPENCLAW_APP_URL: discovery.envVars.openclawAppUrl ?? '',
      OPENCLAW_WS_PORT: discovery.envVars.openclawWsPort ?? '',
      OPENCLAW_WS_URL: discovery.envVars.openclawWsUrl ?? '',
    },
  };
}
