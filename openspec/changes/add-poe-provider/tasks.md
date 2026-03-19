## 1. Provider Enum Update
 
 - [x] 1.1 Add `poe` to `PROVIDER_NAMES` array in `src/lib/subagent-config.ts`
 - [x] 1.2 Update TypeScript type `ProviderName` to include `poe`
 
 ## 2. Poe API Client
 
 - [x] 2.1 Create `src/lib/services/poe-client.ts` with endpoint routing logic
 - [x] 2.2 Implement `getPoeEndpoint(model: string): PoeEndpoint` to route by model family
 - [x] 2.3 Add `createPoeLanguageModel()` that selects correct SDK (OpenAI or Anthropic) based on endpoint
 - [x] 2.4 Add Poe API key resolution from `POE_API_KEY` env var
 - [x] 2.5 Export `PoeEndpoint` type and `poeEndpointForModel()` helper
 
 ## 3. Model Catalog Service
 
 - [x] 3.1 Create `src/lib/services/model-catalog.ts`
 - [x] 3.2 Implement `ModelCatalog` class with in-memory cache (24hr TTL)
 - [x] 3.3 Add `fetch(): Promise<ModelCatalogData>` to hit Poe `/v1/models`
 - [x] 3.4 Add `refresh(force?: boolean)` method
 - [x] 3.5 Add `getModels(filters?: ModelFilters)` for capability filtering
 - [x] 3.6 Add `getContextWindowSize(modelId: string): number`
 - [x] 3.7 Create singleton export `modelCatalog`
 
 ## 4. Integration with model-provider.ts
 
 - [x] 4.1 Update `resolveModelConfig()` to handle `provider: 'poe'`
 - [x] 4.2 Update `getDefaultBaseUrl()` to return Poe base URL for `poe` provider
 - [x] 4.3 Update `getDefaultApiKey()` to return `POE_API_KEY` for `poe` provider
 - [x] 4.4 Update `getLanguageModel()` to use Poe client for `poe` provider
 - [x] 4.5 Update `getContextWindowSize()` to delegate to `modelCatalog.getContextWindowSize()`
 
 ## 5. Fallback Support
 
 - [x] 5.1 Update `getModelConfig()` to read `AI_FALLBACK_MODEL` env var
 - [x] 5.2 Update `resolveModelConfig()` to accept and propagate `fallbackModel?: string`
 - [x] 5.3 Implement fallback logic (consider extracting to `runWithModelFallback()` helper for reusability):
   - Try primary model
   - On retryable error (429, 500, 502, 503, network errors), try fallback
   - If fallback also fails, chain errors and throw
 - [x] 5.4 Do NOT attempt fallback on 401, 403, 400 errors
 
 ## 6. Testing
 
 - [x] 6.1 Add unit tests for `poeEndpointForModel()` routing logic
 - [x] 6.2 Add unit tests for `ModelCatalog` caching behavior
 - [x] 6.3 Add unit tests for capability filtering
 - [x] 6.4 Add unit tests for fallback logic (success, retryable error, non-retryable error)
 - [x] 6.5 Add integration test for Poe provider (requires `POE_API_KEY` env var)
 
 ## 7. Documentation
 
 - [x] 7.1 Document new `POE_API_KEY` environment variable
 - [x] 7.2 Document `AI_FALLBACK_MODEL` environment variable format (`provider/model`)
 - [x] 7.3 Update README or docs with Poe provider usage example
