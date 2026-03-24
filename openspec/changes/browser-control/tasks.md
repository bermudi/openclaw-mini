## 1. Config schema — browser section

- [x] 1.1 Add optional `browser` section to config schema in `src/lib/config/schema.ts`: `headless?: boolean` (default true), `viewport?: { width: number, height: number }` (default 1280x720), `navigationTimeout?: number` (default 30000)
- [x] 1.2 Update `runtimeConfigSchema` to allow the `browser` section
- [x] 1.3 Add `getBrowserConfig()` helper that returns resolved config with defaults
- [x] 1.4 Write validation tests: valid browser config, partial config with defaults, invalid viewport values, missing browser section

## 2. Browser service

- [x] 2.1 Create `src/lib/services/browser-service.ts` with a `BrowserService` class
- [x] 2.2 Implement `checkAvailability()` — attempt `await import('playwright')`, return boolean. Cache result
- [x] 2.3 Implement core `executeAction(action, params)` method — launch browser with config, create context + page, dispatch to action handler, close everything in `finally` block
- [x] 2.4 Implement action handlers: `navigate(url)` → return title + URL; `click(url, selector)` → navigate, click, return title + URL; `type(url, selector, text)` → navigate, type, return success; `screenshot(url, fullPage?)` → navigate, screenshot, return base64 PNG; `getText(url, selector?)` → navigate, return innerText; `evaluate(url, script)` → navigate, evaluate, return result; `pdf(url, agentId)` → navigate, save PDF to sandbox dir, return path
- [x] 2.5 Add timeout handling: abort navigation after `navigationTimeout`, close browser on any error
- [x] 2.6 Add element-not-found handling: catch Playwright's timeout when waiting for selector, return clear error message

## 3. Register browser_action tool

- [x] 3.1 At startup, call `browserService.checkAvailability()` — only register tool if Playwright is available
- [x] 3.2 Register `browser_action` tool with input schema using `z.discriminatedUnion` on `action` field: navigate requires `url`; click requires `url` + `selector`; type requires `url` + `selector` + `text`; screenshot requires `url` + optional `fullPage`; get_text requires `url` + optional `selector`; evaluate requires `url` + `script`; pdf requires `url` + `agentId`. Risk level: `high`
- [x] 3.3 Execute dispatches to `browserService.executeAction()` and returns results
- [x] 3.4 Write unit tests with mocked Playwright: navigate, click, screenshot, get_text, element not found, timeout, Playwright not installed (tool not registered)
