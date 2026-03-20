## 1. Schema and Types

- [ ] 1.1 Create Zod schema for `openclaw.json` config file (`src/lib/config/schema.ts`)
- [ ] 1.2 Define `ProviderDefinition` interface with `id`, `apiType`, `baseURL`, `apiKey`
- [ ] 1.3 Define `RuntimeConfig` interface with `providers` map and `agent` config
- [ ] 1.4 Define `AgentConfig` interface with `provider`, `model`, `fallbackProvider`, `fallbackModel`
- [ ] 1.5 Remove `ProviderName` type alias and `PROVIDER_NAMES` constant (replaced by dynamic registry)

## 2. Provider Registry

- [ ] 2.1 Create `src/lib/services/provider-registry.ts` with `ProviderRegistry` class
- [ ] 2.2 Implement `register(def: ProviderDefinition): void` method
- [ ] 2.3 Implement `get(id: string): ProviderDefinition | undefined` method
- [ ] 2.4 Implement `list(): ProviderDefinition[]` method
- [ ] 2.5 Implement `reload(config: RuntimeConfig): void` method
- [ ] 2.6 Implement SDK client cache as `Map<string, LanguageModel>` inside registry
- [ ] 2.7 Implement `getLanguageModel(providerId: string, model: string): LanguageModel` with caching
- [ ] 2.8 Export singleton `providerRegistry` instance
- [ ] 2.9 Export `initializeProviderRegistry()` to load config and populate registry at startup
- [ ] 2.10 Implement `generateConfigFromEnvVars(): RuntimeConfig` for migration helper

## 3. Config File Loading

- [ ] 3.1 Create `src/lib/config/loader.ts` with `loadConfig()` function
- [ ] 3.2 Implement JSON5 parsing with comment support
- [ ] 3.3 Implement Zod validation of parsed config
- [ ] 3.4 Implement `${ENV_VAR}` substitution in `apiKey` fields
- [ ] 3.5 Implement backwards-compatible env var fallback when config file missing
- [ ] 3.6 Add deprecation warning logging for env var usage
- [ ] 3.7 Create `getConfigPath()` helper for config file location

## 4. SDK Adapters

- [ ] 4.1 Add `createOpenAIProvider()` helper for `openai-chat` and `openai-responses` apiTypes
- [ ] 4.2 Add `createAnthropicProvider()` helper for `anthropic` apiType
- [ ] 4.3 Integrate existing `createPoeLanguageModel()` for `poe` apiType
- [ ] 4.4 Implement `createLanguageModel(def: ProviderDefinition, model: string): LanguageModel` router

Note: `gemini` apiType adapter is added by the separate `add-gemini-provider` change.

## 5. Hot Reload

- [ ] 5.1 Create `src/lib/config/watcher.ts` with `watchConfig()` function
- [ ] 5.2 Use Node.js `fs.watch()` on config file path
- [ ] 5.3 Implement debouncing (500ms) for rapid changes
- [ ] 5.4 Implement graceful shutdown with `watcher.close()`
- [ ] 5.5 Hook watcher into `providerRegistry.reload()` on change
- [ ] 5.6 Invalidate SDK cache on config reload
- [ ] 5.7 Add reload status logging

## 6. Integration with model-provider.ts

- [ ] 6.1 Update `resolveModelConfig()` to use `providerRegistry.get()` instead of enum lookup
- [ ] 6.2 Update `getLanguageModel()` to use `providerRegistry.getLanguageModel()`
- [ ] 6.3 Keep fallback support with `fallbackProvider` + `fallbackModel` fields
- [ ] 6.4 Update `runWithModelFallback()` to work with registry
- [ ] 6.5 Add deprecation warnings for `AI_PROVIDER`, `AI_MODEL`, `AI_FALLBACK_MODEL`

## 7. Subagent Override Integration

- [ ] 7.1 Update `createSubAgentOverridesSchema()` to validate `provider` against registry
- [ ] 7.2 Update `resolveSubAgentConfig()` to use registry for provider lookups
- [ ] 7.3 Ensure override resolution uses `providerRegistry.getLanguageModel()`

## 8. Main Entry Point Integration

- [ ] 8.1 Find main entry point (likely `src/index.ts` or similar)
- [ ] 8.2 Add call to `initializeProviderRegistry()` on startup (after config loads)
- [ ] 8.3 Add call to `watchConfig()` after registry initialization
- [ ] 8.4 Add shutdown handler to close file watcher on SIGTERM/SIGINT
- [ ] 8.5 Handle startup errors gracefully (if config invalid, fall back to env vars)

## 9. Testing

- [ ] 8.1 Add unit tests for `ProviderRegistry` class
- [ ] 8.2 Add unit tests for config file loading with valid/invalid configs
- [ ] 8.3 Add unit tests for env var substitution
- [ ] 8.4 Add unit tests for hot reload triggering
- [ ] 8.5 Add unit tests for SDK adapter selection based on `apiType`
- [ ] 8.6 Add unit tests for fallback with registry (success, retryable error, non-retryable error)
- [ ] 8.7 Add unit tests for subagent override validation against registry

## 9. Testing

- [ ] 9.1 Add unit tests for `ProviderRegistry` class
- [ ] 9.2 Add unit tests for config file loading with valid/invalid configs
- [ ] 9.3 Add unit tests for env var substitution
- [ ] 9.4 Add unit tests for hot reload triggering
- [ ] 9.5 Add unit tests for SDK adapter selection based on `apiType`
- [ ] 9.6 Add unit tests for fallback with registry (success, retryable error, non-retryable error)
- [ ] 9.7 Add unit tests for subagent override validation against registry
- [ ] 9.8 Add unit tests for config migration from env vars

## 10. Dependencies

- [ ] 10.1 Add `json5` dependency for JSON5 parsing (`bun add json5`)

## 11. Documentation

- [ ] 11.1 Document `openclaw.json` config file format
- [ ] 11.2 Add example config showing all provider types
- [ ] 11.3 Document env var deprecation warnings
- [ ] 11.4 Update README with new config file approach
