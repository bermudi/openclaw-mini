## Why

Several Claws projects (NanoClaw, OpenClaw, MicroClaw, ZeroClaw) offer browser automation — from simple URL fetching to full Chromium CDP control. For our lightweight runtime, full browser control is the highest-value "power tool" we're missing. Agents need to interact with web apps, fill forms, take screenshots, and extract structured data from pages that require JavaScript rendering.

We'll use Playwright as an opt-in dependency — it's the standard for headless browser automation in the Node/Bun ecosystem, has excellent TypeScript support, and handles Chromium lifecycle management.

## What Changes

- Add an opt-in `browser_action` tool that provides headless Chromium control via Playwright
- Support actions: `navigate`, `click`, `type`, `screenshot`, `get_text`, `evaluate` (run JS), `pdf`
- Browser sessions are ephemeral — new browser per tool call (like our spawn-per-call MCP approach; upgrade path to persistent sessions exists)
- Playwright is a peer/optional dependency — browser tools only register if Playwright is installed
- Add a `browser` section to `openclaw.json` for configuration (headless mode, viewport, timeout)

## Capabilities

### New Capabilities

- `browser-control`: Headless browser automation via Playwright — navigate, interact, screenshot, extract text, run JavaScript, and generate PDFs
- `browser-config`: Configuration schema for browser settings (headless, viewport, timeouts, opt-in enablement)

### Modified Capabilities

- `runtime-config`: Add optional `browser` section to config schema

## Impact

- **Dependencies**: `playwright` as optional/peer dependency (not installed by default — users opt in with `bun add playwright`)
- **Tools**: One new compound tool `browser_action` with action-based dispatch
- **Config**: `openclaw.json` gains optional `browser` section
- **Code**: New `src/lib/services/browser-service.ts`; tool registration in `src/lib/tools.ts`; config schema update
- **Resource usage**: Chromium uses ~100-300MB per instance — but only when actively used, not at idle. Ephemeral sessions ensure cleanup
