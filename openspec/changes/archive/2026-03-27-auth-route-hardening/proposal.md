## Why

Critical API routes arecompletely unauthenticated, allowing arbitrary task injection, trigger manipulation, and channel binding changes. The `/api/input` endpoint accepts any input type (message, webhook, hook, a2a, heartbeat, cron) without auth, making it the most dangerous gap. Additionally, `/api/triggers` routes allow unauthenticated trigger CRUD, and `/api/channels/bindings` uses an inconsistent legacy auth pattern.

## What Changes

- **BREAKING**: `/api/input` now requires `requireInternalAuth` bearer token authentication
- **BREAKING**: `/api/triggers` and `/api/triggers/[id]` now require `requireInternalAuth` bearer token authentication
- **BREAKING**: `/api/channels/bindings` now requires `requireInternalAuth` (replaces inconsistent `validateApiKey` pattern)
- Update all trusted callers of `/api/input` to send bearer auth:
  - WhatsApp adapter (`whatsapp-adapter.ts`)
  - A2A tool (`tools.ts`)
  - Browser webchat (`chat/page.tsx`)
  - Dashboard send-message (`page.tsx`)

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `api-auth`: Extend requirements to cover `/api/input`, `/api/triggers/*`, and `/api/channels/bindings/*` routes

## Impact

**Routes affected:**
- `src/app/api/input/route.ts` - add auth check
- `src/app/api/triggers/route.ts` - add auth check (GET/POST)
- `src/app/api/triggers/[id]/route.ts` - add auth check (GET/PUT/DELETE)
- `src/app/api/channels/bindings/route.ts` - add auth check (GET/POST)
- `src/app/api/channels/bindings/[id]/route.ts` - replace `validateApiKey` with `requireInternalAuth`

**Callers requiring updates:**
- `src/lib/adapters/whatsapp-adapter.ts` - add bearer auth headers
- `src/lib/tools.ts` (A2A tool) - add bearer auth headers or use direct `inputManager` call
- `src/app/chat/page.tsx` - add bearer auth headers
- `src/app/page.tsx` - add bearer auth headers

**Tests to update:**
- `tests/api-auth-hardening.test.ts` - add test cases for new protected routes