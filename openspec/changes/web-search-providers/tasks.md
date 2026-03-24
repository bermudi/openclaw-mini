## 1. Search service

- [x] 1.1 Create `src/lib/services/search-service.ts` with a `SearchService` class and provider interface: `search(query: string, numResults: number): Promise<SearchResult[]>` where `SearchResult = { title: string, url: string, snippet: string }`
- [x] 1.2 Implement Brave provider: `GET https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token` header, parse `web.results` array, extract title/url/description, 10s timeout
- [x] 1.3 Implement Tavily provider: `POST https://api.tavily.com/search` with `api_key`, `query`, `max_results` in body, parse `results` array, 10s timeout
- [x] 1.4 Implement DuckDuckGo provider: `POST https://html.duckduckgo.com/html/` with form data `q=<query>`, parse `.result` elements from HTML response for title, URL, and snippet
- [x] 1.5 Implement provider resolution: check `BRAVE_API_KEY` / config → `TAVILY_API_KEY` / config → DuckDuckGo fallback. Export `getSearchProvider()` function
- [x] 1.6 Write unit tests for each provider with mocked fetch responses, and for provider resolution logic

## 2. Config schema — search section

- [x] 2.1 Add optional `search` section to config schema in `src/lib/config/schema.ts`: `braveApiKey?: string`, `tavilyApiKey?: string`
- [x] 2.2 Update `runtimeConfigSchema` to allow the `search` section (update `.strict()` or add to schema)
- [x] 2.3 Write validation tests: valid search config, empty search section, missing search section

## 3. Replace web_search stub

- [x] 3.1 Replace the `web_search` tool's execute function in `src/lib/tools.ts` to call `searchService.search(query, numResults ?? 5)` and return compact results
- [x] 3.2 Write unit tests: search with results, search with no results, search with provider error, search with custom numResults

## 4. Add web_fetch tool

- [x] 4.1 Register `web_fetch` tool in `src/lib/tools.ts` with input schema `{ url: z.string().url() }`, risk level `medium`
- [x] 4.2 Implement execute: fetch URL with 15s timeout, follow redirects (max 5), strip HTML tags/scripts/styles for HTML content, return raw text for JSON/plain, truncate to 10,000 chars
- [x] 4.3 Write unit tests: fetch HTML page, fetch JSON, fetch with redirect, timeout, HTTP error, invalid URL, content truncation
