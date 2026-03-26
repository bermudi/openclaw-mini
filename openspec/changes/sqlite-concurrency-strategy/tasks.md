## 1. Write-Path Consolidation

- [ ] 1.1 Inventory all scheduler/mini-service write operations against SQLite
- [ ] 1.2 Move cross-process writes to authoritative Next.js API endpoints
- [ ] 1.3 Ensure no background service performs direct task lifecycle writes via Prisma

## 2. SQLite Contention Tuning

- [ ] 2.1 Apply `journal_mode=WAL` and `busy_timeout` at DB initialization
- [ ] 2.2 Add bounded retry/backoff for transient `SQLITE_BUSY` writes
- [ ] 2.3 Document expected behavior when retries are exhausted

## 3. Observability

- [ ] 3.1 Add lock contention logging with operation name and retry count
- [ ] 3.2 Add metrics/counters for `SQLITE_BUSY` frequency and retry success rate

## 4. Testing

- [ ] 4.1 Add integration test simulating concurrent scheduler/API writes and verify no lost updates
- [ ] 4.2 Add test for retry behavior on synthetic lock contention
- [ ] 4.3 Add regression test for single-writer flow through APIs
