/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  BraveSearchProvider,
  DuckDuckGoSearchProvider,
  SearchService,
  TavilySearchProvider,
  getSearchProvider,
  type SearchConfig,
} from '../src/lib/services/search-service';

type FetchStub = (input: string | URL, init?: RequestInit) => Promise<Response>;

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

beforeEach(() => {
  restoreEnv();
  delete process.env.BRAVE_API_KEY;
  delete process.env.TAVILY_API_KEY;
});

afterEach(() => {
  restoreEnv();
});

describe('search providers', () => {
  test('BraveSearchProvider calls API and maps results', async () => {
    let observedUrl = '';
    let observedHeader = '';

    const fetchStub: FetchStub = async (input, init) => {
      observedUrl = String(input);
      observedHeader = String((init?.headers as Record<string, string>)['X-Subscription-Token']);
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: '  Brave Result  ',
                url: 'https://example.com/brave',
                description: 'a'.repeat(260),
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    const provider = new BraveSearchProvider(
      'brave-key',
      fetchStub,
    );

    const results = await provider.search('TypeScript', 3);

    expect(observedUrl).toContain('https://api.search.brave.com/res/v1/web/search');
    expect(observedUrl).toContain('q=TypeScript');
    expect(observedUrl).toContain('count=3');
    expect(observedHeader).toBe('brave-key');
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Brave Result');
    expect(results[0]?.url).toBe('https://example.com/brave');
    expect(results[0]?.snippet.length).toBe(200);
  });

  test('TavilySearchProvider calls API and maps results', async () => {
    let observedBody = '';

    const fetchStub: FetchStub = async (_input, init) => {
      observedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Tavily Result',
              url: 'https://example.com/tavily',
              content: 'Useful summary',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    const provider = new TavilySearchProvider(
      'tvly-key',
      fetchStub,
    );

    const results = await provider.search('RAG', 2);

    expect(observedBody).toContain('"api_key":"tvly-key"');
    expect(observedBody).toContain('"query":"RAG"');
    expect(observedBody).toContain('"max_results":2');
    expect(results).toEqual([
      {
        title: 'Tavily Result',
        url: 'https://example.com/tavily',
        snippet: 'Useful summary',
      },
    ]);
  });

  test('DuckDuckGoSearchProvider parses HTML results', async () => {
    const html = `
      <div class="results">
        <div class="result">
          <a class="result__a" href="https://example.com/one">First <b>Result</b></a>
          <a class="result__snippet">One summary</a>
        </div>
      </div>
    `;

    const fetchStub: FetchStub = async () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    const provider = new DuckDuckGoSearchProvider(fetchStub);

    const results = await provider.search('hello', 5);
    expect(results).toEqual([
      {
        title: 'First Result',
        url: 'https://example.com/one',
        snippet: 'One summary',
      },
    ]);
  });
});

describe('getSearchProvider', () => {
  test('uses BRAVE_API_KEY env var over config', async () => {
    process.env.BRAVE_API_KEY = 'env-brave';

    let observedHeader = '';
    const fetchStub: FetchStub = async (_input, init) => {
      observedHeader = String((init?.headers as Record<string, string>)['X-Subscription-Token']);
      return new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const provider = getSearchProvider(
      { braveApiKey: 'config-brave' },
      fetchStub,
    );

    expect(provider.name).toBe('brave');
    await provider.search('test', 1);
    expect(observedHeader).toBe('env-brave');
  });

  test('falls back to Tavily when Brave key is unavailable', () => {
    const provider = getSearchProvider({ tavilyApiKey: 'tvly-config' });
    expect(provider.name).toBe('tavily');
  });

  test('falls back to DuckDuckGo when no API keys exist', () => {
    const config: SearchConfig = {};
    const provider = getSearchProvider(config);
    expect(provider.name).toBe('duckduckgo');
  });
});

describe('SearchService', () => {
  test('normalizes empty query and numResults floor', async () => {
    const calls: Array<{ query: string; numResults: number }> = [];
    const provider = {
      name: 'duckduckgo' as const,
      search: async (query: string, numResults: number) => {
        calls.push({ query, numResults });
        return [];
      },
    };

    const service = new SearchService(provider);
    const empty = await service.search('   ', 5);
    const nonEmpty = await service.search('  test  ', 0);

    expect(empty).toEqual([]);
    expect(nonEmpty).toEqual([]);
    expect(calls).toEqual([{ query: 'test', numResults: 1 }]);
  });
});
