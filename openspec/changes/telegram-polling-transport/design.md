## Context

Telegram support currently splits inbound and outbound behavior awkwardly. Outbound delivery lives in `TelegramAdapter`, but inbound delivery is hard-coded in the Next.js webhook route at `/api/channels/telegram/webhook`. The adapter lifecycle exists mostly to satisfy the generic channel contract and does not actually own any long-lived Telegram connection or polling loop.

This becomes a real limitation for a local-first runtime. Telegram's Bot API supports two mutually exclusive update transports: webhook delivery and long polling via `getUpdates`. The current implementation only supports webhook mode, which requires a publicly reachable HTTPS endpoint and external webhook registration. That is heavier than necessary for single-instance local deployments, and it makes Telegram less ergonomic than other channels that can run without public ingress.

At the same time, the existing webhook route already contains the real Telegram-specific value: update parsing, `deliveryTarget` construction, attachment download, and conversion into the common `InputManager.processInput()` pipeline. If polling is added by building a second bespoke ingest path, Telegram behavior will drift between transports.

## Goals / Non-Goals

**Goals:**
- Support Telegram inbound updates via either webhook or long polling.
- Keep downstream task creation, session routing, delivery targets, and attachment handling identical across transports.
- Make transport selection explicit and simple, using the existing environment-variable style already used by the Telegram adapter.
- Reuse the scheduler-managed adapter lifecycle so polling starts and stops with the worker process.
- Respect Telegram's transport exclusivity rules by removing any configured webhook before polling begins.

**Non-Goals:**
- Replacing Telegram outbound delivery behavior.
- Adding multi-instance coordination for Telegram polling.
- Moving Telegram channel configuration into `openclaw.json`.
- Changing generic `InputManager` or task queue semantics.
- Adding dashboard UI for switching transport modes.

## Decisions

### 1. Transport selection is environment-based and defaults to webhook

**Decision:** Add `TELEGRAM_TRANSPORT` with accepted values `webhook` and `polling`. If unset, the system defaults to `webhook`.

**Alternatives considered:**
- Put transport choice into `openclaw.json`: more centralized, but heavier than the current Telegram setup and inconsistent with existing Telegram env-based configuration.
- Infer transport from presence of `TELEGRAM_WEBHOOK_SECRET` or a public URL: ambiguous and operationally surprising.

**Rationale:** Telegram is already configured via `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. An explicit env var is the smallest, clearest change and keeps local setup easy.

### 2. Webhook and polling share one Telegram ingest module

**Decision:** Extract the webhook route's Telegram update normalization into a shared module that accepts a raw Telegram update and a bot context for file download. Both the webhook route and the polling handler call this module.

**Alternatives considered:**
- Duplicate the webhook route logic inside the adapter polling path: fast to write, but guarantees transport drift.
- Route polled updates through internal HTTP to `/api/input`: preserves a single API boundary, but loses Telegram-specific parsing reuse and adds auth/config coupling for no real benefit.

**Rationale:** The real architectural seam is not HTTP versus polling. It is raw Telegram update versus normalized `MessageInput`. Sharing that seam keeps behavior identical for text, photos, documents, animations, sender metadata, and delivery target construction.

### 3. Polling runs inside the Telegram adapter lifecycle

**Decision:** In polling mode, `TelegramAdapter.start()` owns long polling startup and `stop()` owns shutdown. The scheduler remains the process that starts adapters and performs health recovery.

**Alternatives considered:**
- Start polling from a separate Telegram worker or scheduler loop: adds another service boundary and duplicates lifecycle management that already exists for adapters.
- Keep the adapter stateless and put polling inside the webhook route or Next.js app: wrong ownership model for a long-lived loop.

**Rationale:** The project already treats long-lived channels as adapter-managed resources, as shown by the WhatsApp adapter. Telegram polling fits that model cleanly.

### 4. Polling uses grammY's long-polling support, not a custom `getUpdates` loop

**Decision:** Use grammY's long-polling runtime in the adapter, with message handlers forwarding raw updates into the shared ingest module.

**Alternatives considered:**
- Manual `getUpdates` loop: gives low-level control over offsets, but recreates behavior grammY already implements and increases edge-case surface area.

**Rationale:** The codebase already depends on grammY for Telegram API access. Using its built-in polling support keeps the implementation smaller and easier to maintain.

### 5. Polling startup explicitly clears any webhook

**Decision:** On polling startup, the adapter calls Telegram's webhook removal API before requesting updates.

**Alternatives considered:**
- Assume operators deleted the webhook manually: fragile, easy to forget, and leads to confusing `getUpdates` failures.
- Fail startup if a webhook exists: safer, but less ergonomic than automatically switching the bot into the selected mode.

**Rationale:** Telegram's API treats webhook and polling as mutually exclusive. The runtime should enforce the selected transport rather than forcing users to remember an external cleanup step.

## Risks / Trade-offs

- **[Single-consumer polling]** Polling mode cannot safely run from multiple scheduler instances with the same bot token. → Mitigation: document polling as a single-instance mode and leave webhook as the scalable option.
- **[Transport drift]** Shared logic can still diverge if future Telegram features are added only in one entry point. → Mitigation: make the shared ingest module the only place that translates raw Telegram updates into internal message input.
- **[Startup side effect]** Automatically deleting a webhook is a strong action. → Mitigation: only do it in explicit polling mode and document rollback as switching transport back to webhook and re-registering the webhook URL.
- **[Process ownership]** If the scheduler is down, polling mode will not receive Telegram messages. → Mitigation: this matches the existing ownership model for long-lived adapters and should be called out in setup docs.
- **[Test complexity]** Polling introduces adapter lifecycle behavior that is harder to unit test than a plain HTTP route. → Mitigation: add focused adapter lifecycle tests and shared-ingest regression tests rather than broad end-to-end infrastructure tests.

## Migration Plan

1. Add `TELEGRAM_TRANSPORT=polling` in local or single-instance environments that want polling.
2. On scheduler startup, let the Telegram adapter remove any existing webhook and begin polling.
3. For rollback, set `TELEGRAM_TRANSPORT=webhook` (or unset it), stop the scheduler poller, and re-register the Telegram webhook URL through the existing deployment flow.
4. No database or persisted task/session migration is required because inbound normalization remains unchanged.

## Open Questions

- None for implementation. The main operational choice is which environments should default to polling versus explicitly opting in.
