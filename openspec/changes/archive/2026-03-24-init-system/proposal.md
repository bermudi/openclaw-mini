## Why

The current initialization is scattered and lazy - errors surface mid-request, missing adapters silently degrade, and the system can run in a partially broken state. This creates confusing UX and makes debugging harder. We need a unified init system that validates all hard requirements at server startup and refuses to start if they're not met.

## What Changes

- **NEW**: `instrumentation.ts` entry point using Next.js instrumentation API
- **NEW**: Unified init module (`src/lib/init/`) with requirement checks
- **NEW**: `startup-validation` capability with hard/soft requirement distinction
- **NEW**: Auto-creation of default agent if none exists
- **NEW**: Formatted startup error output with actionable guidance
- **CHANGE**: Config loading becomes fail-fast instead of lazy
- **CHANGE**: Database connection validated at startup instead of first query
- **CHANGE**: Provider API key env refs validated at startup
- **CHANGE**: Adapters initialized during startup, not on first webhook
- **REMOVED**: Lazy `ensureProviderRegistryInitialized()` pattern (replaced by explicit init)

## Capabilities

### New Capabilities

- `startup-validation`: Hard requirements checked at server boot with `process.exit(1)` on failure. Distinguishes between hard blockers (config, DB, providers) and soft warnings (optional adapters, workspace dir).

### Modified Capabilities

- `config-file`: Error handling changes from "use previous config or env vars" to "fail fast at startup if invalid"
- `provider-registry`: Initialization changes from lazy (`ensureProviderRegistryInitialized`) to explicit startup-time initialization

## Impact

- **Entry point**: `src/instrumentation.ts` (new)
- **Core module**: `src/lib/init/` (new)
- **Config loading**: `src/lib/config/loader.ts` (error handling)
- **Provider registry**: `src/lib/services/provider-registry.ts` (initialization flow)
- **Adapters**: `src/lib/adapters/index.ts` (initialization timing)
- **Database**: `src/lib/db.ts` (connection validation)
- **Layout**: `src/app/layout.tsx` (remove runtime initialization - handled by instrumentation)
