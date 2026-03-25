# OpenClaw-Mini — Architectural Design Review

## 1. STRUCTURAL COHERENCE

### 1.1 Three Processes, Two Databases, One Problem

The system runs three processes (`next dev`, `openclaw-ws`, `scheduler`), and the scheduler creates **its own `PrismaClient`** (`mini-services/scheduler/index.ts:11`) while the Next.js app uses its own singleton (`src/lib/db.ts`). These two clients point at the same SQLite database.

**SQLite does not support concurrent writers well.** You will get `SQLITE_BUSY` errors under even moderate load when the scheduler is polling/writing tasks while the Next.js API is also creating tasks. This is a ticking time bomb for any real usage beyond a demo.

### 1.2 The Scheduler Bypasses the Service Layer

The scheduler directly creates tasks via raw Prisma (`prisma.task.create` at `scheduler/index.ts:100`) while the Next.js app uses `taskQueue.createTask()` which fires event bus events, broadcasts WebSocket events, and logs audits. **The scheduler's tasks skip all of these side effects.** This means:

-   No `task:created` event bus emission → hook triggers won't fire
-   No WebSocket broadcast → the dashboard won't show these tasks appearing
-   No audit log → invisible actions

This is a classic consequence of duplicating write paths instead of routing through a single authoritative service.

### 1.3 Dual Event Systems With No Contract

You have **two completely separate event distribution systems**:

1.  **`EventBus`** — in-process `EventEmitter` (`event-bus.ts`)
2.  **WebSocket broadcast** via HTTP POST to the WS mini-service (`ws-client.ts`)

These are not synchronized. The EventBus only fires within the Next.js process. The scheduler runs in a separate process and never touches the EventBus. The WS service receives events via HTTP POST but has no EventBus of its own. **Hook subscriptions in `HookSubscriptionManager` listen on the EventBus — they will never fire for scheduler-originated events.**

### 1.4 Session Scope: The Hidden Single-Session Assumption

The schema has `@@unique([agentId, sessionScope])` on `Session`, and `InputManager.getOrCreateSession` always passes `'main'` as `sessionScope`. This means **every agent has exactly one session regardless of channel**. A Telegram user and a WhatsApp user talking to the same agent share the same session — seeing each other's conversation history. The AGENTS.md says "All communication channels must maintain the same session context" but this is an extremely surprising default with no escape hatch.

## 2. DECISION QUALITY

### 2.1 Next.js as an Agent Runtime — Cargo Cult

Next.js is a frontend framework optimized for SSR/SSG. Using it as the backbone of a **long-running, event-driven agent runtime** fights the framework at every turn:

-   Agent task execution is a long-running background process. Next.js API routes are designed for request/response, not background workers. That's why you needed the scheduler as a separate process.
-   The `instrumentation.ts` hook is the only way to run startup code, and it's fragile — Next.js can restart the runtime, clear module caches in dev mode, and doesn't guarantee single-instance execution in production.
-   The `processing` Map in `TaskQueueService` is **in-process state** that won't survive Next.js restarts or work correctly under standalone mode with multiple workers.

### 2.2 The Outbox Pattern Without the Guarantees

`OutboundDelivery` looks like a transactional outbox — good instinct. But `processPendingDeliveries` is called in the scheduler's `runDeliveryLoop` with a polling interval, and `enqueueDeliveryTx` correctly uses transactions. However:

-   The delivery loop runs sequentially (`for...of` in `processPendingDeliveries`) — a single slow adapter blocks all deliveries.
-   Deduplication relies on a `dedupeKey` unique constraint and swallows constraint errors silently (`delivery-service.ts:105`). This is correct for idempotency but means you can't distinguish "already sent" from "genuinely deduplicated" — making debugging delivery issues painful.

### 2.3 calculateNextCron is Broken

`InputManager.calculateNextCron` (`input-manager.ts:380`) ignores the cron expression entirely and adds 24 hours:

```typescript
// For MVP, just add 24 hours as a simple implementation
const next = new Date();
next.setDate(next.getDate() + 1);
```

Meanwhile, the scheduler's `getNextCronDate` actually tries to parse the expression but uses `node-cron`'s `parseExpression` which **doesn't exist** on `node-cron` (it exists on `cron-parser`, a different package). The type assertion at `scheduler/index.ts:160` masks this — it'll always fall back to "1 hour from now."

**Both cron paths are broken.** One lies about supporting cron, the other silently fails.

### 2.4 JSON-in-Columns Anti-Pattern

`Task.payload`, `Task.result`, `Trigger.config`, `Agent.skills`, `Session.context` — all are `String` columns holding JSON. Every read requires `JSON.parse`, every write requires `JSON.stringify`. The `mapTask` method parses payload and result on every single read (`task-queue.ts:356-357`). No validation happens on parse — a corrupted JSON string crashes the entire task processing pipeline.

## 3. FRICTION POINTS

### 3.1 Agent Status Stuck in busy or error

`AgentExecutorService.executeTask` sets agent status to `'busy'` at line 100 and only resets it to `'idle'` in `runPostCommitSideEffects`. If any exception occurs **after** setting busy but **before** reaching the catch block's `setAgentStatus(error)` — or if the process crashes mid-execution — the agent is permanently stuck. The scheduler checks for `status: 'idle'` agents, so a stuck agent stops processing forever.

There is a `sweepOrphanedSubagents` method, but it only handles subagent tasks, not the agent's `status` field itself.

### 3.2 failChildTasks Called Twice

In the error handler (`agent-executor.ts:378-379`):

```typescript
await taskQueue.failTask(taskId, errorMessage);
await taskQueue.failChildTasks(taskId, 'Parent task failed');
```

But `failTaskTx` already calls `failChildTasks` internally (`task-queue.ts:213`). The second explicit call is redundant — it re-queries children and finds none (they're already failed). Harmless now, but if `failChildTasks` ever has side effects, this double-fire will be a bug factory.

### 3.3 The processing Map Is Not Durable

`TaskQueueService.processing` (`task-queue.ts:35`) is an in-memory `Map<string, boolean>` that prevents concurrent task execution per agent. If the Next.js process restarts:

-   The map is wiped
-   An agent with a still-processing task in the DB will start another task concurrently
-   Two `generateText` calls will run simultaneously for the same agent with the same session, producing interleaved responses

### 3.4 Debugging Memory Recall Will Be Brutal

The memory system has 6 models (`Memory`, `MemoryChunk`, `MemoryIndexState`, `EmbeddingCache`, `MemoryIndexMetadata`, `MemoryRecallLog`) and the retrieval path flows through `memory-service.ts` → `memory-indexing.ts` → `memory-reflector.ts` with hybrid vector/keyword search. When the agent gives a bad response because it recalled the wrong memories, tracing *why* those specific chunks were selected requires cross-referencing `MemoryRecallLog.selectedKeys`, the chunk embeddings, the similarity scores, and the budget-trimming logic in `buildMemorySections`. None of this is exposed in the UI or easily queryable.

### 3.5 tools.ts Is a 1600-Line God File

All tool registrations, the `AsyncLocalStorage` context, tool filtering logic, and all tool implementations live in a single file. Adding a new tool means editing a 1600-line file. The file mixes registry infrastructure with business logic (executing shell commands, spawning subagents, managing browser sessions, file operations). This will be the #1 merge conflict hotspot.

## 4. SECURITY

### 4.1 No Authentication on Admin API Routes

The finder confirmed: `/api/agents`, `/api/tasks`, `/api/sessions`, `/api/audit`, `/api/skills`, `/api/workspace`, `/api/tools` — **zero authentication**. Anyone with network access can:

-   Create/delete/modify agents
-   Read all session history (including user messages)
-   Read audit logs
-   Execute tasks
-   Access workspace files

Only `/api/channels/bindings` has an API key check, and webhooks verify signatures. Everything else is wide open.

### 4.2 The WebSocket Service Has No Auth

`mini-services/openclaw-ws/index.ts` — CORS is `origin: '*'`, the `/broadcast` HTTP endpoint has no authentication. Any process on the network can inject arbitrary events into the WebSocket stream. A malicious actor could broadcast fake `task:completed` events with crafted results to the dashboard.

### 4.3 The Scheduler → Next.js API Call Is Unauthenticated

`scheduler/index.ts:57`:

```typescript
const response = await fetch(`http://localhost:3000/api/tasks/${task.id}/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
```

No API key, no auth token. If/when you add auth to the task execution endpoint, the scheduler will break.

### 4.4 Exec Runtime — Host Tier Default

`runtime.ts:133`: `defaultTier: 'host'`. When exec is enabled, agents execute shell commands **directly on the host by default**. The allowlist mechanism exists but is empty by default. An agent with the `exec` tool can run arbitrary commands on the host machine unless explicitly restricted.

## 5. CODE-LEVEL CONCERNS

### 5.1 Pervasive as Type Assertions on Payloads

Throughout `agent-executor.ts`, task payloads are cast with `as`:

```typescript
const msgPayload = task.payload as { content?: string; sender?: string; ... };
```

This is repeated ~10 times with different shape assumptions. The `Task.payload` is `Record<string, unknown>` — none of these casts are validated. A webhook trigger producing a payload with a different shape will silently produce `undefined` values, not an error.

### 5.2 Fire-and-Forget WebSocket Broadcasts

Every `broadcastTaskCreated`, `broadcastTaskStarted`, etc. returns a `Promise<boolean>` that is **never awaited** at the call sites in `task-queue.ts`. The `fetch` to the WS service silently fails on network errors (`ws-client.ts:36`). During a WS outage, you'll have zero indication that the dashboard is stale.

### 5.3 Module Singletons Everywhere

`agentExecutor`, `taskQueue`, `sessionService`, `memoryService`, `eventBus`, `inputManager`, `hookSubscriptionManager`, `processSupervisor`, `mcpService`, `browserService` — all are module-level singletons via `export const foo = new FooService()`. This makes:

-   Testing require carefully ordered imports and mock resets
-   Dependency injection impossible without major refactoring
-   Circular dependency potential high (e.g., `tools.ts` imports from `task-queue`, `session-service`, `memory-service`, `exec-runtime`, `process-supervisor`, `search-service`, `browser-service`, `mcp-service`)

---

## Summary: The Three Things That Will Hurt Most

1.  **SQLite concurrent access from three processes** will produce `SQLITE_BUSY` errors in production. You either need to collapse into a single process or move to PostgreSQL.

2.  **Zero authentication on the entire API surface** means this cannot be deployed on any network you don't fully trust — not even a home network with other devices.

3.  **The scheduler bypassing the service layer** means half the system's events (audit, WebSocket, hooks) won't fire for scheduled/triggered tasks, creating ghost behavior that's invisible to monitoring and debugging.