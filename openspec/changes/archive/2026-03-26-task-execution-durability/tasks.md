## 1. Durable Claiming

- [x] 1.1 Replace in-memory per-agent processing map as source of truth
- [x] 1.2 Introduce DB-backed task claim transition (`pending` -> `processing`) with atomic guard
- [x] 1.3 Ensure only one runnable task per agent is claimed at a time

## 2. Agent Status Recovery

- [x] 2.1 Add scheduler sweep for stale `busy` agents with no active processing task
- [x] 2.2 Reset recoverable stale agents to `idle`
- [x] 2.3 Mark unrecoverable stuck cases as `error` with audit trail

## 3. Failure Propagation Hygiene

- [x] 3.1 Ensure child-task failure propagation is invoked exactly once per parent failure
- [x] 3.2 Add idempotency guard for parent-failure cascade

## 4. Testing

- [x] 4.1 Add concurrency test proving no duplicate execution after process restart
- [x] 4.2 Add recovery test for stale `busy` agent reset
- [x] 4.3 Add regression test for single child-failure propagation path
