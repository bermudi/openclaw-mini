## 1. Remove Env Var Fallback Code

- [x] 1.1 Remove `generateConfigFromEnvVars()` function from `src/lib/config/loader.ts`
- [x] 1.2 Remove `parseDeprecatedFallbackModel()` function
- [x] 1.3 Remove `warnEnvVarDeprecations()` function
- [x] 1.4 Remove `LEGACY_PROVIDER_IDS` constant
- [x] 1.5 Remove `warnedDeprecations` Set and `warnOnce()` function

## 2. Update Loader Logic

- [x] 2.1 Modify `loadConfig()` to throw helpful error when config file doesn't exist
- [x] 2.2 Create error message with example config structure
- [x] 2.3 Remove `fallbackToEnvOnFileError` option from `LoadConfigOptions`
- [x] 2.4 Remove `source` field from `LoadConfigResult` (always 'config-file' now)

## 3. Update Provider Registry

- [x] 3.1 Remove env var fallback path from `providerRegistry.init()`
- [x] 3.2 Remove `generateConfigFromEnvVars` import from provider-registry.ts
- [x] 3.3 Update `setState()` to assume config always comes from file

## 4. Clean Up Tests

- [x] 4.1 Remove tests for env var fallback behavior
- [x] 4.2 Remove tests for deprecation warnings
- [x] 4.3 Update tests to always provide config file
- [x] 4.4 Add test for missing config file error message

## 5. Documentation

- [x] 5.1 Update any README/docs to clarify env vars = secrets only
- [x] 5.2 Add example `openclaw.json` to documentation
