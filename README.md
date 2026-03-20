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
3. Create your runtime config:
   - Copy `examples/openclaw.json` to `~/.openclaw/openclaw.json`
   - Or set `OPENCLAW_CONFIG_PATH` to a custom file location
4. Start the app:
   ```bash
   bun run dev
   ```

## Runtime provider configuration

Provider and model configuration now lives in `openclaw.json`.

- Default path: `~/.openclaw/openclaw.json`
- Override path: `OPENCLAW_CONFIG_PATH=/absolute/path/to/openclaw.json`
- Format: JSON5-compatible `openclaw.json` with `providers` and `agent` sections
- Secrets: use `${ENV_VAR}` in provider `apiKey` fields instead of hardcoding keys
- Reloads: config changes are watched and the provider registry reloads without restarting the app

A complete example is available at `examples/openclaw.json`.

## Deprecated environment fallback

If `openclaw.json` does not exist, OpenClaw Mini still falls back to the legacy environment-variable model configuration.

Deprecated compatibility variables:

- `AI_PROVIDER`
- `AI_MODEL`
- `AI_BASE_URL`
- `AI_FALLBACK_MODEL`

These still work, but they now log deprecation warnings and should be replaced with `openclaw.json`.

## More setup details

See `SETUP.md` for the full setup guide, sub-agent override behavior, troubleshooting, and background service instructions.
