## Why

Add Google Gemini as a supported AI provider. Gemini offers strong reasoning capabilities, large context windows, and competitive pricing. Many users want to use Gemini as an alternative to OpenAI, Anthropic, or OpenRouter.

## What Changes

- **New `gemini` provider**: Add Google Gemini AI via `@ai-sdk/google`
- **apiType: `gemini`**: Gemini-specific API type that routes to Google AI SDK
- **Config support**: Register Gemini in the provider registry with `apiType: 'gemini'`

**This change depends on the runtime-provider-registry change** - it uses the provider registry infrastructure to register the Gemini adapter.

## Capabilities

### New Capabilities

- (none - this adds a provider to an existing capability)

### Modified Capabilities

- `provider-registry`: Add Gemini adapter to the registry's SDK router

## Impact

- **New dependency**: `@ai-sdk/google`
- **Config change**: Users can now configure `gemini` provider with `apiType: 'gemini'`
