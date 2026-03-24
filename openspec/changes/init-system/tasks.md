## 1. Core Init Module

- [x] 1.1 Create `src/lib/init/types.ts` with `CheckResult`, `HardRequirement`, `SoftRequirement` types
- [x] 1.2 Create `src/lib/init/format-error.ts` with formatted error output function
- [x] 1.3 Create `src/lib/init/index.ts` with `initialize()` orchestration function and `initialized` guard

## 2. Requirement Checks

- [x] 2.1 Create `src/lib/init/checks/config.ts` - config file existence and schema validation
- [x] 2.2 Create `src/lib/init/checks/providers.ts` - provider API key env var resolution
- [x] 2.3 Create `src/lib/init/checks/database.ts` - DB connection and migration status check
- [x] 2.4 Create `src/lib/init/checks/agent.ts` - default agent auto-creation

## 3. Entry Point

- [x] 3.1 Create `src/instrumentation.ts` with `register()` function delegating to init module
- [x] 3.2 Enable experimental instrumentation in `next.config.ts` if needed

## 4. Refactor Existing Code

- [x] 4.1 Remove `initializeRuntime()` from `src/app/layout.tsx`
- [x] 4.2 Remove lazy `ensureProviderRegistryInitialized()` calls from services (registry guaranteed ready)
- [x] 4.3 Move adapter initialization from webhook route to init module
- [x] 4.4 Update `hookSubscriptionManager.initialize()` to be called from init module

## 5. Testing

- [x] 5.1 Add test for missing config file scenario
- [x] 5.2 Add test for invalid config schema scenario
- [x] 5.3 Add test for missing provider env var scenario
- [x] 5.4 Add test for database connection failure scenario
- [x] 5.5 Add test for database not migrated scenario
- [x] 5.6 Add test for default agent auto-creation
- [x] 5.7 Add test for idempotent initialization guard
