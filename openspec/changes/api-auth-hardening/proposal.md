## Why

Core administrative APIs and the WebSocket broadcast endpoint are currently unauthenticated. Any client with network access can create tasks, read sessions, inspect audit logs, and inject dashboard events. This blocks safe deployment outside fully trusted localhost scenarios.

## What Changes

- Add mandatory authentication for admin API routes (`/api/agents`, `/api/tasks`, `/api/sessions`, `/api/audit`, `/api/skills`, `/api/workspace`, `/api/tools`)
- Add authentication for service-to-service scheduler calls into Next.js APIs
- Add authentication for `POST /broadcast` on the WebSocket mini-service
- Add startup validation and explicit insecure-local override for development-only deployments
- Add audit/security logging for rejected authentication attempts

## Capabilities

### New Capabilities

- `api-auth`: shared authentication policy for internal/admin API routes
- `service-auth`: service-to-service authentication contract between scheduler and Next.js
- `ws-broadcast-auth`: authentication contract for WebSocket broadcast ingress

## Impact

- `src/app/api/**` protected routes
- `src/lib/*` auth middleware / shared verifier
- `mini-services/scheduler/index.ts` authenticated API requests
- `mini-services/openclaw-ws/index.ts` authenticated broadcast endpoint
- Runtime env/config docs and startup validation
