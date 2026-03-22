import { ensureProviderRegistryInitialized } from '@/lib/services/provider-registry';
import type { PrismaLogLevel } from '@/lib/config/schema';

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
    maxTimeout: number;
    maxOutputSize: number;
  };
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

export function getRuntimeConfig(): RuntimeBehaviorConfig {
  const { config } = ensureProviderRegistryInitialized();
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

  return {
    safety: {
      subagentTimeout: runtime?.safety?.subagentTimeout ?? envSubagentTimeout ?? 300,
      maxSpawnDepth: runtime?.safety?.maxSpawnDepth ?? envMaxSpawnDepth ?? 3,
      maxIterations: runtime?.safety?.maxIterations ?? 5,
      maxDeliveryRetries: runtime?.safety?.maxDeliveryRetries ?? 5,
    },
    retention: {
      tasks: runtime?.retention?.tasks ?? 7,
      auditLogs: runtime?.retention?.auditLogs ?? 90,
    },
    logging: {
      prisma: runtime?.logging?.prisma ?? ['error', 'warn'],
    },
    performance: {
      pollInterval: runtime?.performance?.pollInterval ?? 5000,
      heartbeatInterval: runtime?.performance?.heartbeatInterval ?? 60000,
      deliveryBatchSize: runtime?.performance?.deliveryBatchSize ?? 10,
      contextWindow: runtime?.performance?.contextWindow ?? 128000,
      compactionThreshold: runtime?.performance?.compactionThreshold ?? envCompactionThreshold ?? 0.5,
    },
    exec: {
      enabled: runtime?.exec?.enabled ?? false,
      allowlist: runtime?.exec?.allowlist ?? [],
      maxTimeout: runtime?.exec?.maxTimeout ?? 30,
      maxOutputSize: runtime?.exec?.maxOutputSize ?? 10000,
    },
  };
}

export function getPrismaLogConfig(): PrismaLogLevel[] {
  return getRuntimeConfig().logging.prisma;
}
