# OpenClaw Dashboard

Standalone Next.js operator dashboard for OpenClaw Mini.

## Local development

```bash
NEXT_PUBLIC_OPENCLAW_API_URL=http://localhost:3000 \
NEXT_PUBLIC_OPENCLAW_WS_URL=http://localhost:3003 \
bun run dev
```

The dashboard requires explicit runtime endpoints and does not fall back to same-origin `/api` routes.
