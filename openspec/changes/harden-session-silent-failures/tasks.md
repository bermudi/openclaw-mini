## 1. Add error signaling to appendToContext

- [x] 1.1 Replace `if (!session) return;` with `throw new Error("Session not found: ${sessionId}")`
- [x] 1.2 Replace `if (!rawAgent) return;` with `throw new Error("Agent not found for session ${sessionId}")`

## 2. Add input validation to session service methods

- [x] 2.1 Add validation to `getOrCreateSession`: throw if `agentId`, `sessionScope`, or `channelKey` is empty/whitespace
- [x] 2.2 Add validation to `appendToContext`: throw if `content` is empty
- [x] 2.3 Add validation to `appendToContext`: throw if `content` exceeds 100,000 characters
- [x] 2.4 Add validation to `compactSession`: throw if `retainCount` or `threshold` options are zero or negative

## 3. Add audit logging for compaction failures

- [x] 3.1 Add `auditService.log()` call when compaction LLM call fails (in catch block)
- [x] 3.2 Add `auditService.log()` call when compaction LLM returns empty response

## 4. Add audit logging for session lifecycle events

- [x] 4.1 Add `auditService.log()` call to `cleanupOldSessions` when sessions are deleted (include count and cutoff date)
- [x] 4.2 Add `auditService.log()` call to `deleteSession` when a session is deleted
- [x] 4.3 Add `console.warn()` to `getAsyncTaskRegistry` catch block when JSON parse fails

## 5. Update callers of appendToContext

- [x] 5.1 Find all callers of `appendToContext` and verify they handle thrown errors appropriately
- [x] 5.2 Update any callers that relied on silent return behavior

## 6. Verify and test

- [x] 6.1 Run existing tests to ensure no regressions
- [x] 6.2 Verify error messages are descriptive and actionable