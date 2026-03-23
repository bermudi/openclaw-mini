## Why

We have a `web_search` tool registered but it's a stub — always returns "Web search not configured". This is the most basic capability gap. Every comparable project (NanoBot, MicroClaw, OpenClaw, ZeroClaw) has working web search. Without it, agents can't answer questions about current events, look up documentation, or verify facts.

NanoBot's approach — a fallback chain across multiple providers (Brave → Tavily → DuckDuckGo) — is elegant and user-friendly: configure whichever API key you have, or use the free option.

## What Changes

- Replace the `web_search` stub with a working implementation that supports multiple search providers
- Add a `web_fetch` tool for retrieving and extracting text content from URLs
- Support three search providers with automatic fallback: **Brave Search** (best quality), **Tavily** (AI-optimized), **DuckDuckGo** (free, no API key)
- Add search provider configuration to `openclaw.json`
- Provider selection: use the first configured provider, or fall back to DuckDuckGo if none configured

## Capabilities

### New Capabilities

- `web-search`: Multi-provider web search with automatic fallback — Brave, Tavily, and DuckDuckGo support, configurable via `openclaw.json` or env vars
- `web-fetch`: URL content extraction tool that fetches a web page and returns cleaned text content

### Modified Capabilities

- `runtime-config`: Add `search` section for provider API keys and preferences

## Impact

- **Dependencies**: Add lightweight HTTP-based search clients (no heavy SDKs — these are simple REST APIs)
- **Tools**: Replace `web_search` stub implementation; add new `web_fetch` tool
- **Config**: `openclaw.json` gains optional `search` section for API keys
- **Env vars**: Support `BRAVE_API_KEY`, `TAVILY_API_KEY` for zero-config setup
- **Code**: New `src/lib/services/search-service.ts`; edits to `src/lib/tools.ts`
