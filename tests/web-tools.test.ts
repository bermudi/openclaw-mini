/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getTool } from '../src/lib/tools';

const ORIGINAL_ENV = { ...process.env };
const originalFetch = global.fetch;

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
  global.fetch = originalFetch;
});

afterEach(() => {
  restoreEnv();
  global.fetch = originalFetch;
});

describe('web_search tool', () => {
  test('returns mapped search results', async () => {
    global.fetch = (async () => {
      return new Response(
        `
          <div class="result">
            <a class="result__a" href="https://example.com/one">First Result</a>
            <a class="result__snippet">First snippet</a>
          </div>
          <div class="result">
            <a class="result__a" href="https://example.com/two">Second Result</a>
            <a class="result__snippet">Second snippet</a>
          </div>
        `,
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      );
    }) as unknown as typeof fetch;

    const webSearch = getTool('web_search');
    if (!webSearch?.execute) {
      throw new Error('web_search tool is not registered');
    }

    const result = await webSearch.execute({ query: 'test query' }, { toolCallId: 'test', messages: [] });
    const data = result.data as { results?: unknown[]; query?: string; provider?: string } | undefined;

    expect(result.success).toBe(true);
    expect(data?.query).toBe('test query');
    expect(data?.provider).toBe('duckduckgo');
    expect(data?.results).toHaveLength(2);
  });

  test('returns empty results when provider returns none', async () => {
    global.fetch = (async () => new Response('<html><body>No results</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch;

    const webSearch = getTool('web_search');
    if (!webSearch?.execute) {
      throw new Error('web_search tool is not registered');
    }

    const result = await webSearch.execute({ query: 'nothing' }, { toolCallId: 'test', messages: [] });
    const data = result.data as { results?: unknown[] } | undefined;

    expect(result.success).toBe(true);
    expect(data?.results).toEqual([]);
  });

  test('returns provider error details', async () => {
    global.fetch = (async () => new Response('error', { status: 500 })) as unknown as typeof fetch;

    const webSearch = getTool('web_search');
    if (!webSearch?.execute) {
      throw new Error('web_search tool is not registered');
    }

    const result = await webSearch.execute({ query: 'failing query' }, { toolCallId: 'test', messages: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Search failed:');
  });

  test('respects custom numResults', async () => {
    global.fetch = (async () => {
      return new Response(
        `
          <div class="result"><a class="result__a" href="https://example.com/a">A</a><a class="result__snippet">A s</a></div>
          <div class="result"><a class="result__a" href="https://example.com/b">B</a><a class="result__snippet">B s</a></div>
        `,
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      );
    }) as unknown as typeof fetch;

    const webSearch = getTool('web_search');
    if (!webSearch?.execute) {
      throw new Error('web_search tool is not registered');
    }

    const result = await webSearch.execute({ query: 'limited', numResults: 1 }, { toolCallId: 'test', messages: [] });
    const data = result.data as { results?: unknown[] } | undefined;

    expect(result.success).toBe(true);
    expect(data?.results).toHaveLength(1);
  });
});

describe('surface directive tools', () => {
  test('emit_to_chat returns a text surface directive', async () => {
    const emitToChat = getTool('emit_to_chat');
    if (!emitToChat?.execute) {
      throw new Error('emit_to_chat tool is not registered');
    }

    const result = await emitToChat.execute({ text: 'Surface this directly' }, { toolCallId: 'emit', messages: [] });

    expect(result).toEqual({
      success: true,
      data: { emitted: true },
      surface: [{ type: 'text', content: 'Surface this directly' }],
    });
  });
});

describe('web_fetch tool', () => {
  test('fetches and strips HTML content', async () => {
    global.fetch = (async () => {
      return new Response(
        '<html><head><style>body{}</style></head><body><h1>Hello</h1><script>alert(1)</script><p>World</p></body></html>',
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      );
    }) as unknown as typeof fetch;

    const webFetch = getTool('web_fetch');
    if (!webFetch?.execute) {
      throw new Error('web_fetch tool is not registered');
    }

    const result = await webFetch.execute({ url: 'https://example.com' }, { toolCallId: 'test', messages: [] });
    const data = result.data as { content?: string; truncated?: boolean } | undefined;

    expect(result.success).toBe(true);
    expect(data?.content).toBe('Hello World');
    expect(data?.truncated).toBe(false);
  });

  test('fetches JSON as raw text', async () => {
    global.fetch = (async () => {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const webFetch = getTool('web_fetch');
    if (!webFetch?.execute) {
      throw new Error('web_fetch tool is not registered');
    }

    const result = await webFetch.execute({ url: 'https://example.com/api' }, { toolCallId: 'test', messages: [] });
    const data = result.data as { content?: string } | undefined;

    expect(result.success).toBe(true);
    expect(data?.content).toBe('{"ok":true}');
  });

  test('follows redirects up to final URL', async () => {
    let callCount = 0;
    global.fetch = (async (input) => {
      callCount += 1;
      const url = String(input);
      if (url === 'https://short.url/abc') {
        return new Response('', {
          status: 302,
          headers: { location: 'https://example.com/final' },
        });
      }
      return new Response('Final content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }) as unknown as typeof fetch;

    const webFetch = getTool('web_fetch');
    if (!webFetch?.execute) {
      throw new Error('web_fetch tool is not registered');
    }

    const result = await webFetch.execute({ url: 'https://short.url/abc' }, { toolCallId: 'test', messages: [] });
    const data = result.data as { content?: string; url?: string } | undefined;

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
    expect(data?.content).toBe('Final content');
  });

  test('returns timeout error when fetch aborts', async () => {
    global.fetch = (async () => {
      const error = new Error('aborted') as Error & { name: string };
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof fetch;

    const webFetch = getTool('web_fetch');
    if (!webFetch?.execute) {
      throw new Error('web_fetch tool is not registered');
    }

    const result = await webFetch.execute({ url: 'https://example.com/slow' }, { toolCallId: 'test', messages: [] });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Fetch timed out after 15s');
  });

  test('returns HTTP error for non-2xx responses', async () => {
    global.fetch = (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch;

    const webFetch = getTool('web_fetch');
    if (!webFetch?.execute) {
      throw new Error('web_fetch tool is not registered');
    }

    const result = await webFetch.execute({ url: 'https://example.com/missing' }, { toolCallId: 'test', messages: [] });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Fetch failed: HTTP 404');
  });

  test('returns validation error for invalid URL input', async () => {
    const webFetch = getTool('web_fetch');
    if (!webFetch?.execute) {
      throw new Error('web_fetch tool is not registered');
    }

    const result = await webFetch.execute({ url: 'not-a-url' }, { toolCallId: 'test', messages: [] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid URL');
  });

  test('truncates overly long content', async () => {
    global.fetch = (async () => new Response('a'.repeat(20_000), {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })) as unknown as typeof fetch;

    const webFetch = getTool('web_fetch');
    if (!webFetch?.execute) {
      throw new Error('web_fetch tool is not registered');
    }

    const result = await webFetch.execute({ url: 'https://example.com/large' }, { toolCallId: 'test', messages: [] });
    const data = result.data as { content?: string; truncated?: boolean } | undefined;

    expect(result.success).toBe(true);
    expect(data?.truncated).toBe(true);
    expect(data?.content?.length).toBe(10_000);
  });
});
