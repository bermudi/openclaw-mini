## 1. Write-Path Consolidation

- [x] 1.1 Inventory all scheduler/mini-service write operations against SQLite
- [x] 1.2 Move cross-process writes to authoritative Next.js API endpoints
- [x] 1.3 Ensure no background service performs direct task lifecycle writes via Prisma

## 2. SQLite Contention Tuning

- [x] 2.1 Apply `journal_mode=WAL` and `busy_timeout` at DB initialization
- [x] 2.2 Add bounded retry/backoff for transient `SQLITE_BUSY` writes
- [x] 2.3 Document expected behavior when retries are exhausted

## 3. Observability

- [x] 3.1 Add lock contention logging with operation name and retry count
- [x] 3.2 Add metrics/counters for `SQLITE_BUSY` frequency and retry success rate

## 4. Testing

- [x] 4.1 Add integration test simulating concurrent scheduler/API writes and verify no lost updates
- [x] 4.2 Add test for retry behavior on synthetic lock contention
- [x] 4.3 Add regression test for single-writer flow through APIs
