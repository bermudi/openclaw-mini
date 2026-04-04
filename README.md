# OpenClaw Mini

OpenClaw Mini is a lightweight OpenClaw-inspired agent runtime built with Next.js, Bun, Prisma, and local markdown-backed context files.

## Quick start

1. Install dependencies:
   ```bash
   bun install
   ```
2. Initialize the database:
   ```bash
   bun run db:push
   ```
3. Run the interactive setup wizard:
   ```bash
   bun run setup
   ```
   This guides you through provider keys, auth, workspace bootstrap, and optional
   channel integrations. Run `bun run setup --doctor` at any time to check install health.
4. Start the app:
   ```bash
   bun run dev
   ```

> **Manual setup:** If you prefer to configure by hand, copy `examples/openclaw.json`
> to `~/.openclaw/openclaw.json`, set `OPENCLAW_CONFIG_PATH` to override the path,
> and see `SETUP.md` for the full reference.

## Internal API auth

OpenClaw Mini now protects admin APIs and trusted service boundaries with `Authorization: Bearer <token>`.

- Set `OPENCLAW_API_KEY` for the Next.js admin APIs, scheduler, and WebSocket `/broadcast` ingress.
- The scheduler and internal WS client automatically send this bearer token once it is configured.
- Startup fails fast if `OPENCLAW_API_KEY` is missing.
- For local-only testing, you can temporarily set `OPENCLAW_ALLOW_INSECURE_LOCAL=true` to bypass internal auth with a warning.
- Browser clients (`/chat` and dashboard send-message actions) do not embed bearer tokens; they only work in local insecure mode or behind an authenticating reverse proxy.
- Webhook signature verification remains separate; webhook secrets still use their own signature headers.

## Telegram transport

- `TELEGRAM_TRANSPORT` controls inbound Telegram delivery.
- The default is `webhook`; set it to `polling` for local or single-instance long polling.
- Polling mode is single-consumer only, so run one scheduler instance per bot token.
- Keep `TELEGRAM_WEBHOOK_SECRET` configured when using webhook mode.

## Architecture

OpenClaw Mini uses a unified runtime architecture with three main components:

```text
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Next.js App   │  │  Runtime (Bun)  │  │   Dashboard     │
│   (API routes)  │  │  (Task/Trigger  │  │  (Next.js dev   │
│                 │  │   loops, WS)    │  │   server)       │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                     │
         └────────────────────┴─────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   SQLite + Files  │
                    │   (Memory, Tasks) │
                    └───────────────────┘
```

- **Next.js App**: HTTP API routes, webhook handlers, chat UI
- **Runtime**: In-process task dispatch, trigger scheduling, WebSocket server, channel adapters
- **Dashboard**: Optional separate dev server for agent management UI

All components share the same database and memory files. The runtime maintains persistent connections for Telegram, WhatsApp, and WebSocket clients.

## Event flow

Events flow through an in-memory event bus with optional WebSocket broadcasting:

```text
Runtime / Next.js
       │
       │ eventBus.emit()
       v
  eventBus routes ──> local listeners (hooks, subscriptions)
       │
       └─> WebSocket broadcast (dashboard clients)
```

- `eventBus.emit()` returns `Promise<void>` for async delivery confirmation
- Use `void eventBus.emit(...)` for fire-and-forget paths
- The WebSocket server runs in-process within the runtime

## Runtime provider configuration

Provider and model configuration now lives in `openclaw.json`.

- Default path: `~/.openclaw/openclaw.json`
- Override path: `OPENCLAW_CONFIG_PATH=/absolute/path/to/openclaw.json`
- Format: JSON5-compatible `openclaw.json` with `providers` and `agent` sections
- Secrets: use `${ENV_VAR}` in provider `apiKey` fields instead of hardcoding keys
- Reloads: config changes are watched and the provider registry reloads without restarting the app
- Required: the runtime fails fast with a helpful example if `openclaw.json` does not exist

A complete example is available at `examples/openclaw.json`:
```json
{
  "providers": {
    "openai": {
      "apiType": "openai-chat",
      "apiKey": "${OPENAI_API_KEY}"
    }
  },
  "agent": {
    "provider": "openai",
    "model": "gpt-4.1-mini"
  }
}
```

## More setup details

See `SETUP.md` for the full setup guide, sub-agent override behavior, troubleshooting, and background service instructions.
