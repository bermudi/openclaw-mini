## What's Still Broken

### 1. Auth Gaps on Critical Routes

Three routes remain **completely unauthenticated**:

-   **`/api/input`** — This is the main entry point for injecting messages, webhooks, hooks, and a2a events into the system. Anyone can send arbitrary tasks to any agent. This is arguably the most dangerous route to leave open.
-   **`/api/triggers` (GET and POST)** — Anyone can create heartbeat/cron triggers for any agent, or enumerate all existing triggers.
-   **`/api/triggers/[id]` (PATCH/DELETE)** — Anyone can modify or delete triggers.

`/api/channels/bindings` still uses a legacy `validateApiKey` pattern instead of `requireInternalAuth`. The WhatsApp QR route is also unprotected, though that's lower risk.

### 2. calculateNextCron Is Still Broken

`InputManager.calculateNextCron` (`input-manager.ts:380`) still ignores the cron expression and adds 24 hours:

```typescript
// For MVP, just add 24 hours as a simple implementation
const next = new Date();
next.setDate(next.getDate() + 1);
```

The scheduler's `getNextCronDate` still calls `(cron as CronExpressionParser).parseExpression?.()` which doesn't exist on `node-cron`. You have two code paths that both lie about supporting cron expressions. A user configuring a "every 5 minutes" cron will get "once a day" or "once an hour" behavior with zero feedback.

### 3. Session Scope — Still Single-Session-Per-Agent

The unique constraint `@@unique([agentId, sessionScope])` is unchanged. `InputManager` still hardcodes `'main'` as `sessionScope`. Multi-channel session isolation is still impossible — all channels merge into one session per agent. This is a design choice that should at least be documented if intentional.

### 4. Agent Status Not Reset on Error Path

In `agent-executor.ts:376-404`, after `failTask` the code doesn't reset agent status directly — it relies on `failTaskSideEffects` (called inside `failTask`) which sets status to `'error'`. But look at the flow:

```
taskQueue.startTask(taskId)  → sets agent to 'busy' (in the transaction)
...
// exception thrown
taskQueue.failTask(taskId, errorMessage) → calls failTaskSideEffects → sets agent to 'error'
```

The agent goes `idle → busy → error`. It never returns to `idle`. The `sweepStaleBusyAgents` only sweeps agents in `busy` status. An agent in `error` status stays there **forever** unless something else clears it. The scheduler only picks up agents with `status: 'idle'`. So a single transient LLM error (rate limit, timeout) permanently disables task processing for that agent until manual intervention.

### 5. Scheduler Still Owns Its Own Prisma Client

`scheduler/index.ts:27-58` creates its own `PrismaClient` via `createConfiguredPrismaClient`. While you've added WAL mode, busy\_timeout, and retry logic (good), the scheduler still reads directly from the database for `processPendingTasks` and `processDueTriggers` — querying `agent.findMany` and `trigger.findMany` with Prisma. Only the *write* operations (task creation, trigger updates) go through the API now.

This means the scheduler reads can race with API writes. A trigger's `nextTrigger` could be updated by the API while the scheduler is mid-loop iterating `dueTriggers`, potentially firing a trigger twice. The WAL mode helps with `SQLITE_BUSY` but doesn't prevent this read/write race.

### 6. tools.ts Remains a 1600-Line God File

No structural change here. Every tool implementation, the registry, the `AsyncLocalStorage` context — all still in one file. This will continue to be the merge conflict hotspot.

### 7. Payload Type Safety — Still Absent

Throughout `agent-executor.ts`, payloads are still cast with bare `as`:

```typescript
const msgPayload = task.payload as { content?: string; sender?: string; ... };
```

And in `renderTaskPrompt`, `buildRecallQuery` — same pattern ~15 times. No Zod validation, no runtime checks. A malformed payload from `/api/input` (which has no auth, remember) can inject arbitrary shapes.

### 8. Socket.IO subscribe:* Events — No Auth

While the `/broadcast` HTTP endpoint now requires a bearer token, the Socket.IO connection and room subscription events (`subscribe:agent`, `subscribe:all`, `subscribe:internal`) have **zero authentication**. Any browser client can connect to the WS port and subscribe to the `internal` room or any agent's events, receiving all task data, tool call results, and memory updates in real time.

---

## Summary: Remaining Priority Issues

| # | Issue | Severity |
| --- | --- | --- |
| 1 | `/api/input` has no auth — arbitrary task injection | **Critical** |
| 2 | Agent stuck in `error` status forever after any failure | **High** |
| 3 | `/api/triggers` has no auth — trigger creation/enumeration | **High** |
| 4 | Socket.IO subscriptions unauthenticated | **Medium** |
| 5 | Cron scheduling is completely non-functional | **Medium** |
| 6 | Scheduler reads can race with API writes on triggers | **Medium** |
| 7 | Payload `as` casts with no validation on unauthed input path | **Medium** |

The auth infrastructure is solid — the problem is just incomplete coverage on the remaining routes, particularly the most sensitive one (`/api/input`). The `error` status death spiral is the other high-priority fix — a single 429 from an LLM provider will brick an agent until someone manually resets it via the API.