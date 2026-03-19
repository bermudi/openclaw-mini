## Why

The current model provider system requires manual configuration of provider credentials and has a hardcoded context window lookup table. Adding new models or switching between providers requires code changes. Meanwhile, Poe.com provides a unified API that aggregates hundreds of models from multiple providers (OpenAI, Anthropic, Google, xAI, DeepSeek, etc.) with a single API key, plus they maintain a publicly accessible model catalog that doesn't require authentication.

## What Changes

- **New `poe` provider**: Add Poe as a first-class provider with intelligent endpoint routing:
  - OpenAI models → Responses API (`/v1/responses`) for reasoning, web search, structured outputs
  - Anthropic Claude models → Anthropic-compatible API (`/v1/messages`) for native Claude support
  - Other models (Grok, Gemini, DeepSeek, etc.) → Chat Completions API (`/v1/chat/completions`)
- **Dynamic model catalog**: Fetch available models from `GET https://api.poe.com/v1/models` (no auth required)
  - Catalog cached for 24 hours by default
  - Force refresh via explicit API call
  - Model metadata includes context window, input/output modalities, supported features
- **Capability-based model filtering**: Query models by capabilities (e.g., vision, reasoning, web search)
- **Cross-provider fallback**: Configure a fallback model that can be any provider combination (e.g., primary: `poe/gpt-5.3`, fallback: `openai/gpt-5.4-mini`)

## Capabilities

### New Capabilities

- `poe-provider`: Poe.com aggregator provider with intelligent endpoint routing for OpenAI, Anthropic, and other models
- `model-catalog`: Dynamic model catalog fetched from provider APIs with caching and capability filtering
- `model-fallback`: Cross-provider fallback configuration for resilience against provider outages

### Modified Capabilities

- (none - this is purely additive)

## Impact

- **New dependency**: `ai` SDK already used; no new runtime dependencies
- **Config changes**: New `POE_API_KEY` env var, optional `AI_FALLBACK_MODEL` env var
- **Provider enum**: `PROVIDER_NAMES` will expand to include `poe`
- **Subagent overrides**: Poe models specified as `provider: 'poe', model: 'claude-opus-4.6'`
- **Model catalog**: New service for fetching/filtering/cache management
