// Setup module - shared types for discovery, plan, persistence, diagnostics, and screen state

export interface DiagnosticFailure {
  type: string;
  error: string;
  guidance: string;
}

export interface DiagnosticWarning {
  type: string;
  warning: string;
}

export interface DiagnosticsResult {
  hardFailures: DiagnosticFailure[];
  softWarnings: DiagnosticWarning[];
  ready: boolean;
}

export interface ProviderRawEntry {
  id: string;
  apiType: string;
  baseURL?: string;
  apiKey: string; // may be "${ENV_VAR}" reference
}

export interface SetupDiscovery {
  configPath: string;
  configExists: boolean;
  envFilePath: string;
  workspaceDir: string;
  workspaceExists: boolean;
  workspaceFiles: string[];
  existingProviders: ProviderRawEntry[];
  existingAgent: {
    provider: string;
    model: string;
    fallbackProvider?: string;
    fallbackModel?: string;
  } | null;
  existingRuntime: Record<string, unknown> | null;
  existingSearch: { braveApiKey?: string; tavilyApiKey?: string } | null;
  existingBrowser: Record<string, unknown> | null;
  existingMcp: Record<string, unknown> | null;
  envVars: {
    databaseUrl?: string;
    openclawApiKey?: string;
    insecureLocal?: boolean;
    telegramBotToken?: string;
    telegramWebhookSecret?: string;
    telegramTransport?: string;
    whatsappEnabled?: boolean;
    workspaceDirOverride?: string;
    sessionCompactionThreshold?: string;
    sessionRetainCount?: string;
    historyCapBytes?: string;
    historyRetentionDays?: string;
    openclawAppUrl?: string;
    openclawWsPort?: string;
    openclawWsUrl?: string;
  };
}

export interface SetupPlan {
  configPath: string;
  envFilePath: string;
  databaseUrl: string;
  providers: ProviderRawEntry[];
  agentProvider: string;
  agentModel: string;
  agentFallbackProvider: string;
  agentFallbackModel: string;
  openclawApiKey: string;
  insecureLocal: boolean;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  telegramTransport: string;
  whatsappEnabled: boolean;
  workspaceDir: string;
  workspaceEdits: Record<string, string>; // fileName -> new content (only files to write)
  searchBraveApiKey: string;
  searchTavilyApiKey: string;
  browserHeadless: boolean;
  browserViewportWidth: number;
  browserViewportHeight: number;
  browserNavigationTimeout: number;
  advancedEnv: Record<string, string>; // env var name -> value
}

export interface SetupPersistResult {
  configPath: string;
  envFilePath: string;
  workspaceFilesWritten: string[];
  errors: string[];
}

export type Screen =
  | 'welcome'
  | 'database'
  | 'provider-list'
  | 'provider-add'
  | 'agent-model'
  | 'auth'
  | 'workspace'
  | 'channels'
  | 'telegram'
  | 'whatsapp'
  | 'advanced-menu'
  | 'advanced-search'
  | 'advanced-browser'
  | 'advanced-env'
  | 'summary'
  | 'saving'
  | 'verification'
  | 'doctor'
  | 'done';
