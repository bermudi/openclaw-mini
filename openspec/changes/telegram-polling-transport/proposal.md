## Why

Telegram inbound messaging is currently hard-wired to a public webhook route, which is awkward for local-first development and simple single-instance deployments. Telegram supports long polling as an alternative transport, but the runtime has no way to select it, and the current Telegram adapter lifecycle does not actually own inbound message flow.

## What Changes

- Add an explicit Telegram transport mode so inbound updates can use either `webhook` or `polling`.
- Update the Telegram adapter lifecycle so `start()` and `stop()` manage long polling when polling mode is enabled, while webhook mode remains stateless for inbound delivery.
- Extract shared Telegram update ingestion so webhook requests and polled updates normalize through the same parsing, attachment download, and `InputManager.processInput()` path.
- Ensure only one Telegram inbound transport is active at a time, including clearing any configured webhook before polling begins.
- Add transport-specific tests and setup guidance so local development can use polling without changing downstream task, session, or delivery behavior.

## Capabilities

### New Capabilities
- `telegram-polling-transport`: Select and run Telegram inbound delivery through long polling while preserving the existing task/session pipeline.

### Modified Capabilities
- `telegram-adapter`: Expand Telegram inbound behavior from webhook-only to transport-selectable webhook or polling operation.

## Impact

- Affected code: `src/lib/adapters/telegram-adapter.ts`, `src/app/api/channels/telegram/webhook/route.ts`, scheduler adapter lifecycle startup, and Telegram adapter tests.
- New code: shared Telegram update ingestion module and a new spec delta for polling transport behavior.
- Operational impact: Telegram deployments can choose between public webhook ingress and single-instance polling; polling mode must run only one consumer per bot token.
- External API impact: Telegram Bot API `deleteWebhook`/`getUpdates` semantics become part of adapter startup behavior in polling mode.
