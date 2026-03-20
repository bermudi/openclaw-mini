## 1. Remove Env Var Fallback Code

- [ ] 1.1 Remove `generateConfigFromEnvVars()` function from `src/lib/config/loader.ts`
- [ ] 1.2 Remove `parseDeprecatedFallbackModel()` function
- [ ] 1.3 Remove `warnEnvVarDeprecations()` function
- [ ] 1.4 Remove `LEGACY_PROVIDER_IDS` constant
- [ ] 1.5 Remove `warnedDeprecations` Set and `warnOnce()` function

## 2. Update Loader Logic

- [ ] 2.1 Modify `loadConfig()` to throw helpful error when config file doesn't exist
- [ ] 2.2 Create error message with example config structure
- [ ] 2.3 Remove `fallbackToEnvOnFileError` option from `LoadConfigOptions`
- [ ] 2.4 Remove `source` field from `LoadConfigResult` (always 'config-file' now)

## 3. Update Provider Registry

- [ ] 3.1 Remove env var fallback path from `providerRegistry.init()`
- [ ] 3.2 Remove `generateConfigFromEnvVars` import from provider-registry.ts
- [ ] 3.3 Update `setState()` to assume config always comes from file

## 4. Clean Up Tests

- [ ] 4.1 Remove tests for env var fallback behavior
- [ ] 4.2 Remove tests for deprecation warnings
- [ ] 4.3 Update tests to always provide config file
- [ ] 4.4 Add test for missing config file error message

## 5. Documentation

- [ ] 5.1 Update any README/docs to clarify env vars = secrets only
- [ ] 5.2 Add example `openclaw.json` to documentation
