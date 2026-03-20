## 1. Schema and Types

- [x] 1.1 Create Zod schema for `openclaw.json` config file (`src/lib/config/schema.ts`)
- [x] 1.2 Define `ProviderDefinition` interface with `id`, `apiType`, `baseURL`, `apiKey`
- [x] 1.3 Define `RuntimeConfig` interface with `providers` map and `agent` config
- [x] 1.4 Define `AgentConfig` interface with `provider`, `model`, `fallbackProvider`, `fallbackModel`
- [x] 1.5 Remove `ProviderName` type alias and `PROVIDER_NAMES` constant (replaced by dynamic registry)

## 2. Provider Registry

- [x] 2.1 Create `src/lib/services/provider-registry.ts` with `ProviderRegistry` class
- [x] 2.2 Implement `register(def: ProviderDefinition): void` method
- [x] 2.3 Implement `get(id: string): ProviderDefinition | undefined` method
- [x] 2.4 Implement `list(): ProviderDefinition[]` method
- [x] 2.5 Implement `reload(config: RuntimeConfig): void` method
- [x] 2.6 Implement SDK client cache as `Map<string, LanguageModel>` inside registry
- [x] 2.7 Implement `getLanguageModel(providerId: string, model: string): LanguageModel` with caching
- [x] 2.8 Export singleton `providerRegistry` instance
- [x] 2.9 Export `initializeProviderRegistry()` to load config and populate registry at startup
- [x] 2.10 Implement `generateConfigFromEnvVars(): RuntimeConfig` for migration helper

## 3. Config File Loading

- [x] 3.1 Create `src/lib/config/loader.ts` with `loadConfig()` function
- [x] 3.2 Implement JSON5 parsing with comment support
- [x] 3.3 Implement Zod validation of parsed config
- [x] 3.4 Implement `${ENV_VAR}` substitution in `apiKey` fields
- [x] 3.5 Implement backwards-compatible env var fallback when config file missing
- [x] 3.6 Add deprecation warning logging for env var usage
- [x] 3.7 Create `getConfigPath()` helper for config file location

## 4. SDK Adapters

- [x] 4.1 Add `createOpenAIProvider()` helper for `openai-chat` and `openai-responses` apiTypes
- [x] 4.2 Add `createAnthropicProvider()` helper for `anthropic` apiType
- [x] 4.3 Integrate existing `createPoeLanguageModel()` for `poe` apiType
- [x] 4.4 Implement `createLanguageModel(def: ProviderDefinition, model: string): LanguageModel` router

Note: `gemini` apiType adapter is added by the separate `add-gemini-provider` change.

## 5. Hot Reload

- [x] 5.1 Create `src/lib/config/watcher.ts` with `watchConfig()` function
- [x] 5.2 Use Node.js `fs.watch()` on config file path
- [x] 5.3 Implement debouncing (500ms) for rapid changes
- [x] 5.4 Implement graceful shutdown with `watcher.close()`
- [x] 5.5 Hook watcher into `providerRegistry.reload()` on change
- [x] 5.6 Invalidate SDK cache on config reload
- [x] 5.7 Add reload status logging

## 6. Integration with model-provider.ts

- [x] 6.1 Update `resolveModelConfig()` to use `providerRegistry.get()` instead of enum lookup
- [x] 6.2 Update `getLanguageModel()` to use `providerRegistry.getLanguageModel()`
- [x] 6.3 Keep fallback support with `fallbackProvider` + `fallbackModel` fields
- [x] 6.4 Update `runWithModelFallback()` to work with registry
- [x] 6.5 Add deprecation warnings for `AI_PROVIDER`, `AI_MODEL`, `AI_FALLBACK_MODEL`

## 7. Subagent Override Integration

- [x] 7.1 Update `createSubAgentOverridesSchema()` to validate `provider` against registry
- [x] 7.2 Update `resolveSubAgentConfig()` to use registry for provider lookups
- [x] 7.3 Ensure override resolution uses `providerRegistry.getLanguageModel()`

## 8. Main Entry Point Integration

- [x] 8.1 Find main entry point (likely `src/index.ts` or similar)
- [x] 8.2 Add call to `initializeProviderRegistry()` on startup (after config loads)
- [x] 8.3 Add call to `watchConfig()` after registry initialization
- [x] 8.4 Add shutdown handler to close file watcher on SIGTERM/SIGINT
- [x] 8.5 Handle startup errors gracefully (if config invalid, fall back to env vars)

## 9. Testing

- [x] 8.1 Add unit tests for `ProviderRegistry` class
- [x] 8.2 Add unit tests for config file loading with valid/invalid configs
- [x] 8.3 Add unit tests for env var substitution
- [x] 8.4 Add unit tests for hot reload triggering
- [x] 8.5 Add unit tests for SDK adapter selection based on `apiType`
- [x] 8.6 Add unit tests for fallback with registry (success, retryable error, non-retryable error)
- [x] 8.7 Add unit tests for subagent override validation against registry

## 9. Testing

- [x] 9.1 Add unit tests for `ProviderRegistry` class
- [x] 9.2 Add unit tests for config file loading with valid/invalid configs
- [x] 9.3 Add unit tests for env var substitution
- [x] 9.4 Add unit tests for hot reload triggering
- [x] 9.5 Add unit tests for SDK adapter selection based on `apiType`
- [x] 9.6 Add unit tests for fallback with registry (success, retryable error, non-retryable error)
- [x] 9.7 Add unit tests for subagent override validation against registry
- [x] 9.8 Add unit tests for config migration from env vars

## 10. Dependencies

- [x] 10.1 Add `json5` dependency for JSON5 parsing (`bun add json5`)

## 11. Documentation

- [x] 11.1 Document `openclaw.json` config file format
- [x] 11.2 Add example config showing all provider types
- [x] 11.3 Document env var deprecation warnings
- [x] 11.4 Update README with new config file approach
