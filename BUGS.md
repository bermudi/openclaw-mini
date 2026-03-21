# OpenClaw-Mini Architectural Gaps

> Last updated: 2026-03-20

This document tracks architectural gaps, security issues, and missing infrastructure not covered by existing OpenSpec changes.

---

## Critical (Security)

### No API Authentication
All API routes are unauthenticated. Any client can:
- Read/write agents, sessions, tasks
- Access memory files
- Trigger webhooks
- Access audit logs

**Location**: `src/app/api/**`

### Webhook Signatures Not Enforced
`webhook-security.ts` exists but is never called from `input-manager.ts`. Anyone can send fake webhook events.

**Location**: `src/lib/services/input-manager.ts`, `src/lib/services/webhook-security.ts`

### No CORS Configuration
WebSocket service uses `origin: '*'` allowing any domain to connect.

**Location**: `mini-services/openclaw-ws/index.ts`

---

## Critical (Reliability)

### No Health Check Endpoint
Main app has no `/health` endpoint. Orchestrators (Docker/K8s) cannot verify app health.

**Location**: `src/app/` — missing entirely

### No Graceful Shutdown
Main app ignores SIGTERM/SIGINT. In-flight requests dropped on restart.

**Location**: Only `mini-services/scheduler/index.ts` has shutdown; main app does not

### No Request Timeouts
API routes and AI SDK calls have no timeout. Slow AI responses hang requests indefinitely.

**Location**: `src/app/api/**`, `src/lib/services/agent-executor.ts`

---

## High Priority

### No Rate Limiting
No protection against DoS attacks or resource exhaustion.

**Location**: All API routes

### No Input Validation
Webhook payloads passed through without schema validation. Malformed inputs can crash the system.

**Location**: `src/lib/services/input-manager.ts`

### No Circuit Breakers
Provider failures cascade immediately. 429/500 errors cause instant retries without backoff.

**Location**: `src/lib/services/model-provider.ts`

### In-Memory Processing Map
`TaskQueue.processing` Map is lost on restart. Tasks stuck in "processing" never recover.

**Location**: `src/lib/services/task-queue.ts`

### No Dead Letter Queue for Failed Deliveries
When `dispatchDelivery()` exhausts its 5 retries, the message is marked failed and that's it. The user never sees it. There's no:
- Alerting that delivery failed
- Admin UI to inspect failed messages
- Retry mechanism beyond the 5 attempts
- Archive of failed messages for manual replay

For a system whose entire job is "receive input, produce response, deliver it" — losing the response silently is a total failure mode.

**Location**: `src/lib/services/delivery-service.ts`

### No Idempotency Beyond Dedupe Key
The dedupe key is `task:{taskId}` — which prevents double delivery of the same task's response. But if the same input message is delivered twice (network retry, webhook replay), two different tasks get created. The dedupe key doesn't cover the input message itself.

**Location**: `src/lib/services/delivery-service.ts`

### WebSocket Has No Event Recovery Protocol
`ws-client.ts` enables Socket.IO auto-reconnect, but there's no spec for:
- Event sequence tracking or sequence numbers
- Replaying missed events after reconnection
- Persisting events server-side for retrieval
- A fallback channel when WebSocket fails

Events emitted during disconnection are simply lost.

**Location**: `mini-services/openclaw-ws/`, `src/lib/services/ws-client.ts`

---

## Medium Priority

### No Dead Letter Queue for Tasks
Failed tasks marked `failed` but not retained for analysis or manual retry.

**Location**: `src/lib/services/task-queue.ts`

### No Pagination
Session messages, audit logs, task lists return all results. Memory exhaustion on large datasets.

**Location**: `GET /api/sessions`, `GET /api/tasks`, `GET /api/audit`

### No Structured Logging
Logs are console.log without severity, timestamps, or correlation IDs. Hard to search/debug.

**Location**: Throughout codebase

### No Metrics/Tracing
No OpenTelemetry or similar. Cannot debug production issues.

**Location**: N/A — missing entirely

### Credentials in Plain Env Vars
No rotation, no encryption at rest, no audit trail for secret access.

**Location**: `src/lib/credentials.ts`, `src/lib/config/`

### No Backup/Restore
SQLite database has no backup mechanism. Data loss on corruption.

**Location**: N/A — missing entirely

### Audit Log Integrity
Audit logs can be deleted/modified. No tamper detection.

**Location**: `src/lib/services/audit-service.ts`

### No Input Sanitization
Raw user content passed to AI without sanitization.

**Location**: `src/lib/services/agent-executor.ts`

---

## Scalability

### SQLite Single-Writer
Write bottleneck under load. Only one write can happen at a time.

**Location**: `prisma/schema.prisma`

### Polling-Based Task Processing
Latency from poll interval (not event-driven).

**Location**: `mini-services/scheduler/`

---

## Covered by OpenSpec (Not Yet Implemented)

| Gap | OpenSpec Change |
|-----|-----------------|
| Event bus for internal hooks | `event-bus-hooks` |
| Sub-agent depth limits | `subagent-lifecycle` |
| Sub-agent timeout/cancellation | `subagent-lifecycle` |
| Orphan sub-agent cleanup | `subagent-lifecycle` |
| Memory git versioning | `memory-git-versioning` |
| Memory confidence scoring | `memory-quality-lifecycle` |

---

## Recommended New OpenSpecs

1. **api-authentication** — Add auth to all endpoints
2. **observability** — Structured logging + OpenTelemetry
3. **resilience** — Timeouts, rate limiting, circuit breakers
4. **graceful-shutdown** — Signal handlers for main app
