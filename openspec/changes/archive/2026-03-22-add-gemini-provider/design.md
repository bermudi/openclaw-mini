## Context

The runtime-provider-registry change adds a provider registry with `apiType`-based SDK adapter selection. This change adds the Gemini adapter to that system.

## Goals / Non-Goals

**Goals:**
- Add Gemini as a supported provider via `@ai-sdk/google`
- Support custom baseURL for Vertex AI or AI Studio endpoints
- Integrate with the provider registry's SDK adapter system

**Non-Goals:**
- Creating the provider registry infrastructure (belongs to runtime-provider-registry change)

## Decisions

### 1. API Type Name

**Decision**: Use `apiType: 'gemini'` in config.

**Rationale**: Consistent with other `apiType` values (`openai-chat`, `anthropic`, etc.)

### 2. SDK Selection

**Decision**: Use `createGoogle()` from `@ai-sdk/google`.

**Rationale**: Official Vercel AI SDK adapter for Google Gemini.

### 3. Model Names

**Decision**: Pass model names directly to SDK - `gemini-2.5-pro`, `gemini-2.0-flash`, etc.

**Rationale**: Model names are opaque to the registry, passed through to SDK.

## Migration Plan

1. Add `@ai-sdk/google` dependency
2. Implement `createGeminiProvider()` in the SDK adapters module
3. Register Gemini in the provider registry's SDK router
4. Test with config: `providers: { gemini: { apiType: 'gemini', apiKey: '...' } }`

**Rollback**: Remove gemini from config and remove adapter code.
