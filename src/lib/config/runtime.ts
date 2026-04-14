import { ensureProviderRegistryInitialized, providerRegistry } from '@/lib/services/provider-registry';
import {
  detectContainerRuntime,
} from '@/lib/services/exec-runtime';
import type {
  BrowserConfig,
  BrowserViewportConfig,
  ChannelsConfig,
  ContainerRuntime,
  EmbeddingProvider,
  ExecLaunchMode,
  ExecMountConfig,
  ExecMountPermission,
  ExecTier,
  McpServerConfig,
  PrismaLogLevel,
  TelegramTransport,
  VectorRetrievalMode,
} from '@/lib/config/schema';

export interface RuntimeBehaviorConfig {
  safety: {
    subagentTimeout: number;
    maxSpawnDepth: number;
    maxIterations: number;
    maxDeliveryRetries: number;
  };
  retention: {
    tasks: number;
    auditLogs: number;
  };
  logging: {
    prisma: PrismaLogLevel[];
  };
  performance: {
    pollInterval: number;
    heartbeatInterval: number;
    deliveryBatchSize: number;
    contextWindow: number;
    compactionThreshold: number;
  };
  exec: {
    enabled: boolean;
    allowlist: string[];
    defaultTier: ExecTier;
    maxTier: ExecTier;
    containerRuntime: ContainerRuntime | null;
    mounts: Array<{
      alias: string;
      hostPath: string;
      permissions: ExecMountPermission;
      createIfMissing: boolean;
    }>;
    maxTimeout: number;
    maxOutputSize: number;
    maxSessions: number;
    sessionTimeout: number;
    sessionBufferSize: number;
    foregroundYieldMs: number;
    defaultLaunchMode: ExecLaunchMode;
    defaultBackground: boolean;
    ptyCols: number;
    ptyRows: number;
    forcePtyFallback: boolean;
  };
  memory: {
    embeddingProvider: EmbeddingProvider;
    embeddingModel: string;
    embeddingVersion: string;
    embeddingDimensions: number;
    chunkingThreshold: number;
    chunkOverlap: number;
    vectorRetrievalMode: VectorRetrievalMode;
    recallConfidenceThreshold: number;
    maxSearchResults: number;
  };
}

export interface ResolvedBrowserConfig {
  headless: boolean;
  viewport: BrowserViewportConfig;
  navigationTimeout: number;
}

const warnedEnvVars = new Set<string>();

export function resetRuntimeWarningsForTests(): void {
  warnedEnvVars.clear();
}

function warnDeprecatedEnvVar(envVar: string, replacement: string): void {
  if (warnedEnvVars.has(envVar)) {
    return;
  }
  warnedEnvVars.add(envVar);
  console.warn(`[runtime-config] ${envVar} env var is deprecated, use ${replacement} in config`);
}

function normalizeExecMounts(mounts?: ExecMountConfig[]): RuntimeBehaviorConfig['exec']['mounts'] {
  return (mounts ?? []).map(mount => ({
    alias: mount.alias ?? '',
    hostPath: mount.hostPath ?? '',
    permissions: mount.permissions ?? 'read-only',
    createIfMissing: mount.createIfMissing ?? false,
  }));
}

function getDefaults(): RuntimeBehaviorConfig {
  return {
    safety: {
      subagentTimeout: 300,
      maxSpawnDepth: 3,
      maxIterations: 5,
      maxDeliveryRetries: 5,
    },
    retention: {
      tasks: 7,
      auditLogs: 90,
    },
    logging: {
      prisma: ['error', 'warn'],
    },
    performance: {
      pollInterval: 5000,
      heartbeatInterval: 60000,
      deliveryBatchSize: 10,
      contextWindow: 128000,
      compactionThreshold: 0.5,
    },
    exec: {
      enabled: false,
      allowlist: [],
      defaultTier: 'host',
      maxTier: 'host',
      containerRuntime: null,
      mounts: [],
      maxTimeout: 30,
      maxOutputSize: 10000,
      maxSessions: 8,
      sessionTimeout: 300,
      sessionBufferSize: 100000,
      foregroundYieldMs: 1000,
      defaultLaunchMode: 'child',
      defaultBackground: false,
      ptyCols: 120,
      ptyRows: 30,
      forcePtyFallback: false,
    },
    memory: {
      embeddingProvider: 'disabled',
      embeddingModel: 'text-embedding-3-small',
      embeddingVersion: 'v1',
      embeddingDimensions: 1536,
      chunkingThreshold: 600,
      chunkOverlap: 120,
      vectorRetrievalMode: 'auto',
      recallConfidenceThreshold: 0.4,
      maxSearchResults: 20,
    },
  };
}

function getBrowserDefaults(): ResolvedBrowserConfig {
  return {
    headless: true,
    viewport: {
      width: 1280,
      height: 720,
    },
    navigationTimeout: 30000,
  };
}

function resolveBrowserConfig(config?: BrowserConfig): ResolvedBrowserConfig {
  const defaults = getBrowserDefaults();

  return {
    headless: config?.headless ?? defaults.headless,
    viewport: {
      width: config?.viewport?.width ?? defaults.viewport.width,
      height: config?.viewport?.height ?? defaults.viewport.height,
    },
    navigationTimeout: config?.navigationTimeout ?? defaults.navigationTimeout,
  };
}

export function getRuntimeConfig(): RuntimeBehaviorConfig {
  let state: ReturnType<typeof providerRegistry.getState> | null = null;
  try {
    state = ensureProviderRegistryInitialized();
  } catch {
    return getDefaults();
  }

  if (!state) {
    return getDefaults();
  }

  const { config } = state;
  const runtime = config.runtime;

  if (process.env.OPENCLAW_MAX_SPAWN_DEPTH) {
    warnDeprecatedEnvVar('OPENCLAW_MAX_SPAWN_DEPTH', 'runtime.safety.maxSpawnDepth');
  }

  if (process.env.OPENCLAW_SUBAGENT_TIMEOUT) {
    warnDeprecatedEnvVar('OPENCLAW_SUBAGENT_TIMEOUT', 'runtime.safety.subagentTimeout');
  }

  if (process.env.OPENCLAW_SESSION_TOKEN_THRESHOLD) {
    warnDeprecatedEnvVar('OPENCLAW_SESSION_TOKEN_THRESHOLD', 'runtime.performance.compactionThreshold');
  }

  const rawMaxDepth = parseInt(process.env.OPENCLAW_MAX_SPAWN_DEPTH ?? '', 10);
  const envMaxSpawnDepth = Number.isInteger(rawMaxDepth) && rawMaxDepth > 0 ? rawMaxDepth : undefined;

  const rawTimeout = parseInt(process.env.OPENCLAW_SUBAGENT_TIMEOUT ?? '', 10);
  const envSubagentTimeout = Number.isInteger(rawTimeout) && rawTimeout > 0 ? rawTimeout : undefined;

  const rawThreshold = process.env.OPENCLAW_SESSION_TOKEN_THRESHOLD
    ? Number.parseFloat(process.env.OPENCLAW_SESSION_TOKEN_THRESHOLD)
    : Number.NaN;
  const envCompactionThreshold = Number.isFinite(rawThreshold) ? rawThreshold : undefined;

  const defaults = getDefaults();
  const configuredExec = runtime?.exec;
  const resolvedContainerRuntime = detectContainerRuntime(configuredExec?.containerRuntime ?? defaults.exec.containerRuntime);

  return {
    safety: {
      subagentTimeout: runtime?.safety?.subagentTimeout ?? envSubagentTimeout ?? defaults.safety.subagentTimeout,
      maxSpawnDepth: runtime?.safety?.maxSpawnDepth ?? envMaxSpawnDepth ?? defaults.safety.maxSpawnDepth,
      maxIterations: runtime?.safety?.maxIterations ?? defaults.safety.maxIterations,
      maxDeliveryRetries: runtime?.safety?.maxDeliveryRetries ?? defaults.safety.maxDeliveryRetries,
    },
    retention: {
      tasks: runtime?.retention?.tasks ?? defaults.retention.tasks,
      auditLogs: runtime?.retention?.auditLogs ?? defaults.retention.auditLogs,
    },
    logging: {
      prisma: runtime?.logging?.prisma ?? defaults.logging.prisma,
    },
    performance: {
      pollInterval: runtime?.performance?.pollInterval ?? defaults.performance.pollInterval,
      heartbeatInterval: runtime?.performance?.heartbeatInterval ?? defaults.performance.heartbeatInterval,
      deliveryBatchSize: runtime?.performance?.deliveryBatchSize ?? defaults.performance.deliveryBatchSize,
      contextWindow: runtime?.performance?.contextWindow ?? defaults.performance.contextWindow,
      compactionThreshold: runtime?.performance?.compactionThreshold ?? envCompactionThreshold ?? defaults.performance.compactionThreshold,
    },
    exec: {
      enabled: configuredExec?.enabled ?? defaults.exec.enabled,
      allowlist: configuredExec?.allowlist ?? defaults.exec.allowlist,
      defaultTier: configuredExec?.defaultTier ?? defaults.exec.defaultTier,
      maxTier: configuredExec?.maxTier ?? defaults.exec.maxTier,
      containerRuntime: resolvedContainerRuntime,
      mounts: normalizeExecMounts(configuredExec?.mounts ?? defaults.exec.mounts),
      maxTimeout: configuredExec?.maxTimeout ?? defaults.exec.maxTimeout,
      maxOutputSize: configuredExec?.maxOutputSize ?? defaults.exec.maxOutputSize,
      maxSessions: configuredExec?.maxSessions ?? defaults.exec.maxSessions,
      sessionTimeout: configuredExec?.sessionTimeout ?? defaults.exec.sessionTimeout,
      sessionBufferSize: configuredExec?.sessionBufferSize ?? defaults.exec.sessionBufferSize,
      foregroundYieldMs: configuredExec?.foregroundYieldMs ?? defaults.exec.foregroundYieldMs,
      defaultLaunchMode: configuredExec?.defaultLaunchMode ?? defaults.exec.defaultLaunchMode,
      defaultBackground: configuredExec?.defaultBackground ?? defaults.exec.defaultBackground,
      ptyCols: configuredExec?.ptyCols ?? defaults.exec.ptyCols,
      ptyRows: configuredExec?.ptyRows ?? defaults.exec.ptyRows,
      forcePtyFallback: configuredExec?.forcePtyFallback ?? defaults.exec.forcePtyFallback,
    },
    memory: {
      embeddingProvider: runtime?.memory?.embeddingProvider ?? defaults.memory.embeddingProvider,
      embeddingModel: runtime?.memory?.embeddingModel ?? defaults.memory.embeddingModel,
      embeddingVersion: runtime?.memory?.embeddingVersion ?? defaults.memory.embeddingVersion,
      embeddingDimensions: runtime?.memory?.embeddingDimensions ?? defaults.memory.embeddingDimensions,
      chunkingThreshold: runtime?.memory?.chunkingThreshold ?? defaults.memory.chunkingThreshold,
      chunkOverlap: runtime?.memory?.chunkOverlap ?? defaults.memory.chunkOverlap,
      vectorRetrievalMode: runtime?.memory?.vectorRetrievalMode ?? defaults.memory.vectorRetrievalMode,
      recallConfidenceThreshold: runtime?.memory?.recallConfidenceThreshold ?? defaults.memory.recallConfidenceThreshold,
      maxSearchResults: runtime?.memory?.maxSearchResults ?? defaults.memory.maxSearchResults,
    },
  };
}

export function getBrowserConfig(config?: BrowserConfig): ResolvedBrowserConfig {
  if (config) {
    return resolveBrowserConfig(config);
  }

  let state: ReturnType<typeof providerRegistry.getState> | null = null;
  try {
    state = ensureProviderRegistryInitialized();
  } catch {
    return getBrowserDefaults();
  }

  return resolveBrowserConfig(state.config.browser);
}

export function getMcpServers(): Record<string, McpServerConfig> {
  let state: ReturnType<typeof providerRegistry.getState> | null = null;
  try {
    state = ensureProviderRegistryInitialized();
  } catch {
    return {};
  }

  return state.config.mcp?.servers ?? {};
}

export function getPrismaLogConfig(): PrismaLogLevel[] {
  return getRuntimeConfig().logging.prisma;
}

export function getChannelsConfig(): ChannelsConfig | undefined {
  let state: ReturnType<typeof providerRegistry.getState> | null = null;
  try {
    state = ensureProviderRegistryInitialized();
  } catch {
    return undefined;
  }

  return state.config.channels;
}

export interface ResolvedTelegramConfig {
  botToken: string;
  webhookSecret?: string;
  transport: TelegramTransport;
}

export function getTelegramConfig(): ResolvedTelegramConfig | null {
  const channels = getChannelsConfig();
  const telegram = channels?.telegram;

  // Fall back to env vars for backwards compatibility
  const botToken = telegram?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return null;
  }

  return {
    botToken,
    webhookSecret: telegram?.webhookSecret ?? process.env.TELEGRAM_WEBHOOK_SECRET,
    transport: telegram?.transport ?? (process.env.TELEGRAM_TRANSPORT?.trim().toLowerCase() === 'polling' ? 'polling' : 'webhook'),
  };
}

export function getOffloadTokenThreshold(): number {
  const raw = parseInt(process.env.OPENCLAW_OFFLOAD_TOKEN_THRESHOLD ?? '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 2000;
}
