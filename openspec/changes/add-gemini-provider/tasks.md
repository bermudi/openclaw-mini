## 1. Dependencies

- [ ] 1.1 Add `@ai-sdk/google` dependency (`bun add @ai-sdk/google`)

## 2. Gemini SDK Adapter

- [ ] 2.1 Create `src/lib/services/adapters/gemini-adapter.ts` with `createGeminiProvider()` function
- [ ] 2.2 Implement Google AI SDK initialization with apiKey and optional baseURL
- [ ] 2.3 Return language model from the adapter

## 3. Registry Integration

- [ ] 3.1 Add gemini case to SDK adapter router in `providerRegistry.getLanguageModel()`
- [ ] 3.2 Map `apiType: 'gemini'` to `createGeminiProvider()`

## 4. Testing

- [ ] 4.1 Add unit test for gemini adapter creation
- [ ] 4.2 Add unit test for gemini with custom baseURL
- [ ] 4.3 Add integration test for Gemini provider (requires `GEMINI_API_KEY` env var)
