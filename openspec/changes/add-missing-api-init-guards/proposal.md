## Why

Fourteen of 26 API routes lack the `withInit()` guard that ensures lazy initialization before processing requests. External-facing webhook endpoints (`/api/webhooks/[source]`, `/api/channels/telegram/webhook`) are especially vulnerable — they can receive requests at any time from external services, and on cold start they will crash trying to access uninitialized database connections, services, or adapters.

## What Changes

- Add `withInit()` wrapper to 12 routes that currently lack it and directly access database or initialized services
- Refactor 2 webhook routes (`/api/webhooks/[source]`, `/api/channels/telegram/webhook`) to use `withInit()` since they are external-facing and can arrive on cold start
- Add JSON response validation to routes that call `response.json()` without try/catch (trigger fire endpoints)
- Add input validation schemas to routes that accept unvalidated request bodies (trigger update, channel bindings)

## Capabilities

### New Capabilities
- `api-init-coverage`: All routes that access database or initialized services are protected by `withInit()`

### Modified Capabilities
- `service-auth`: Webhook and external-facing routes now require initialization before processing

## Impact

- 14 route files gain `withInit()` wrapping
- 2 route files gain input validation (trigger update, channel bindings POST)
- 2 route files gain JSON parse error handling (trigger fire endpoints)
- No public API contract changes; internal reliability only