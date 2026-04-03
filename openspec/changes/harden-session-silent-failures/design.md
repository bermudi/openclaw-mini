## Context

The `SessionService` in `src/lib/services/session-service.ts` manages session lifecycle operations. Currently, `appendToContext` silently returns when a session or agent doesn't exist — this is data loss with no signal. Compaction failures only log to console. Session cleanup and deletion have no audit trail.

## Goals / Non-Goals

**Goals:**
- Replace silent failures with explicit error throwing
- Add audit logging for all session lifecycle events (compaction, cleanup, deletion)
- Add input validation at service boundaries

**Non-Goals:**
- Not changing the compaction algorithm itself
- Not adding retry logic to database operations
- Not changing the session data model

## Decisions

### 1. Throw errors instead of silent returns in `appendToContext`

**Decision:** When session or agent doesn't exist, throw a descriptive `Error` instead of silently returning.

**Rationale:** Silent data loss is worse than a visible error. Callers can catch and handle; silent drops cannot be detected. This is a breaking change but the previous behavior was a bug.

**Alternatives considered:**
- Return a result object with success/error → changes the API surface significantly
- Log and return → still silent from caller's perspective

### 2. Add audit logging for compaction failures

**Decision:** When compaction LLM call fails or returns empty, log an audit entry with severity `warning` in addition to the existing `console.warn`.

**Rationale:** Console warnings get lost in log noise. Audit entries are queryable and persistent.

### 3. Add audit logging for session cleanup and deletion

**Decision:** `cleanupOldSessions` and `deleteSession` emit audit entries with the count of sessions/messages affected.

**Rationale:** Data deletion should always be auditable.

### 4. Input validation via inline checks, not zod

**Decision:** Use simple inline validation (non-empty strings, reasonable length limits) rather than introducing zod schemas to the service layer.

**Rationale:** The service layer is internal; zod is better suited for API boundaries. Inline checks are lightweight and sufficient for catching programming errors.

## Risks / Trade-offs

- **[Risk]** Throwing in `appendToContext` breaks callers that relied on silent behavior → **Mitigation**: Search for all callers; update them to handle errors appropriately
- **[Risk]** Audit logging adds database writes to failure paths → **Mitigation**: Audit writes are fire-and-forget (not awaited); failure to log doesn't block the primary operation
- **[Trade-off]** Inline validation vs. zod → inline is simpler for internal service; API routes should still use zod at their boundaries