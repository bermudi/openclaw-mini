## 1. Persistence Boundary Safety

- [x] 1.1 Define schemas for the highest-value structured persistence fields and document which fields are validated in this pass.
- [x] 1.2 Enforce validation on write and read paths so malformed structured data fails loudly.
- [x] 1.3 Update storage-facing tests to cover valid data, invalid data, and malformed legacy reads.

## 2. Memory Indexing Simplification

- [x] 2.1 Make SQLite FTS the default memory indexing and retrieval path.
- [x] 2.2 Remove fake embedding generation and keep vector retrieval only for real embedding providers.
- [x] 2.3 Update indexing and recall tests for the new FTS-first behavior.

## 3. Mirror And Query Hardening

- [x] 3.1 Move filesystem and git mirror work onto an asynchronous queue after canonical SQLite writes.
- [x] 3.2 Add a flush hook or equivalent test helper for mirror work verification.
- [x] 3.3 Add the missing indexes and highest-value query fixes that remain after the runtime reset.

## 4. Verification And Follow-Up

- [x] 4.1 Run memory, indexing, and versioning tests against the simplified storage path.
- [x] 4.2 Reassess whether an ORM replacement is still warranted after the simplified storage changes land.
