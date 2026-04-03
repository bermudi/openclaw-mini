## 1. Persistence Boundary Safety

- [ ] 1.1 Define schemas for the highest-value structured persistence fields and document which fields are validated in this pass.
- [ ] 1.2 Enforce validation on write and read paths so malformed structured data fails loudly.
- [ ] 1.3 Update storage-facing tests to cover valid data, invalid data, and malformed legacy reads.

## 2. Memory Indexing Simplification

- [ ] 2.1 Make SQLite FTS the default memory indexing and retrieval path.
- [ ] 2.2 Remove fake embedding generation and keep vector retrieval only for real embedding providers.
- [ ] 2.3 Update indexing and recall tests for the new FTS-first behavior.

## 3. Mirror And Query Hardening

- [ ] 3.1 Move filesystem and git mirror work onto an asynchronous queue after canonical SQLite writes.
- [ ] 3.2 Add a flush hook or equivalent test helper for mirror work verification.
- [ ] 3.3 Add the missing indexes and highest-value query fixes that remain after the runtime reset.

## 4. Verification And Follow-Up

- [ ] 4.1 Run memory, indexing, and versioning tests against the simplified storage path.
- [ ] 4.2 Reassess whether an ORM replacement is still warranted after the simplified storage changes land.
