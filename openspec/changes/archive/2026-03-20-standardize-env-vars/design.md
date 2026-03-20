## Context

The config loader currently supports two paths:
1. Load `openclaw.json` if it exists
2. Fall back to env vars (`AI_PROVIDER`, `AI_MODEL`, etc.) if no config file

This dual-path adds complexity and confuses users about where to configure things. The original intent was backwards compatibility, but the deprecation warnings have been in place long enough.

## Goals / Non-Goals

**Goals:**
- Remove deprecated env var support (`AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_FALLBACK_MODEL`)
- Simplify the loader to a single code path
- Clarify the mental model: env vars = secrets only, config file = everything else

**Non-Goals:**
- Changing the config file format
- Changing how API keys are handled (they stay as env vars with `${VAR}` substitution)
- Adding new configuration options

## Decisions

### Decision 1: Require config file at startup

**Choice:** If `openclaw.json` doesn't exist, fail with a helpful error message instead of falling back to env vars.

**Alternatives considered:**
- Generate a default config file automatically → Rejected: assumes too much about user intent
- Continue with env var fallback → Rejected: perpetuates confusion

**Rationale:** Failing fast forces users to create the config file, making the mental model explicit. The error message will explain the required structure.

### Decision 2: Remove `generateConfigFromEnvVars()` entirely

**Choice:** Delete the function and all related code.

**Rationale:** No need for fallback logic, deprecation warnings, or env var parsing. The loader becomes: find config path → parse file → validate → return.

### Decision 3: Keep `${ENV_VAR}` substitution in config file

**Choice:** API keys still use env vars via `${OPENAI_API_KEY}` syntax in `openclaw.json`.

**Rationale:** Secrets should never be in config files. This is the correct separation: config file defines structure, env vars provide secrets.

## Risks / Trade-offs

- **Breaking change for users without config files** → Error message will guide them to create one with example structure
- **Users who relied on env vars for quick testing** → They'll need to create a minimal config file (3 lines)

## Migration Plan

1. Remove `generateConfigFromEnvVars()` and related functions
2. Update `loadConfig()` to throw if config file doesn't exist
3. Update error message to show example config structure
4. Remove deprecation warning code
5. Update documentation

## Open Questions

None - the path is clear.
