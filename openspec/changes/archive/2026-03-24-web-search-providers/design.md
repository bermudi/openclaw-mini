## Context

The `web_search` tool is already registered in `src/lib/tools.ts` (lines 542-558) with the correct Zod schema (`query: string`, `numResults?: number`) but its `execute` function returns `{ success: false, error: 'Web search not configured' }`. We need to replace this stub with a real implementation.

All three target search providers are simple REST APIs — no SDKs needed:
- **Brave**: `GET https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token` header
- **Tavily**: `POST https://api.tavily.com/search` with API key in body
- **DuckDuckGo**: `GET https://html.duckduckgo.com/html/?q=...` — no API key, HTML scraping

## Goals / Non-Goals

**Goals:**
- Working web search with zero mandatory configuration (DuckDuckGo works out of the box)
- Users can upgrade quality by adding a Brave or Tavily API key
- Automatic provider selection: first configured key wins, DuckDuckGo as ultimate fallback
- A `web_fetch` tool for direct URL content extraction (agent says "fetch this page and get the text")
- Compact results format to minimize context usage

**Non-Goals:**
- Caching search results across requests (stateless for now)
- Image/video search (text results only)
- Search result ranking or re-ranking beyond what the provider returns
- Rate limiting (providers handle their own)

## Decisions

### 1. Provider fallback chain, not user-selected provider

The system checks for API keys in order: Brave → Tavily → DuckDuckGo. First available wins. No `search.provider` config needed.

**Why?** Simpler UX. User sets an env var or config key, search works. No need to also specify which provider to use. If they have both keys, Brave wins (better quality).

**Alternative considered:** Explicit `search.provider` field — adds config complexity for minimal benefit.

### 2. Direct HTTP calls, no SDK dependencies

All three providers are simple REST APIs. We use native `fetch()` to call them.

**Why?** No new dependencies. Brave and Tavily have official SDKs but they're unnecessary overhead for simple GET/POST calls.

### 3. Replace the stub in-place

The existing `web_search` tool registration stays at the same location in `tools.ts`. We replace the execute function to call the search service.

**Why?** The tool name, schema, and risk level are already correct. No breaking change.

### 4. DuckDuckGo via HTML scraping

DuckDuckGo doesn't have a public JSON API. We fetch `https://html.duckduckgo.com/html/?q=...` and parse the HTML response for result links and snippets.

**Why?** It's the only free, no-API-key option. The HTML endpoint is stable and widely used by similar projects. The parsing is straightforward — results are in `.result` elements.

**Trade-off:** HTML parsing is brittle if DDG changes their markup. Acceptable — it's the fallback of last resort.

### 5. web_fetch extracts readable text, not raw HTML

`web_fetch` fetches a URL and returns extracted text content (stripped HTML tags, scripts, styles). Not a full browser render — just HTTP fetch + text extraction.

**Why?** Raw HTML wastes context tokens on markup. The agent needs the content, not the tags. For pages requiring JS rendering, the browser_control tool (separate proposal) is the right answer.

## Risks / Trade-offs

- **DuckDuckGo HTML scraping may break** → It's the fallback; primary providers use stable APIs. If DDG breaks, users can add a Brave/Tavily key
- **web_fetch can't handle JS-rendered pages** → By design. Browser control proposal handles that use case
- **No rate limiting** → Provider-side rate limits apply. For a personal assistant doing a few searches per conversation, this is fine
- **Brave/Tavily are paid** → DuckDuckGo is always free. Brave has a generous free tier (2000 queries/month)
