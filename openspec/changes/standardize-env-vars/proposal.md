## Why

The current config system has deprecated env vars (`AI_PROVIDER`, `AI_MODEL`, etc.) that muddy the mental model. Users are unclear about the separation: secrets in env vars, everything else in config file. Removing the deprecated vars clarifies the architecture and reduces confusion.

## What Changes

- **Remove deprecated env vars**: Delete support for `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_FALLBACK_MODEL`
- **Clarify mental model**: Document clearly that API keys = env vars, everything else = config file
- **Clean up loader code**: Remove the fallback logic and deprecation warnings

**Note:** Existing `OPENCLAW_*` env vars (`OPENCLAW_CONFIG_PATH`, `OPENCLAW_WORKSPACE_DIR`, etc.) are already consistently named and remain unchanged.

**Breaking changes:**
- Users relying on `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_FALLBACK_MODEL` must migrate to `openclaw.json`

## Capabilities

### New Capabilities

None - this is a cleanup/simplification change.

### Modified Capabilities

- `config-file`: Env var fallback removed; config file is now required for non-secret configuration. Loader throws helpful error if file missing.
- `model-fallback`: Deprecated `AI_FALLBACK_MODEL` compatibility removed; fallback configuration now lives only in `openclaw.json`.

## Impact

- **Breaking**: Users must create `openclaw.json` with at minimum `provider` and `model` fields
- **Breaking**: Users must move any `AI_FALLBACK_MODEL` usage to `agent.fallbackProvider` and `agent.fallbackModel` in `openclaw.json`
- **Simpler loader**: Remove `generateConfigFromEnvVars()`, deprecation warnings, fallback logic
- **Simpler provider registry**: Initialization and state now assume a config-file-only runtime
- **Documentation**: Update README/docs to clarify env vars = secrets only
