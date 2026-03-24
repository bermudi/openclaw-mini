import { providerRegistry } from '@/lib/services/provider-registry';

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_SNIPPET_LENGTH = 200;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchConfig {
  braveApiKey?: string;
  tavilyApiKey?: string;
}

export interface SearchProvider {
  readonly name: 'brave' | 'tavily' | 'duckduckgo';
  search(query: string, numResults: number): Promise<SearchResult[]>;
}

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateSnippet(value: string): string {
  if (value.length <= MAX_SNIPPET_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_SNIPPET_LENGTH - 3)}...`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

function stripHtml(value: string): string {
  const withoutTags = value.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(normalizeWhitespace(withoutTags));
}

function normalizeResult(result: SearchResult): SearchResult {
  return {
    title: normalizeWhitespace(result.title),
    url: result.url.trim(),
    snippet: truncateSnippet(normalizeWhitespace(result.snippet)),
  };
}

function ensureHttpOk(response: Response, providerName: string): Response {
  if (!response.ok) {
    throw new Error(`${providerName} returned HTTP ${response.status}`);
  }
  return response;
}

async function fetchWithTimeout(
  fetchImpl: FetchImpl,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    return await fetchImpl(input, {
      ...init,
      signal: abortController.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`Search request timed out after ${Math.floor(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDuckDuckGoResults(html: string, numResults: number): SearchResult[] {
  const resultBlocks = html
    .split(/<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>/gi)
    .slice(1);
  const results: SearchResult[] = [];

  for (const block of resultBlocks) {
    if (results.length >= numResults) {
      break;
    }

    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }

    const rawUrl = decodeHtmlEntities(linkMatch[1] ?? '').trim();
    const title = stripHtml(linkMatch[2] ?? '');

    let url = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      const redirected = parsed.searchParams.get('uddg');
      if (redirected) {
        url = decodeURIComponent(redirected);
      }
    } catch {
      continue;
    }

    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = stripHtml(snippetMatch?.[1] ?? '');

    results.push(
      normalizeResult({
        title,
        url,
        snippet,
      }),
    );
  }

  return results;
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave' as const;

  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchImpl = fetch) {}

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(numResults));

    const response = ensureHttpOk(
      await fetchWithTimeout(
        this.fetchImpl,
        url,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': this.apiKey,
          },
        },
        SEARCH_TIMEOUT_MS,
      ),
      'Brave Search',
    );

    const payload = await response.json() as {
      web?: {
        results?: Array<{ title?: string; url?: string; description?: string }>;
      };
    };

    return (payload.web?.results ?? [])
      .slice(0, numResults)
      .map((entry) => normalizeResult({
        title: entry.title ?? '',
        url: entry.url ?? '',
        snippet: entry.description ?? '',
      }))
      .filter(result => result.title.length > 0 && result.url.length > 0);
  }
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily' as const;

  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchImpl = fetch) {}

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const response = ensureHttpOk(
      await fetchWithTimeout(
        this.fetchImpl,
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: this.apiKey,
            query,
            max_results: numResults,
          }),
        },
        SEARCH_TIMEOUT_MS,
      ),
      'Tavily Search',
    );

    const payload = await response.json() as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    return (payload.results ?? [])
      .slice(0, numResults)
      .map((entry) => normalizeResult({
        title: entry.title ?? '',
        url: entry.url ?? '',
        snippet: entry.content ?? '',
      }))
      .filter(result => result.title.length > 0 && result.url.length > 0);
  }
}

export class DuckDuckGoSearchProvider implements SearchProvider {
  readonly name = 'duckduckgo' as const;

  constructor(private readonly fetchImpl: FetchImpl = fetch) {}

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const formData = new URLSearchParams({ q: query });

    const response = ensureHttpOk(
      await fetchWithTimeout(
        this.fetchImpl,
        'https://html.duckduckgo.com/html/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        },
        SEARCH_TIMEOUT_MS,
      ),
      'DuckDuckGo Search',
    );

    const html = await response.text();
    return parseDuckDuckGoResults(html, numResults);
  }
}

function getRuntimeSearchConfig(): SearchConfig | undefined {
  try {
    return providerRegistry.getState().config.search;
  } catch {
    return undefined;
  }
}

export function getSearchProvider(
  config: SearchConfig = getRuntimeSearchConfig() ?? {},
  fetchImpl: FetchImpl = fetch,
): SearchProvider {
  const braveApiKey = process.env.BRAVE_API_KEY?.trim() || config.braveApiKey?.trim();
  if (braveApiKey) {
    return new BraveSearchProvider(braveApiKey, fetchImpl);
  }

  const tavilyApiKey = process.env.TAVILY_API_KEY?.trim() || config.tavilyApiKey?.trim();
  if (tavilyApiKey) {
    return new TavilySearchProvider(tavilyApiKey, fetchImpl);
  }

  return new DuckDuckGoSearchProvider(fetchImpl);
}

export class SearchService {
  constructor(private readonly provider: SearchProvider) {}

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    const normalizedNumResults = Math.max(1, Math.floor(numResults));

    if (!normalizedQuery) {
      return [];
    }

    return this.provider.search(normalizedQuery, normalizedNumResults);
  }
}
