/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserService, resetBrowserServiceForTests } from '../src/lib/services/browser-service';
import { getTool, registerOptionalTools, unregisterTool } from '../src/lib/tools';
import { setSandboxRootForTests } from '../src/lib/services/sandbox-service';

const TEST_SANDBOX_ROOT_PREFIX = 'openclaw-mini-browser-';

interface MockPage {
  goto: ReturnType<typeof mock>;
  title: ReturnType<typeof mock>;
  url: ReturnType<typeof mock>;
  waitForSelector: ReturnType<typeof mock>;
  click: ReturnType<typeof mock>;
  fill: ReturnType<typeof mock>;
  screenshot: ReturnType<typeof mock>;
  evaluate: ReturnType<typeof mock>;
  pdf: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
  setDefaultNavigationTimeout: ReturnType<typeof mock>;
  setDefaultTimeout: ReturnType<typeof mock>;
}

function createMockPage(): MockPage {
  return {
    goto: mock(async () => undefined),
    title: mock(async () => 'Example Domain'),
    url: mock(() => 'https://example.com/final'),
    waitForSelector: mock(async () => undefined),
    click: mock(async () => undefined),
    fill: mock(async () => undefined),
    screenshot: mock(async () => Uint8Array.from([1, 2, 3])),
    evaluate: mock(async (fnOrValue: unknown, arg?: unknown) => {
      if (typeof fnOrValue === 'function') {
        if (typeof arg === 'string') {
          return `text:${arg}`;
        }

        if (arg && typeof arg === 'object' && 'script' in arg) {
          return `evaluated:${String((arg as { script: unknown }).script)}`;
        }

        return 'document body text';
      }

      return fnOrValue;
    }),
    pdf: mock(async ({ path: outputPath }: { path: string }) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'pdf', 'utf-8');
    }),
    close: mock(async () => undefined),
    setDefaultNavigationTimeout: mock(() => undefined),
    setDefaultTimeout: mock(() => undefined),
  };
}

function createPlaywrightLoader(page: MockPage) {
  const browserClose = mock(async () => undefined);
  const contextClose = mock(async () => undefined);

  return {
    loader: async () => ({
      chromium: {
        launch: async () => ({
          newContext: async () => ({
            newPage: async () => page,
            close: contextClose,
          }),
          close: browserClose,
        }),
      },
    }),
    browserClose,
    contextClose,
  };
}

describe('BrowserService', () => {
  let sandboxRoot: string;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(tmpdir(), TEST_SANDBOX_ROOT_PREFIX));
    setSandboxRootForTests(sandboxRoot);
  });

  afterEach(() => {
    unregisterTool('browser_action');
    resetBrowserServiceForTests();
    setSandboxRootForTests(null);
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  test('navigates to a page and returns title and URL', async () => {
    const page = createMockPage();
    const { loader, browserClose, contextClose } = createPlaywrightLoader(page);
    const service = new BrowserService(loader);

    const result = await service.executeAction('navigate', { url: 'https://example.com' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      title: 'Example Domain',
      url: 'https://example.com/final',
    });
    expect(page.goto.mock.calls).toHaveLength(1);
    expect(page.close.mock.calls).toHaveLength(1);
    expect(contextClose.mock.calls).toHaveLength(1);
    expect(browserClose.mock.calls).toHaveLength(1);
  });

  test('clicks an element after waiting for selector', async () => {
    const page = createMockPage();
    const { loader } = createPlaywrightLoader(page);
    const service = new BrowserService(loader);

    const result = await service.executeAction('click', {
      url: 'https://example.com',
      selector: '#submit',
    });

    expect(result.success).toBe(true);
    expect(page.waitForSelector.mock.calls[0]?.[0]).toBe('#submit');
    expect(page.click.mock.calls[0]?.[0]).toBe('#submit');
  });

  test('returns base64 PNG data for screenshot action', async () => {
    const page = createMockPage();
    const { loader } = createPlaywrightLoader(page);
    const service = new BrowserService(loader);

    const result = await service.executeAction('screenshot', {
      url: 'https://example.com',
      fullPage: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      imageBase64: Buffer.from([1, 2, 3]).toString('base64'),
      mimeType: 'image/png',
    });
    expect(page.screenshot.mock.calls[0]?.[0]).toEqual({ type: 'png', fullPage: true });
  });

  test('extracts page text with optional selector', async () => {
    const page = createMockPage();
    const { loader } = createPlaywrightLoader(page);
    const service = new BrowserService(loader);

    const result = await service.executeAction('get_text', {
      url: 'https://example.com',
      selector: 'article.main',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      text: 'text:article.main',
      url: 'https://example.com/final',
    });
  });

  test('returns clear error when element is not found', async () => {
    const page = createMockPage();
    const timeoutError = Object.assign(new Error('Timeout 30000ms exceeded'), { name: 'TimeoutError' });
    page.waitForSelector = mock(async () => { throw timeoutError; });
    const { loader, browserClose, contextClose } = createPlaywrightLoader(page);
    const service = new BrowserService(loader);

    const result = await service.executeAction('click', {
      url: 'https://example.com',
      selector: '#missing',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Element not found: #missing');
    expect(page.close.mock.calls).toHaveLength(1);
    expect(contextClose.mock.calls).toHaveLength(1);
    expect(browserClose.mock.calls).toHaveLength(1);
  });

  test('returns invalid URL when called programmatically with a bad URL', async () => {
    const page = createMockPage();
    const { loader } = createPlaywrightLoader(page);
    const service = new BrowserService(loader);

    const result = await service.executeAction('navigate', { url: 'not-a-url' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid URL: not-a-url');
  });

  test('waits for visible selectors before interacting', async () => {
    const page = createMockPage();
    const { loader } = createPlaywrightLoader(page);
    const service = new BrowserService(loader);

    await service.executeAction('click', {
      url: 'https://example.com',
      selector: '#submit',
    });

    expect(page.waitForSelector.mock.calls[0]?.[1]).toEqual({ state: 'visible', timeout: 30000 });
  });

  test('returns timeout error when navigation exceeds configured timeout', async () => {
    const page = createMockPage();
    const timeoutError = Object.assign(new Error('Navigation timeout'), { name: 'TimeoutError' });
    page.goto = mock(async () => { throw timeoutError; });
    const { loader } = createPlaywrightLoader(page);
    const service = new BrowserService(loader, () => ({
      headless: true,
      viewport: { width: 1024, height: 768 },
      navigationTimeout: 1234,
    }));

    const result = await service.executeAction('navigate', { url: 'https://example.com/slow' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Navigation timed out after 1234ms');
  });

  test('writes PDFs to the agent sandbox output directory', async () => {
    const page = createMockPage();
    const { loader } = createPlaywrightLoader(page);
    const service = new BrowserService(loader);

    const result = await service.executeAction('pdf', {
      url: 'https://example.com',
      agentId: 'agent1',
    });

    expect(result.success).toBe(true);
    const pdfPath = (result.data as { path: string }).path;
    expect(pdfPath).toContain(path.join('agent1', 'output'));
    expect(fs.existsSync(pdfPath)).toBe(true);
  });

  test('caches availability checks', async () => {
    const loader = mock(async () => ({ chromium: { launch: async () => { throw new Error('unused'); } } }));
    const service = new BrowserService(loader);

    const available1 = await service.checkAvailability();
    const available2 = await service.checkAvailability();

    expect(available1).toBe(true);
    expect(available2).toBe(true);
    expect(loader.mock.calls).toHaveLength(1);
  });
});

describe('browser_action tool registration', () => {
  afterEach(() => {
    unregisterTool('browser_action');
  });

  test('registers browser_action when Playwright is available', async () => {
    const availabilitySpy = spyOn((await import('../src/lib/services/browser-service')).browserService, 'checkAvailability');
    availabilitySpy.mockResolvedValue(true);

    const executeSpy = spyOn((await import('../src/lib/services/browser-service')).browserService, 'executeAction');
    executeSpy.mockResolvedValue({ success: true, data: { title: 'ok', url: 'https://example.com' } });

    await registerOptionalTools();

    const browserTool = getTool('browser_action');
    if (!browserTool?.execute) {
      throw new Error('browser_action tool was not registered');
    }

    const result = await browserTool.execute({ action: 'navigate', url: 'https://example.com' }, { toolCallId: '1', messages: [] });
    expect(result.success).toBe(true);
    expect(executeSpy.mock.calls[0]?.[0]).toBe('navigate');

    availabilitySpy.mockRestore();
    executeSpy.mockRestore();
  });

  test('does not register browser_action when Playwright is unavailable', async () => {
    const availabilitySpy = spyOn((await import('../src/lib/services/browser-service')).browserService, 'checkAvailability');
    availabilitySpy.mockResolvedValue(false);

    await registerOptionalTools();

    expect(getTool('browser_action')).toBeUndefined();
    availabilitySpy.mockRestore();
  });
});
