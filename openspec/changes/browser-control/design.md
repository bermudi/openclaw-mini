## Context

No browser automation exists in our codebase. The closest capability is `web_fetch` (from the web-search-providers proposal) which does HTTP fetch + text extraction without JS rendering. For pages requiring interaction or JavaScript, we need a real browser.

Playwright is the standard choice for headless browser automation in the TS ecosystem. It manages Chromium lifecycle, provides a high-level API for navigation/interaction/screenshots, and works with Bun.

## Goals / Non-Goals

**Goals:**
- A `browser_action` tool that provides headless Chromium control via Playwright
- Support core actions: navigate, click, type, screenshot, get_text, evaluate (JS), pdf
- Ephemeral browser sessions — new context per tool call, cleaned up after
- Opt-in: tools only register if Playwright is installed (dynamic import check at startup)
- Configurable via `openclaw.json` (headless, viewport size, navigation timeout)

**Non-Goals:**
- Persistent browser sessions across tool calls (upgrade path for later)
- Multiple browser profiles or tab management (single page per call)
- Visual regression testing or page diffing
- SSRF protection for browser navigation (personal assistant trust model)
- Proxy or VPN configuration
- Browser extension support

## Decisions

### 1. Single compound tool with action dispatch

One tool `browser_action` with an `action` discriminator field instead of separate tools per action (`browser_navigate`, `browser_click`, etc.).

**Why?** Keeps the tool count low (one tool, not seven). The action field makes the interface clear. Multiple browser tools would pollute the tool list and add ~700 tokens to every context window.

**Schema:**
```
browser_action({
  action: "navigate" | "click" | "type" | "screenshot" | "get_text" | "evaluate" | "pdf",
  url?: string,          // for navigate
  selector?: string,     // for click, type, get_text
  text?: string,         // for type
  script?: string,       // for evaluate
  fullPage?: boolean,    // for screenshot
})
```

### 2. Ephemeral browser sessions (spawn-per-call)

Each `browser_action` call launches a new browser context, performs the action, and closes. No state between calls.

**Why?** Same rationale as MCP spawn-per-call — simplicity. No session tracking, no zombie browsers, no cleanup logic. For "go to this page and get the text" use cases, this is perfect.

**Trade-off:** Multi-step interactions (navigate → fill form → click submit → screenshot) require separate tool calls, each launching a new browser. The agent would need to navigate to the page each time.

**Upgrade path:** Add a `session_id` parameter that keeps a browser alive across calls. The service tracks open sessions with a timeout-based cleanup.

### 3. Playwright as optional peer dependency

At startup, attempt `import('playwright')`. If it fails, skip `browser_action` registration entirely. No error, no warning — the tool simply isn't available.

**Why?** Playwright pulls ~300MB of Chromium. Users who don't need browser control shouldn't pay for it. This matches how NanoClaw treats browser support as an opt-in container skill.

### 4. Screenshot returns base64 inline

Screenshots are returned as base64-encoded PNG in the tool result. For the `pdf` action, the PDF is saved to the sandbox directory and the path is returned.

**Why?** Base64 screenshots can be consumed by vision-capable models directly. PDFs are typically larger and better saved to disk.

### 5. get_text extracts innerText, not innerHTML

The `get_text` action returns `document.body.innerText` (or a specific element's innerText if a selector is provided). No HTML markup.

**Why?** Same reasoning as web_fetch — the agent needs content, not markup. Saves context tokens.

## Risks / Trade-offs

- **Playwright + Chromium is ~300MB** → Opt-in dependency. Only installed when user explicitly adds it
- **Ephemeral sessions are slow for multi-step flows** → Acceptable initial trade-off. Persistent sessions are the upgrade path
- **Chromium uses 100-300MB RAM per instance** → Only while a tool call is active. Ephemeral sessions ensure cleanup
- **No SSRF protection** → Personal assistant trust model. The user controls what URLs the agent visits. Revisit if multi-tenant use cases emerge
- **Base64 screenshots in tool results** → Can be large (~50-200KB). Vision models handle this fine. For non-vision models, screenshots aren't useful anyway
