## Why

The scheduler service creates tasks via direct Prisma writes, bypassing `taskQueue.createTask()` and its side effects: WebSocket broadcasts, audit logs, and event bus emissions. While WebSocket and audit would work if the scheduler imported `taskQueue`, the event bus uses in-process `EventEmitter` — events emitted from the scheduler process never reach listeners in the Next.js process. This breaks hook triggers, which rely on `eventBus.emit('task:created', ...)` to fire reactive chains.

Now that OpenClaw runs as multiple processes (Next.js app, scheduler, WebSocket service), the event bus must support cross-process pub/sub without introducing new infrastructure dependencies.

## What Changes

- Replace in-process `EventEmitter` with WebSocket-based pub/sub using the existing `openclaw-ws` service
- All processes emit events via `POST /broadcast` to the WebSocket service (already works)
- Next.js process subscribes as a WebSocket client to receive events for hook processing
- Scheduler uses authenticated `taskQueue.createTask()` HTTP calls to Next.js API, ensuring all side effects fire
- **BREAKING**: `eventBus.emit()` becomes async (returns Promise) since it now makes HTTP call
- Add explicit observability for failed event broadcasts (structured logs and failure counters)

## Capabilities

### New Capabilities

- `backplane-client`: WebSocket client that runs in Next.js process, subscribes to events from the WebSocket service, and forwards them to in-process listeners (hook subscription manager, etc.)

### Modified Capabilities

- `event-bus`: Requirements change from in-process `EventEmitter` to cross-process WebSocket-based pub/sub. The `emit()` method becomes async. New requirement for subscriber connectivity (backplane client).

## Impact

- `src/lib/services/event-bus.ts` — rewrite to use WebSocket client for emission
- `src/lib/services/ws-client.ts` — add subscribe capability (currently publish-only)
- `src/lib/services/backplane-client.ts` — forward remote events via local-dispatch path (no re-broadcast loop)
- `src/lib/services/hook-subscription-manager.ts` — listen via backplane client instead of direct `eventBus.on()`
- `mini-services/scheduler/index.ts` — call Next.js API for task creation instead of direct Prisma
- `mini-services/openclaw-ws/index.ts` — may need internal subscriber room support
- `src/app/api/tasks/route.ts` — new authenticated endpoint for scheduler to create tasks with full side effects
