# web-search Specification

## ADDED Requirements

### Requirement: Multi-provider web search
The `web_search` tool SHALL execute web searches using the first available provider in the chain: Brave Search → Tavily → DuckDuckGo.

#### Scenario: Search with Brave API key configured
- **GIVEN** `BRAVE_API_KEY` is set or `search.braveApiKey` is configured in `openclaw.json`
- **WHEN** the agent calls `web_search` with `query: "TypeScript generics"`
- **THEN** the system SHALL call the Brave Search API and return results

#### Scenario: Search falls back to Tavily
- **GIVEN** `BRAVE_API_KEY` is not set but `TAVILY_API_KEY` is set
- **WHEN** the agent calls `web_search`
- **THEN** the system SHALL use the Tavily API

#### Scenario: Search falls back to DuckDuckGo
- **GIVEN** neither `BRAVE_API_KEY` nor `TAVILY_API_KEY` is set
- **WHEN** the agent calls `web_search`
- **THEN** the system SHALL use DuckDuckGo HTML scraping (no API key required)

#### Scenario: Search with numResults parameter
- **GIVEN** any search provider is available
- **WHEN** the agent calls `web_search` with `numResults: 3`
- **THEN** the system SHALL return at most 3 results

#### Scenario: Default numResults
- **WHEN** the agent calls `web_search` without `numResults`
- **THEN** the system SHALL default to 5 results

### Requirement: Compact search result format
Search results SHALL be returned in a compact format to minimize context window usage.

#### Scenario: Result format
- **WHEN** a search returns results
- **THEN** each result SHALL include `title`, `url`, and `snippet` (max 200 characters)

#### Scenario: No results found
- **WHEN** a search returns no results
- **THEN** the tool SHALL return `{ success: true, data: { results: [], query: "..." } }`

### Requirement: Search provider error handling
The system SHALL handle provider errors gracefully.

#### Scenario: Provider API returns an error
- **WHEN** the active search provider returns an HTTP error
- **THEN** the tool SHALL return `{ success: false, error: "Search failed: <provider error message>" }`

#### Scenario: Provider timeout
- **WHEN** the search request takes longer than 10 seconds
- **THEN** the system SHALL abort the request and return a timeout error

### Requirement: Brave Search provider
The system SHALL support Brave Search via `GET https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token` header.

#### Scenario: Brave API call
- **GIVEN** `BRAVE_API_KEY` is `test-key`
- **WHEN** a search is executed via Brave
- **THEN** the request SHALL include header `X-Subscription-Token: test-key` and query parameter `q` with the search query

### Requirement: Tavily Search provider
The system SHALL support Tavily Search via `POST https://api.tavily.com/search` with the API key in the request body.

#### Scenario: Tavily API call
- **GIVEN** `TAVILY_API_KEY` is `tvly-test`
- **WHEN** a search is executed via Tavily
- **THEN** the request SHALL POST to `https://api.tavily.com/search` with `api_key`, `query`, and `max_results` in the JSON body

### Requirement: DuckDuckGo fallback provider
The system SHALL support DuckDuckGo via HTML scraping of `https://html.duckduckgo.com/html/`.

#### Scenario: DuckDuckGo search
- **WHEN** a search is executed via DuckDuckGo
- **THEN** the system SHALL POST to `https://html.duckduckgo.com/html/` with form data `q=<query>` and parse result links and snippets from the HTML response
