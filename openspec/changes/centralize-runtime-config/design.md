## Context

Currently, runtime configuration is distributed across:
- **Hardcoded constants** in source files (poll intervals, batch sizes, limits)
- **Environment variables** (`OPENCLAW_MAX_SPAWN_DEPTH`, `OPENCLAW_SUBAGENT_TIMEOUT`, etc.)
- **Config file** (`openclaw.json`) - only for providers and agent settings

This creates several problems:
- Users must hunt through multiple files to find where to adjust behavior
- No single source of truth for runtime behavior
- Inconsistent patterns (some env vars, some hardcoded, some in config)
- Difficult to audit what settings are active

## Goals / Non-Goals

**Goals:**
- Centralize all user-configurable runtime settings in `openclaw.json`
- Provide typed access to config values with sensible defaults
- Maintain backward compatibility during migration (env vars still work but deprecated)
- Improve developer experience - one place to look for configuration

**Non-Goals:**
- Hot-reload for all settings (some require restart, e.g., Prisma log level)
- Moving secrets (API keys) from env vars to config file
- Configuring UI constants or API-imposed limits
- Adding new configurable values beyond what's already scattered

## Decisions

### 1. Config schema structure

**Decision:** Add `runtime` section to `openclaw.json` with nested categories.

```json5
{
  "providers": { ... },
  "agent": { ... },
  "runtime": {
    "safety": {
      "subagentTimeout": 300,      // seconds
      "maxSpawnDepth": 3,
      "maxIterations": 5,
      "maxDeliveryRetries": 5
    },
    "retention": {
      "tasks": 7,                   // days
      "auditLogs": 90               // days
    },
    "logging": {
      "prisma": ["error", "warn"]
    },
    "performance": {
      "pollInterval": 5000,         // ms
      "heartbeatInterval": 60000,   // ms
      "deliveryBatchSize": 10,
      "contextWindow": 128000,
      "compactionThreshold": 0.5
    }
  }
}
```

**Alternatives considered:**
- Flat structure under `runtime` - rejected, harder to organize and understand
- Separate config file for runtime - rejected, adds complexity, users want one file

### 2. Access pattern

**Decision:** Create `src/lib/config/runtime.ts` that exports typed getters with defaults.

```typescript
// src/lib/config/runtime.ts
export function getRuntimeConfig(): RuntimeConfig {
  const config = getLoadedConfig(); // from provider-registry
  return {
    safety: {
      subagentTimeout: config.runtime?.safety?.subagentTimeout ?? 300,
      // ...
    },
    // ...
  };
}
```

Consumers import and use:
```typescript
import { getRuntimeConfig } from '@/lib/config/runtime';

const { subagentTimeout } = getRuntimeConfig().safety;
```

**Alternatives considered:**
- Direct access to config object - rejected, no defaults, no type safety
- Global singleton - rejected, makes testing harder

### 3. Env var migration strategy

**Decision:** Support env vars as fallback during transition, log deprecation warning.

```typescript
const timeout = config.runtime?.safety?.subagentTimeout 
  ?? parseInt(process.env.OPENCLAW_SUBAGENT_TIMEOUT ?? '', 10) 
  ?? 300;

if (process.env.OPENCLAW_SUBAGENT_TIMEOUT) {
  console.warn('[runtime-config] OPENCLAW_SUBAGENT_TIMEOUT env var is deprecated, use runtime.safety.subagentTimeout in config');
}
```

**Alternatives considered:**
- Hard break - rejected, would break existing deployments
- Silent fallback - rejected, users wouldn't know to migrate

### 4. Settings NOT included

**Decision:** Keep these out of config:
- UI constants (toast limits, breakpoints) - not runtime behavior
- API limits (Telegram 4096 chars) - external constraints
- Internal algorithm values (memory confidence boost) - fine-tuning, unlikely to change
- Secrets (API keys) - stay as env vars for security

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Config file becomes "junk drawer" | Schema validation + documentation of what belongs where |
| Circular dependency (config loader needs config) | Runtime config getters don't log, use simple parsing |
| Some settings can't hot-reload | Document which require restart; Prisma log level needs restart |
| Users don't know to migrate | Deprecation warnings in logs, update example config |
