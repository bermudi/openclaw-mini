## Context

OpenClaw runs as multiple processes:
- **Next.js app** (port 3000) — handles API, web UI, task execution
- **Scheduler service** (standalone) — processes heartbeats, crons, task queue
- **WebSocket service** (port 3003) — real-time event distribution to browsers

Currently, `eventBus` uses Node.js `EventEmitter` — in-process only. Events emitted from the scheduler never reach Next.js listeners. This breaks hook triggers which rely on `task:created` events to spawn reactive task chains.

The WebSocket service already provides cross-process event distribution via `POST /broadcast`. Browser clients subscribe via Socket.IO. We extend this pattern: Next.js becomes another subscriber.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Current State                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Next.js Process                    Scheduler Process                           │
│  ┌──────────────────────┐           ┌──────────────────────┐                   │
│  │ eventBus (EventEmtr) │           │ prisma.task.create() │                   │
│  │        ▲             │           │        │             │                   │
│  │        │             │           │        ▼             │                   │
│  │  hook-sub-mgr        │           │  ❌ NO EVENTS        │                   │
│  │  (listening)         │           │  ❌ NO WEBSOCKET     │                   │
│  └──────────────────────┘           │  ❌ NO AUDIT         │                   │
│                                     └──────────────────────┘                   │
│                                                                                 │
│  Events never cross process boundary                                            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Proposed State                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│                    ┌──────────────────────────┐                                  │
│                    │   WebSocket Service      │                                  │
│                    │   (port 3003)            │                                  │
│                    │                          │                                  │
│                    │  io.emit() ──────────────┼──▶ Browser Clients              │
│                    │  io.emit() ──────────────┼──▶ Next.js Backplane           │
│                    └───────────┬──────────────┘                                  │
│                                ▲                                                │
│              POST /broadcast   │                                                │
│                                │                                                │
│         ┌──────────────────────┴──────────────────────┐                        │
│         │                                              │                        │
│  Next.js Process                           Scheduler Process                    │
│  ┌──────────────────────┐                  ┌──────────────────────┐            │
│  │ backplane-client     │                  │ POST /api/tasks      │            │
│  │ (Socket.IO client)   │                  │ (calls taskQueue)    │            │
│  │        │             │                  └──────────────────────┘            │
│  │        ▼             │                         │                              │
│  │  eventBus.emit()─────┼─────────────────────────┘                              │
│  │  (forwards to WS)    │                                                        │
│  │        │             │                                                        │
│  │        ▼             │                                                        │
│  │  hook-sub-mgr        │  ◀── receives events from backplane                   │
│  └──────────────────────┘                                                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals:**
- Cross-process event distribution without new infrastructure
- Scheduler tasks get full side effects (WebSocket, audit, hooks)
- Hook triggers work regardless of which process creates the task
- Maintain typed event map for compile-time safety

**Non-Goals:**
- Redis or other message broker
- Event persistence/replay
- Distributed transactions
- Changing how browser clients subscribe (they already work)

## Decisions

### Decision 1: WebSocket service as message bus

**Choice:** Use existing `openclaw-ws` service as the cross-process event bus.

**Alternatives considered:**
- **Redis pub/sub** — more robust, but adds infrastructure dependency
- **HTTP callbacks from WS service** — tight coupling, WS service must know subscriber URLs
- **Database polling** — latency, polling overhead

**Rationale:** The WS service already exists, already receives events via `POST /broadcast`, already has room-based routing. Extending it to serve internal subscribers follows the same pattern as browser clients.

### Decision 2: Backplane client as Socket.IO client

**Choice:** Next.js process runs a Socket.IO client that connects to the WS service and forwards events to in-process listeners.

**Alternatives considered:**
- **Replace EventEmitter with direct WS subscription** — loses ability to have in-process listeners
- **Hybrid: EventEmitter for local, WS for remote** — two APIs, confusing

**Rationale:** Single `eventBus` API. Emit goes to WS service. Receive comes from backplane client. Listeners don't know or care about the transport.

### Decision 3: Scheduler calls Next.js API for task creation

**Choice:** Scheduler calls `POST /api/tasks` instead of direct Prisma write.

**Alternatives considered:**
- **Scheduler imports taskQueue** — works for WebSocket/audit, but eventBus still in-process
- **Scheduler emits via wsClient, creates task directly** — still bypasses hooks

**Rationale:** Single authoritative write path. All side effects (WebSocket, audit, event bus) fire correctly. The scheduler already calls Next.js API for task execution — this extends the pattern to creation.

### Decision 4: Async emit()

**Choice:** `eventBus.emit()` returns `Promise<void>` instead of `void`.

**Alternatives considered:**
- **Fire-and-forget emit** — caller doesn't know if broadcast failed
- **Sync emit with background queue** — complexity, ordering issues

**Rationale:** Honest API. Emitting now involves HTTP call. Callers can await or ignore. Breaking change but clean.

## Risks / Trade-offs

**[Risk] WebSocket service becomes single point of failure**
→ Mitigation: Backplane client reconnects automatically (Socket.IO built-in). Events emitted while disconnected are lost, but this is acceptable for reactive hooks — they're best-effort, not transactional.

**[Risk] Increased latency for event delivery**
→ Mitigation: Localhost HTTP calls are sub-millisecond. Socket.IO on localhost is similarly fast. Acceptable for hook triggers which are already async.

**[Risk] Breaking change: emit() becomes async**
→ Mitigation: TypeScript will flag callers that don't await. Most callers already don't wait for emit result. Audit call sites.

**[Risk] Duplicate event delivery during reconnect**
→ Mitigation: Socket.IO handles dedup on reconnect for real-time events. For hooks, idempotency is caller's responsibility (hooks should be idempotent anyway).

## Migration Plan

1. **Phase 1: Backplane client** — Add Socket.IO client to Next.js, subscribe to events, forward to EventEmitter (no behavior change yet)
2. **Phase 2: Rewrite eventBus** — `emit()` goes through `wsClient.broadcast()`, backplane client forwards to listeners
3. **Phase 3: Scheduler integration** — Scheduler calls `POST /api/tasks` instead of direct Prisma
4. **Phase 4: Remove direct Prisma** — Ensure no other code bypasses taskQueue

**Rollback:** Each phase is independently revertible. Phase 1 adds code without changing behavior. Phase 2 can be rolled back by reverting to EventEmitter. Phase 3 can be rolled back by reverting scheduler to direct Prisma.

## Open Questions

1. **Should backplane client filter events?** Currently receives all events. Could subscribe to specific rooms. But for simplicity, receive all and filter in-process.
2. **What happens if WS service is down at startup?** Backplane client should retry connect. Events emitted before connection are lost — acceptable.
3. **Should we add event acknowledgment?** Not for MVP. Hooks are fire-and-forget. If needed later, can add ack protocol.
