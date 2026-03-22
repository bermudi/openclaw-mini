## Why

Configurable runtime values are scattered across source files (hardcoded constants), environment variables, and the config file. Users must hunt through multiple files to adjust behavior like logging levels, timeouts, and retention policies. This creates poor developer experience and makes operational tuning unnecessarily difficult.

## What Changes

- Add `runtime` section to `openclaw.json` config schema with centralized settings for:
  - **Safety limits**: Subagent timeouts, max spawn depth, max iterations, max delivery retries
  - **Retention policies**: Task cleanup days, audit log retention
  - **Logging**: Prisma log level
  - **Performance tuning**: Poll intervals, batch sizes, context window thresholds
- Create `src/lib/config/runtime.ts` module to expose typed config values with defaults
- Migrate env var-based runtime settings (`OPENCLAW_MAX_SPAWN_DEPTH`, `OPENCLAW_SUBAGENT_TIMEOUT`, `OPENCLAW_SESSION_TOKEN_THRESHOLD`) to config file
- Update all consumers to read from centralized config instead of hardcoded constants or scattered env vars

## Capabilities

### New Capabilities

- `runtime-config`: Centralized configuration for runtime behavior including safety limits, retention policies, logging, and performance tuning

### Modified Capabilities

- `config-file`: Extend config schema to include `runtime` section with validation

## Impact

- **Config schema**: `src/lib/config/schema.ts` - add `runtime` section
- **Config loader**: `src/lib/config/loader.ts` - expose runtime config
- **Consumers**:
  - `src/lib/db.ts` - Prisma log level
  - `mini-services/scheduler/index.ts` - Prisma log level, poll intervals, retention
  - `src/lib/tools.ts` - Subagent timeout, max spawn depth
  - `src/lib/subagent-config.ts` - Max iterations
  - `src/lib/services/delivery-service.ts` - Batch size, max retries
  - `src/lib/services/model-provider.ts` - Context window, compaction threshold
  - `src/lib/services/task-queue.ts` - Subagent timeout (remove env var)
  - `src/lib/services/audit-service.ts` - Retention days
- **Env vars**: Deprecate `OPENCLAW_MAX_SPAWN_DEPTH`, `OPENCLAW_SUBAGENT_TIMEOUT`, `OPENCLAW_SESSION_TOKEN_THRESHOLD` in favor of config file
