## Why

After the runtime is reduced to a single process, the next bottleneck is storage complexity: JSON strings without boundary validation, a memory indexing path that does more work than it proves value for, and synchronous mirror writes on the hot path. This change simplifies storage without adding a hosted dependency or forcing a premature data-platform rewrite.

## What Changes

- Keep SQLite as the local source of truth and simplify the storage layer around that assumption.
- Make memory retrieval FTS-first by default and remove fake embedding behavior that creates cost without semantic value.
- Move filesystem and git mirroring off the canonical write path while preserving local inspectability and version history.
- Add focused storage hardening: missing indexes, high-value query fixes, and input validation at persistence boundaries.
- Defer any ORM replacement decision until after the simplified runtime is stable.

## Capabilities

### New Capabilities
- `storage-boundary-validation`: Validated persistence boundaries for structured JSON payloads and other non-scalar storage fields.

### Modified Capabilities
- `memory-indexing`: Indexing becomes FTS-first by default and stops pretending hash-based vectors are semantically useful.
- `memory-versioning`: Git mirroring remains available but no longer blocks canonical memory writes.
- `storage-concurrency`: Post-runtime storage rules focus on one authoritative runtime process and simpler write-path guarantees.

## Impact

- Affected code: memory services, indexing services, storage helpers, database access layer, tests covering recall and memory versioning.
- Affected systems: SQLite schema/indexes, memory recall performance, filesystem/git mirroring semantics, persistence validation.
- Dependencies: intentionally avoids a hosted backend and treats any ORM swap as a separate later decision.
