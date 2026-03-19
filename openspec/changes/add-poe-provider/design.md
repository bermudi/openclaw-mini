## Context

The current `model-provider.ts` implementation uses a flat enum of providers (`openai`, `anthropic`, `ollama`, `openrouter`) with hardcoded context windows and environment-variable-based credential resolution. Each provider is tied to a single SDK (either OpenAI or Anthropic from `@ai-sdk`).

Poe.com offers three API endpoints that cover different model families:
- `/v1/responses` (OpenAI Responses API format) - supports reasoning, web search, structured outputs, multi-turn
- `/v1/messages` (Anthropic Messages API format) - direct Claude proxy
- `/v1/chat/completions` (OpenAI Chat Completions format) - universal, works with all other models

The Poe `/v1/models` endpoint returns a complete catalog without authentication, including context window sizes, input/output modalities, supported features, and model parameters.

## Goals / Non-Goals

**Goals:**
- Add Poe as a provider with intelligent endpoint selection based on model family
- Enable dynamic model catalog with 24-hour cache and on-demand refresh
- Support capability-based model filtering (vision, reasoning, web search, tools)
- Add cross-provider fallback configuration for resilience

**Non-Goals:**
- Replacing the existing provider architecture - Poe is additive
- Supporting Poe's full feature set (structured outputs via Responses API are out of scope for v1)
- Runtime model switching without restart (catalog refreshes, not config hot-reload)
- Private bots (Poe API limitation)

## Decisions

### 1. Poe Endpoint Routing Strategy

**Decision**: Route Poe requests based on model name patterns rather than a fixed endpoint per request.

**Rationale**: The three Poe endpoints serve different model families:
- `claude-*` models → Anthropic API (best streaming/tool support)
- `gpt-*, o3, o4-*` models → Responses API (reasoning, web search)
- Everything else (Grok, Gemini, DeepSeek, etc.) → Chat Completions

**Alternatives considered**:
- Fixed Chat Completions for all → loses reasoning/web search features for OpenAI models
- Fixed Responses API for all → doesn't work with non-OpenAI models
- Per-model config in catalog → adds maintenance burden

### 2. Model Catalog Caching

**Decision**: Cache catalog for 24 hours in memory, with explicit `forceRefresh()` API.

**Rationale**: Catalog changes infrequently (Poe adds models periodically). 24-hour cache balances freshness with reduced API calls. The no-auth endpoint means no rate limit concerns.

**Alternatives considered**:
- Background refresh interval → adds complexity, no real benefit
- Cache forever until restart → stale catalog, confusing UX
- File-based cache → unnecessary persistence for in-memory catalog

### 3. Capability Filtering

**Decision**: Filter models by `architecture.input_modalities` and `supported_features`.

**Rationale**: The Poe catalog includes:
- `architecture.input_modalities`: `["text"]`, `["text", "image"]`, `["text", "image", "video"]`
- `supported_features`: `["web_search", "tools"]`, `[]`, etc.

This is sufficient for basic filtering without additional configuration.

**Alternatives considered**:
- Custom capability tags in config → YAML/maintenance burden
- Capability detection via API calls → expensive, slow

### 4. Fallback Model Format

**Decision**: Fallback uses `provider/model` format (e.g., `openai/gpt-4.1-mini`) resolved via existing `resolveModelConfig()`.

**Rationale**: Leverages existing resolution logic. Works across any provider, not just Poe-to-Poe.

**Alternatives considered**:
- Separate fallback provider + model fields → more verbose
- Poe-to-Poe fallback only → limits utility

## Risks / Trade-offs

[Risk] Poe API downtime → Mitigation: Fallback model kicks in; catalog cache ensures catalog survives API issues

[Risk] Model not in catalog (rare) → Mitigation: Catalog fetch failure falls back to hardcoded MODEL_CONTEXT_WINDOWS

[Risk] Poe rate limits on catalog → Mitigation: Endpoint allows 500 req/min; catalog fetch is infrequent

[Trade-off] Poe's Responses API doesn't support all OpenAI features → Accept limitation; Chat Completions available as fallback

[Trade-off] Model parameter passing varies by endpoint → Poe handles best-effort mapping; not all parameters work everywhere

## Migration Plan

1. Add `poe` to `PROVIDER_NAMES` in `subagent-config.ts`
2. Implement `PoeModelRouter` class that selects endpoint based on model
3. Add `ModelCatalog` service with `fetch()`, `getModels()`, `filterByCapabilities()`, `getContextWindow()`
4. Add fallback resolution in `resolveModelConfig()` and `getLanguageModel()`
5. Add tests for endpoint routing, catalog caching, capability filtering
6. Document new env vars: `POE_API_KEY`, `AI_FALLBACK_MODEL`

**Rollback**: Remove `poe` from PROVIDER_NAMES; fallback logic checks for `poe` specifically before applying

## Open Questions

~~1. Should we cache the catalog to disk for persistence across restarts?~~ **Answered: No, start with in-memory only.** Disk caching adds complexity without clear benefit since the catalog refreshes daily.

~~2. Do we need to expose catalog refresh via an API endpoint?~~ **Answered: Yes.** The `ModelCatalog` class will expose `refresh(): Promise<void>` so web UI can trigger fresh model lists.

~~3. How do we want to handle the "best" model selection when capabilities overlap?~~ **Answered: Latest SOTA wins.** When filtering by capabilities returns multiple models, prefer models with the latest version numbers in their names (e.g., `claude-opus-4.6` > `claude-opus-4.5`). This heuristic handles Opus/Sonnet 4.6, GPT-5.4, etc.

## Responses API Feature Scope

When using Poe's `/v1/responses` endpoint (for OpenAI models), the following features are **in scope** for v1:
- Streaming responses
- Tool calling / function calling
- Basic chat (non-structured)

The following are **out of scope** for v1:
- Structured outputs via `text.format` (JSON schema)
- Multi-turn via `previous_response_id` (session management complexity)

## Context Window Fallback Behavior

Context window resolution follows this priority:
1. **Cached catalog** - If catalog is cached and model exists, use catalog value
2. **Hardcoded map** - If model not in catalog, use `MODEL_CONTEXT_WINDOWS` with default 8192
3. **Empty cache + fetch failure** - If cache is empty AND catalog fetch fails, use hardcoded defaults

The catalog fetch failure does not block model usage; it only means context window may be inaccurate.
