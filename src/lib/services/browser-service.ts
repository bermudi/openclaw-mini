import fs from 'node:fs';
import path from 'node:path';
import { getBrowserConfig, type ResolvedBrowserConfig } from '@/lib/config/runtime';
import { getSandboxOutputDir } from '@/lib/services/sandbox-service';
import type { ToolResult } from '@/lib/tools';

export interface BrowserActionPayloadMap {
  navigate: { url: string };
  click: { url: string; selector: string };
  type: { url: string; selector: string; text: string };
  screenshot: { url: string; fullPage?: boolean };
  get_text: { url: string; selector?: string };
  evaluate: { url: string; script: string };
  pdf: { url: string; agentId: string };
}

export type BrowserAction = keyof BrowserActionPayloadMap;

interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number; waitUntil?: 'load' }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  waitForSelector(selector: string, options?: { state?: 'attached' | 'visible'; timeout?: number }): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  screenshot(options?: { type?: 'png'; fullPage?: boolean }): Promise<Uint8Array | ArrayBuffer | string>;
  evaluate<Result>(pageFunction: unknown, arg?: unknown): Promise<Result>;
  pdf(options: { path: string }): Promise<unknown>;
  close?(): Promise<void>;
  setDefaultNavigationTimeout?(timeout: number): void;
  setDefaultTimeout?(timeout: number): void;
}

interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options?: { viewport?: { width: number; height: number } }): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightModule {
  chromium: {
    launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
  };
}

type PlaywrightLoader = () => Promise<unknown>;
type BrowserConfigResolver = () => ResolvedBrowserConfig;

const importOptionalModule = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;

class BrowserElementNotFoundError extends Error {
  constructor(selector: string) {
    super(`Element not found: ${selector}`);
    this.name = 'BrowserElementNotFoundError';
  }
}

class BrowserNavigationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Navigation timed out after ${timeoutMs}ms`);
    this.name = 'BrowserNavigationTimeoutError';
  }
}

function asPlaywrightModule(value: unknown): PlaywrightModule {
  if (
    typeof value !== 'object'
    || value === null
    || !('chromium' in value)
    || typeof value.chromium !== 'object'
    || value.chromium === null
    || !('launch' in value.chromium)
    || typeof value.chromium.launch !== 'function'
  ) {
    throw new Error('Invalid Playwright module');
  }

  return value as PlaywrightModule;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported browser action: ${String(value)}`);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'TimeoutError' || /timed out|timeout/i.test(error.message);
}

function toBuffer(value: Uint8Array | ArrayBuffer | string): Buffer {
  if (typeof value === 'string') {
    return Buffer.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  return Buffer.from(value);
}

async function loadPlaywrightModule(): Promise<PlaywrightModule> {
  return asPlaywrightModule(await importOptionalModule('playwright'));
}

export class BrowserService {
  private availability: boolean | null = null;
  private playwrightModulePromise: Promise<PlaywrightModule> | null = null;

  constructor(
    private readonly loader: PlaywrightLoader = loadPlaywrightModule,
    private readonly configResolver: BrowserConfigResolver = getBrowserConfig,
  ) {}

  async checkAvailability(): Promise<boolean> {
    if (this.availability !== null) {
      return this.availability;
    }

    try {
      await this.getPlaywrightModule();
      this.availability = true;
    } catch {
      this.availability = false;
    }

    return this.availability;
  }

  async executeAction<Action extends BrowserAction>(
    action: Action,
    params: BrowserActionPayloadMap[Action],
  ): Promise<ToolResult> {
    if (!await this.checkAvailability()) {
      return {
        success: false,
        error: 'Browser automation is unavailable because Playwright is not installed.',
      };
    }

    const config = this.configResolver();
    let browser: PlaywrightBrowser | null = null;
    let context: PlaywrightBrowserContext | null = null;
    let page: PlaywrightPage | null = null;

    try {
      const playwright = await this.getPlaywrightModule();
      browser = await playwright.chromium.launch({ headless: config.headless });
      context = await browser.newContext({ viewport: config.viewport });

      page = await context.newPage();
      page.setDefaultNavigationTimeout?.(config.navigationTimeout);
      page.setDefaultTimeout?.(config.navigationTimeout);

      switch (action) {
        case 'navigate':
          return await this.navigate(page, params as BrowserActionPayloadMap['navigate'], config.navigationTimeout);
        case 'click':
          return await this.click(page, params as BrowserActionPayloadMap['click'], config.navigationTimeout);
        case 'type':
          return await this.type(page, params as BrowserActionPayloadMap['type'], config.navigationTimeout);
        case 'screenshot':
          return await this.screenshot(page, params as BrowserActionPayloadMap['screenshot'], config.navigationTimeout);
        case 'get_text':
          return await this.getText(page, params as BrowserActionPayloadMap['get_text'], config.navigationTimeout);
        case 'evaluate':
          return await this.evaluate(page, params as BrowserActionPayloadMap['evaluate'], config.navigationTimeout);
        case 'pdf':
          return await this.pdf(page, params as BrowserActionPayloadMap['pdf'], config.navigationTimeout);
        default:
          assertNever(action);
      }

      return {
        success: false,
        error: `Unsupported browser action: ${String(action)}`,
      };
    } catch (error) {
      return {
        success: false,
        error: this.toErrorMessage(error),
      };
    } finally {
      if (page?.close) {
        await page.close().catch(() => undefined);
      }
      if (context) {
        await context.close().catch(() => undefined);
      }
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  resetForTests(): void {
    this.availability = null;
    this.playwrightModulePromise = null;
  }

  private async getPlaywrightModule(): Promise<PlaywrightModule> {
    if (!this.playwrightModulePromise) {
      this.playwrightModulePromise = this.loader().then(asPlaywrightModule);
    }

    return this.playwrightModulePromise;
  }

  private async navigate(page: PlaywrightPage, params: BrowserActionPayloadMap['navigate'], timeoutMs: number): Promise<ToolResult> {
    this.ensureValidUrl(params.url);
    await this.goto(page, params.url, timeoutMs);
    return {
      success: true,
      data: {
        title: await page.title(),
        url: page.url(),
      },
    };
  }

  private async click(page: PlaywrightPage, params: BrowserActionPayloadMap['click'], timeoutMs: number): Promise<ToolResult> {
    this.ensureValidUrl(params.url);
    await this.goto(page, params.url, timeoutMs);
    await this.waitForSelector(page, params.selector, timeoutMs);
    await page.click(params.selector);
    return {
      success: true,
      data: {
        title: await page.title(),
        url: page.url(),
      },
    };
  }

  private async type(page: PlaywrightPage, params: BrowserActionPayloadMap['type'], timeoutMs: number): Promise<ToolResult> {
    this.ensureValidUrl(params.url);
    await this.goto(page, params.url, timeoutMs);
    await this.waitForSelector(page, params.selector, timeoutMs);
    await page.fill(params.selector, params.text);
    return {
      success: true,
      data: {
        typed: true,
        url: page.url(),
      },
    };
  }

  private async screenshot(page: PlaywrightPage, params: BrowserActionPayloadMap['screenshot'], timeoutMs: number): Promise<ToolResult> {
    this.ensureValidUrl(params.url);
    await this.goto(page, params.url, timeoutMs);
    const image = await page.screenshot({ type: 'png', fullPage: params.fullPage ?? false });
    return {
      success: true,
      data: {
        imageBase64: toBuffer(image).toString('base64'),
        mimeType: 'image/png',
      },
    };
  }

  private async getText(page: PlaywrightPage, params: BrowserActionPayloadMap['get_text'], timeoutMs: number): Promise<ToolResult> {
    this.ensureValidUrl(params.url);
    await this.goto(page, params.url, timeoutMs);

    const text = params.selector
      ? await this.getElementText(page, params.selector, timeoutMs)
      : await page.evaluate<string>(() => document.body.innerText);

    return {
      success: true,
      data: {
        text,
        url: page.url(),
      },
    };
  }

  private async evaluate(page: PlaywrightPage, params: BrowserActionPayloadMap['evaluate'], timeoutMs: number): Promise<ToolResult> {
    this.ensureValidUrl(params.url);
    await this.goto(page, params.url, timeoutMs);
    const result = await page.evaluate<unknown>(({ script }: { script: string }) => (0, eval)(script), { script: params.script });
    return {
      success: true,
      data: {
        result,
        url: page.url(),
      },
    };
  }

  private async pdf(page: PlaywrightPage, params: BrowserActionPayloadMap['pdf'], timeoutMs: number): Promise<ToolResult> {
    this.ensureValidUrl(params.url);
    await this.goto(page, params.url, timeoutMs);
    const outputDir = getSandboxOutputDir(params.agentId);
    const filePath = path.join(outputDir, `browser-${Date.now()}.pdf`);
    fs.mkdirSync(outputDir, { recursive: true });
    await page.pdf({ path: filePath });
    return {
      success: true,
      data: {
        path: filePath,
        url: page.url(),
      },
    };
  }

  private async goto(page: PlaywrightPage, url: string, timeoutMs: number): Promise<void> {
    try {
      await page.goto(url, { timeout: timeoutMs, waitUntil: 'load' });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new BrowserNavigationTimeoutError(timeoutMs);
      }
      throw error;
    }
  }

  private async waitForSelector(page: PlaywrightPage, selector: string, timeoutMs: number): Promise<void> {
    try {
      await page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new BrowserElementNotFoundError(selector);
      }
      throw error;
    }
  }

  private async getElementText(page: PlaywrightPage, selector: string, timeoutMs: number): Promise<string> {
    await this.waitForSelector(page, selector, timeoutMs);
    const text = await page.evaluate<string | null>((targetSelector: string) => {
      const element = document.querySelector(targetSelector);
      return element instanceof HTMLElement ? element.innerText : null;
    }, selector);

    if (typeof text !== 'string') {
      throw new Error(`Failed to extract text for selector: ${selector}`);
    }

    return text;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof BrowserElementNotFoundError || error instanceof BrowserNavigationTimeoutError) {
      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown browser automation error';
  }

  private ensureValidUrl(url: string): void {
    if (!isValidUrl(url)) {
      throw new Error(`Invalid URL: ${url}`);
    }
  }
}

export const browserService = new BrowserService();

export function resetBrowserServiceForTests(): void {
  browserService.resetForTests();
}
