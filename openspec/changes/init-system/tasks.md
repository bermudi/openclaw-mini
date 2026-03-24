## 1. Core Init Module

- [ ] 1.1 Create `src/lib/init/types.ts` with `CheckResult`, `HardRequirement`, `SoftRequirement` types
- [ ] 1.2 Create `src/lib/init/format-error.ts` with formatted error output function
- [ ] 1.3 Create `src/lib/init/index.ts` with `initialize()` orchestration function and `initialized` guard

## 2. Requirement Checks

- [ ] 2.1 Create `src/lib/init/checks/config.ts` - config file existence and schema validation
- [ ] 2.2 Create `src/lib/init/checks/providers.ts` - provider API key env var resolution
- [ ] 2.3 Create `src/lib/init/checks/database.ts` - DB connection and migration status check
- [ ] 2.4 Create `src/lib/init/checks/agent.ts` - default agent auto-creation

## 3. Entry Point

- [ ] 3.1 Create `src/instrumentation.ts` with `register()` function delegating to init module
- [ ] 3.2 Enable experimental instrumentation in `next.config.ts` if needed

## 4. Refactor Existing Code

- [ ] 4.1 Remove `initializeRuntime()` from `src/app/layout.tsx`
- [ ] 4.2 Remove lazy `ensureProviderRegistryInitialized()` calls from services (registry guaranteed ready)
- [ ] 4.3 Move adapter initialization from webhook route to init module
- [ ] 4.4 Update `hookSubscriptionManager.initialize()` to be called from init module

## 5. Testing

- [ ] 5.1 Add test for missing config file scenario
- [ ] 5.2 Add test for invalid config schema scenario
- [ ] 5.3 Add test for missing provider env var scenario
- [ ] 5.4 Add test for database connection failure scenario
- [ ] 5.5 Add test for database not migrated scenario
- [ ] 5.6 Add test for default agent auto-creation
- [ ] 5.7 Add test for idempotent initialization guard
