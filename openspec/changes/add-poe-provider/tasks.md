## 1. Provider Enum Update

- [ ] 1.1 Add `poe` to `PROVIDER_NAMES` array in `src/lib/subagent-config.ts`
- [ ] 1.2 Update TypeScript type `ProviderName` to include `poe`

## 2. Poe API Client

- [ ] 2.1 Create `src/lib/services/poe-client.ts` with endpoint routing logic
- [ ] 2.2 Implement `getPoeEndpoint(model: string): PoeEndpoint` to route by model family
- [ ] 2.3 Add `createPoeLanguageModel()` that selects correct SDK (OpenAI or Anthropic) based on endpoint
- [ ] 2.4 Add Poe API key resolution from `POE_API_KEY` env var
- [ ] 2.5 Export `PoeEndpoint` type and `poeEndpointForModel()` helper

## 3. Model Catalog Service

- [ ] 3.1 Create `src/lib/services/model-catalog.ts`
- [ ] 3.2 Implement `ModelCatalog` class with in-memory cache (24hr TTL)
- [ ] 3.3 Add `fetch(): Promise<ModelCatalogData>` to hit Poe `/v1/models`
- [ ] 3.4 Add `refresh(force?: boolean)` method
- [ ] 3.5 Add `getModels(filters?: ModelFilters)` for capability filtering
- [ ] 3.6 Add `getContextWindowSize(modelId: string): number`
- [ ] 3.7 Create singleton export `modelCatalog`

## 4. Integration with model-provider.ts

- [ ] 4.1 Update `resolveModelConfig()` to handle `provider: 'poe'`
- [ ] 4.2 Update `getDefaultBaseUrl()` to return Poe base URL for `poe` provider
- [ ] 4.3 Update `getDefaultApiKey()` to return `POE_API_KEY` for `poe` provider
- [ ] 4.4 Update `getLanguageModel()` to use Poe client for `poe` provider
- [ ] 4.5 Update `getContextWindowSize()` to delegate to `modelCatalog.getContextWindowSize()`

## 5. Fallback Support

- [ ] 5.1 Update `getModelConfig()` to read `AI_FALLBACK_MODEL` env var
- [ ] 5.2 Update `resolveModelConfig()` to accept and propagate `fallbackModel?: string`
- [ ] 5.3 Implement fallback logic (consider extracting to `runWithModelFallback()` helper for reusability):
  - Try primary model
  - On retryable error (429, 500, 502, 503, network errors), try fallback
  - If fallback also fails, chain errors and throw
- [ ] 5.4 Do NOT attempt fallback on 401, 403, 400 errors

## 6. Testing

- [ ] 6.1 Add unit tests for `poeEndpointForModel()` routing logic
- [ ] 6.2 Add unit tests for `ModelCatalog` caching behavior
- [ ] 6.3 Add unit tests for capability filtering
- [ ] 6.4 Add unit tests for fallback logic (success, retryable error, non-retryable error)
- [ ] 6.5 Add integration test for Poe provider (requires `POE_API_KEY` env var)

## 7. Documentation

- [ ] 7.1 Document new `POE_API_KEY` environment variable
- [ ] 7.2 Document `AI_FALLBACK_MODEL` environment variable format (`provider/model`)
- [ ] 7.3 Update README or docs with Poe provider usage example
