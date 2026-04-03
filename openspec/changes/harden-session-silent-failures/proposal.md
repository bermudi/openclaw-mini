## Why

The session service silently drops messages when sessions or agents don't exist, compaction failures only emit `console.warn` with no audit trail, session cleanup deletes data without logging, and several service methods accept unvalidated input. These silent failures make it impossible to detect data loss or diagnose production issues.

## What Changes

- Replace silent returns in `appendToContext` with thrown errors when session or agent doesn't exist
- Add input validation to `getOrCreateSession`, `appendToContext`, and `compactSession` parameters
- Add structured audit logging for compaction failures (not just successes)
- Add audit logging to `cleanupOldSessions` and `deleteSession`
- Log a warning when `getAsyncTaskRegistry` encounters corrupted JSON (currently silent)
- Add content size limit validation to `appendToContext` to prevent storing pathological messages

## Capabilities

### New Capabilities
- `session-error-signaling`: Proper error throwing for missing sessions/agents instead of silent returns
- `session-audit-trail`: Audit logging for compaction failures, session cleanup, and session deletion
- `session-input-validation`: Input validation for session service method parameters

### Modified Capabilities
- `session-compaction`: Compaction failures now emit audit log entries in addition to console warnings

## Impact

- `src/lib/services/session-service.ts`: Error signaling, input validation, audit logging additions
- Callers of `appendToContext` must now handle potential thrown errors (breaking change for silent behavior)
- No database schema changes