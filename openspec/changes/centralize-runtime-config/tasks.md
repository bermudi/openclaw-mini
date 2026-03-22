## 1. Schema & Types

- [ ] 1.1 Add runtime config types to `src/lib/config/schema.ts` (RuntimeSafetyConfig, RuntimeRetentionConfig, RuntimeLoggingConfig, RuntimePerformanceConfig, RuntimeConfig)
- [ ] 1.2 Add Zod schemas for runtime config sections with validation
- [ ] 1.3 Extend runtimeConfigSchema to include optional `runtime` section
- [ ] 1.4 Add defaults for all runtime config values

## 2. Runtime Config Module

- [ ] 2.1 Create `src/lib/config/runtime.ts` with `getRuntimeConfig()` function
- [ ] 2.2 Implement typed access to each config section (safety, retention, logging, performance)
- [ ] 2.3 Add deprecation warnings for env vars (`OPENCLAW_MAX_SPAWN_DEPTH`, `OPENCLAW_SUBAGENT_TIMEOUT`, `OPENCLAW_SESSION_TOKEN_THRESHOLD`)
- [ ] 2.4 Export helper functions for common access patterns (e.g., `getPrismaLogConfig()`)

## 3. Migrate Consumers - Safety Limits

- [ ] 3.1 Update `src/lib/tools.ts` - use `getRuntimeConfig().safety.subagentTimeout` and `maxSpawnDepth`
- [ ] 3.2 Update `src/lib/subagent-config.ts` - use `getRuntimeConfig().safety.maxIterations`
- [ ] 3.3 Update `src/lib/services/delivery-service.ts` - use `getRuntimeConfig().safety.maxDeliveryRetries`
- [ ] 3.4 Update `src/lib/services/task-queue.ts` - use `getRuntimeConfig().safety.subagentTimeout` (remove env var)

## 4. Migrate Consumers - Retention

- [ ] 4.1 Update `mini-services/scheduler/index.ts` - use `getRuntimeConfig().retention.tasks` for cleanup
- [ ] 4.2 Update `src/lib/services/audit-service.ts` - use `getRuntimeConfig().retention.auditLogs`

## 5. Migrate Consumers - Logging

- [ ] 5.1 Update `src/lib/db.ts` - use `getPrismaLogConfig()` for PrismaClient log level
- [ ] 5.2 Update `mini-services/scheduler/index.ts` - use `getPrismaLogConfig()` for PrismaClient log level

## 6. Migrate Consumers - Performance

- [ ] 6.1 Update `mini-services/scheduler/index.ts` - use `getRuntimeConfig().performance.pollInterval` and `heartbeatInterval`
- [ ] 6.2 Update `src/lib/services/delivery-service.ts` - use `getRuntimeConfig().performance.deliveryBatchSize`
- [ ] 6.3 Update `src/lib/services/model-provider.ts` - use `getRuntimeConfig().performance.contextWindow` and `compactionThreshold`

## 7. Documentation & Examples

- [ ] 7.1 Update `examples/openclaw.json` with runtime section example
- [ ] 7.2 Update `openspec/specs/config-file/spec.md` to include runtime section in canonical spec

## 8. Testing

- [ ] 8.1 Add unit tests for runtime config schema validation
- [ ] 8.2 Add unit tests for `getRuntimeConfig()` with defaults
- [ ] 8.3 Add unit tests for deprecation warnings when env vars are used
