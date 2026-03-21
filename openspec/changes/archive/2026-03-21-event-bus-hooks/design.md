## Context

OpenClaw-Mini defines Internal Hooks as a first-class trigger type in `TriggerType`, and `HookInput` exists in `src/lib/types.ts` with fields `event: string` and `data: Record<string, unknown>`. The `InputManager.processHook()` method at `src/lib/services/input-manager.ts` accepts a `HookInput` and creates a task — but nothing in the codebase ever calls it. The trigger service manages hook triggers alongside heartbeat, cron, and webhook triggers, and `TriggerConfig` already has `event?: string` and `condition?: Record<string, unknown>` fields — but hook triggers have no subscription mechanism.

The `AuditService` at `src/lib/services/audit-service.ts` logs lifecycle events (`task_started`, `task_completed`, `task_failed`, `memory_updated`) to the database, but it provides no pub/sub — it's write-only. The `TaskQueue` calls `broadcastTaskCreated/Started/Completed/Failed` for WebSocket events, but those go to browser clients via the WS service on port 3003, not to internal hook triggers. The `AgentExecutor` logs audit events but does not publish them for reactive consumption.

The scheduler calls `getDueTriggers()` on a polling interval for heartbeat and cron triggers, but hooks are event-driven by nature — they cannot be polled. Without an event bus, the entire "internal hooks" capability is dead code.

## Goals / Non-Goals

**Goals:**
- Typed in-process event bus that services can publish to and hook triggers can subscribe to
- System event emission from existing services (`TaskQueue`, `AgentExecutor`, `SessionService`, `MemoryService`) at key lifecycle points
- Hook trigger subscription: the scheduler subscribes enabled hook triggers to the event bus at startup, routing matching events to `inputManager.processHook()`
- Condition-based filtering on hook triggers using `config.condition` for shallow field equality on event data

**Non-Goals:**
- Distributed event bus or cross-process pub/sub (Redis, NATS, etc.)
- Event persistence or replay (events are ephemeral, fire-and-forget)
- External event sources (inbound events from third-party systems — that's what webhooks are for)
- Complex event matching (glob patterns, regex, CEL expressions)

## Decisions

### 1. Node.js EventEmitter-based singleton with typed event map

**Decision:** The event bus is a singleton wrapping Node.js `EventEmitter` with a TypeScript event map that defines the payload shape for each event type. It lives at `src/lib/services/event-bus.ts`.

**Alternatives considered:**
- *Redis pub/sub*: Adds an external dependency and infrastructure. Overkill for a single-process runtime that targets <100MB RAM.
- *RxJS*: Powerful but adds an unnecessary dependency and conceptual overhead. We don't need backpressure, operators, or observable composition.
- *Custom Map<string, Set<Function>>*: Would work but reinvents what `EventEmitter` already provides, including max listener management and error handling.

**Rationale:** Zero dependencies, in-process only, fits the "mini" philosophy. `EventEmitter` is battle-tested and every Node.js developer understands it. The typed wrapper provides compile-time safety without runtime cost.

### 2. Events are fire-and-forget

**Decision:** Listeners MUST NOT block the emitting service. The `emit()` method calls all listeners synchronously but catches errors per-listener. Errors in listeners are logged via the existing logger, never propagated to the emitter.

**Rationale:** The emitting service (e.g., `TaskQueue` marking a task complete) should never fail because a hook listener threw. The event bus is a notification mechanism, not a transaction participant.

### 3. Hook trigger matching uses exact event type plus shallow condition equality

**Decision:** A hook trigger's `config.event` field is matched via exact string equality against the emitted event type. If `config.condition` is set, each key-value pair must match the corresponding field in the event data (shallow equality using `===`).

**Alternatives considered:**
- *Glob patterns* (e.g., `task:*`): Adds complexity and ambiguity. Users can create multiple hook triggers for different event types.
- *JSONPath or deep equality*: Over-engineered for the current use case. Event payloads are flat objects.

**Rationale:** Simple and deterministic. A hook either matches or it doesn't — no surprises. Shallow equality is sufficient because event payloads contain primitive values (strings, numbers, booleans) at the top level.

### 4. Services emit events after DB commits

**Decision:** Services SHALL emit events only after the database operation has committed successfully. For example, `TaskQueue` emits `task:completed` after the Prisma `update()` call resolves, not inside a transaction callback.

**Rationale:** If a listener queries the database in response to an event, it must see the committed state. Emitting inside a transaction risks listeners seeing stale or uncommitted data, leading to subtle race conditions.

### 5. Scheduler subscribes hook triggers at startup and re-subscribes on changes

**Decision:** At startup, the scheduler queries all enabled hook triggers from the database and subscribes each one to the event bus via `eventBus.on(config.event, handler)`. The handler applies condition filtering and calls `inputManager.processHook()` on match. When a trigger is created, updated, or deleted at runtime (via the API), the scheduler unsubscribes the old listener (if any) and subscribes the new one.

**Rationale:** Hook triggers are stored in the database and managed via the trigger service API. The scheduler already manages heartbeat/cron triggers at startup — extending it to manage hook subscriptions keeps the responsibility in one place.

## Risks / Trade-offs

- **[In-process only]** Events are lost on crash — there is no replay or guaranteed delivery. → Acceptable for hook triggers. They are reactive automations, not mission-critical workflows. If the process crashes, the triggering event (e.g., task completion) is already persisted in the database and can be observed on restart if needed.
- **[Listener errors]** A misbehaving listener could throw repeatedly, filling logs with errors. → Mitigated by catch-and-log per listener. If a specific hook trigger's listener keeps failing, the audit trail makes it visible. Future work could add a circuit breaker or disable triggers after N consecutive failures.
- **[Memory]** Each hook trigger adds one listener to the event bus. Many hook triggers = many listeners. → Bounded by the number of triggers in the database. For a personal assistant runtime, this is tens of triggers, not thousands. Node.js `EventEmitter` handles hundreds of listeners without issue.
- **[Ordering]** Listeners for the same event type are called in subscription order. If a listener is slow (e.g., creates a task via `processHook` which hits the database), it blocks subsequent listeners for that event. → Acceptable because `processHook` is fast (it only creates a task in the queue, it doesn't execute the agent). If this becomes a problem, listeners could be made async with `queueMicrotask` or `setImmediate`.
