## Why

The current model provider system requires application restarts to change models or providers, relies on compile-time enums for provider names, and stores credentials only in environment variables. Users want to switch between providers (OpenAI, OpenRouter, Gemini, Poe) without restarts, configure providers via a config file, and have a more flexible architecture that doesn't require code changes to add new providers.

## What Changes

- **Config file support**: Add `openclaw.json` configuration with provider definitions, replacing env vars for provider configuration
- **Provider registry**: Replace compile-time `PROVIDER_NAMES` enum with a dynamic registry loaded from config, supporting addition of providers without code changes
- **Hot reload via file watcher**: Monitor config file for changes and reload provider registry without restart
- **Separate provider/model fields**: Use explicit `provider` + `model` fields instead of embedded `provider/model` strings (except for OpenRouter where model names inherently contain upstream provider)
- **Fallback provider/model fields**: Add separate `fallbackProvider` + `fallbackModel` fields in config, replacing the combined `AI_FALLBACK_MODEL` env var

**Breaking changes:**
- `AI_PROVIDER`, `AI_MODEL`, `AI_FALLBACK_MODEL` env vars are deprecated in favor of config file
- `AI_BASE_URL` replaced by per-provider `baseURL` in config
- Config file format changes model references from embedded `provider/model` to separate fields

## Capabilities

### New Capabilities

- `provider-registry`: Dynamic provider registry loaded from config file, replacing compile-time enum
- `config-file`: JSON config file support for agent and provider configuration with hot reload
- `hot-reload`: File watcher for config changes with provider registry reload

Note: Gemini provider is a separate change (`add-gemini-provider`) that depends on this infrastructure.

### Modified Capabilities

- `model-fallback`: Separate `fallbackProvider` + `fallbackModel` fields replace combined `AI_FALLBACK_MODEL`; internal fallback logic unchanged
- `sub-agent-config-overrides`: Override schema updated to use separate `provider` + `model` fields

## Impact

- **New dependencies**: `json5` for JSON5 parsing (Node.js `fs.watch` is built-in)
- **Config changes**: New `openclaw.json` structure with `providers`, `agent` sections
- **Env var deprecation**: `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_FALLBACK_MODEL` deprecated (still work for backwards compat)
- **Provider enum**: `PROVIDER_NAMES` type replaced by runtime registry
- **Subagent overrides**: `provider` and `model` remain separate fields (no change to override schema structure)
