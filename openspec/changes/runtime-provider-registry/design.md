## Context

The current `model-provider.ts` uses:
- Compile-time `PROVIDER_NAMES` enum: `['openai', 'anthropic', 'ollama', 'openrouter', 'poe']`
- Environment variables: `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_FALLBACK_MODEL`
- Hardcoded `getDefaultBaseUrl()` and `getDefaultApiKey()` for each provider

The `subagent-config.ts` defines `ProviderName` type as a union of the enum values. Subagent overrides use separate `provider` and `model` fields.

## Goals / Non-Goals

**Goals:**
- Config file (`openclaw.json`) for provider and agent configuration
- Dynamic provider registry loaded from config at runtime
- Hot reload via file watcher - no restart needed
- Separate `fallbackProvider` + `fallbackModel` fields in config
- Maintain backwards compatibility with env vars (deprecated but functional)

**Non-Goals:**
- Supporting credentials in files or exec commands (SecretRef v2) - defer to future
- Runtime provider addition via API - only file-based config
- Dropping env var support entirely in v1

## Decisions

### 1. Config File Structure

**Decision**: Use JSON5 format (JSON with comments) for `openclaw.json` with the following structure:

```json5
{
  "providers": {
    "openai": {
      "apiType": "openai-chat",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "openrouter": {
      "apiType": "openai-chat",
      "baseURL": "https://openrouter.ai/api/v1",
      "apiKey": "${OPENROUTER_API_KEY}"
    },
    "poe": {
      "apiType": "poe",
      "apiKey": "${POE_API_KEY}"
    }
  },
  "agent": {
    "provider": "openrouter",
    "model": "openai/gpt-5.4-mini",
    "fallbackProvider": "openai",
    "fallbackModel": "gpt-4.1-mini"
  }
}
```

**Rationale**: JSON5 allows comments for documentation while remaining simple to parse. Separate `provider` and `model` fields avoid parsing ambiguity. The `apiType` field identifies which SDK adapter to use.

**Alternatives considered**:
- YAML format - more readable but requires additional dependency
- Separate `providers.json` - cleaner separation but two files to manage
- Env var sourcing in config - complex, deferred

### 2. Provider Registry Architecture

**Decision**: Replace `PROVIDER_NAMES` enum with a `ProviderRegistry` class:

```typescript
interface ProviderDefinition {
  id: string;                    // 'openai', 'openrouter', 'gemini', 'poe'
  apiType: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini' | 'poe';
  baseURL?: string;
  apiKey: string;
}

class ProviderRegistry {
  private providers = new Map<string, ProviderDefinition>();

  register(def: ProviderDefinition): void;
  get(id: string): ProviderDefinition | undefined;
  list(): ProviderDefinition[];
  reload(config: RuntimeConfig): void;
}
```

**Rationale**: Dynamic registration allows providers to be added without code changes (just config). Registry is reloadable for hot reload support.

**Alternatives considered**:
- Plugin system - too complex for v1
- Enum + factory pattern - still requires code changes for new providers

### 3. SDK Adapter Selection via apiType

**Decision**: Map `apiType` to SDK creation functions:

| apiType | SDK | Adapter |
|---------|-----|---------|
| `openai-chat` | `@ai-sdk/openai` | `createOpenAI()` |
| `openai-responses` | `@ai-sdk/openai` | `createOpenAI()` + responses baseURL |
| `anthropic` | `@ai-sdk/anthropic` | `createAnthropic()` |
| `poe` | custom | Poe client with endpoint routing |

Note: `gemini` apiType is added by the separate `add-gemini-provider` change.

**Rationale**: Each `apiType` maps to exactly one SDK adapter. Adding a new provider that fits an existing `apiType` (e.g., another OpenAI-compatible API) requires only config, no code changes.

### 4. Hot Reload Strategy

**Decision**: Use Node.js `fs.watch()` on the config file path:

```
Config change detected → Parse & validate (Zod) → ProviderRegistry.reload() → Clear SDK cache
```

**Rationale**: Node.js built-in `fs.watch()` is sufficient - one watcher per file, negligible memory. SDK clients are cached in `Map<string, LanguageModel>` and invalidated on reload.

**Alternatives considered**:
- `chokidar` - more cross-platform reliable, but adds dependency for marginal benefit
- Polling - wasteful, delays detection
- Inotify/FSEvents directly - more complex, same result as fs.watch

### 5. Backwards Compatibility

**Decision**: Env vars remain functional but deprecated:

1. On startup, if `openclaw.json` exists, use it and ignore env vars
2. If no config file, check env vars and generate config from them (one-time migration)
3. Config file takes precedence; env vars are fallback

**Rationale**: Users can migrate at their own pace. Existing deployments continue working.

### 6. Model Field Semantics

**Decision**: Model field is provider-specific and passed directly to SDK:

- OpenAI provider: `gpt-5.4-mini`
- OpenRouter provider: `openai/gpt-5.4-mini` (OpenRouter's format)
- Gemini provider: `gemini-2.5-pro`
- Poe provider: `claude-opus-4.6` (Poe bot name)

**Rationale**: Model names are opaque strings to the registry - we don't parse or validate them. The SDK handles validity.

## Risks / Trade-offs

[Risk] Config file syntax errors crash reload → Mitigation: Zod validation before applying; on validation failure, keep previous config and log error

[Risk] API key exposed in config file → Mitigation: Support `apiKey` referencing env var via `${ENV_VAR}` syntax; warn users about file permissions

[Risk] File watcher memory leak → Mitigation: Single watcher per process, closed on graceful shutdown

[Trade-off] Config file adds startup latency → Acceptable: File read + parse is fast; once loaded, no overhead

## Migration Plan

1. Create config file schema (Zod) for `openclaw.json`
2. Implement `ProviderRegistry` class with `register()`, `get()`, `list()`, `reload()`
3. Add `loadRuntimeConfig()` that checks for config file or falls back to env vars
4. Add `watchConfig()` using `fs.watch()` for hot reload
5. Hook provider registry initialization into main entry point
6. Update `getLanguageModel()` to use registry instead of switch on enum
7. Update subagent overrides to validate against registry instead of enum
8. Add deprecation warnings to env var code path
9. Add migration path: if env vars set but no config, generate config file (optional, can be prompt)
10. Write tests for registry, hot reload, backwards compat

**Rollback**: Remove config file, set env vars, restart (back to previous behavior)

## Open Questions

1. Should we watch a separate `providers.json` independently from main config?
2. Do we need to expose reload status via API (for web UI to show "config updated")?
3. Should we support `${ENV_VAR}` syntax in apiKey fields for secrets?
