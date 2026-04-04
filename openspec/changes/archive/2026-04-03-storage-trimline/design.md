## Context

Once the runtime is a single process, the main remaining storage problems are not deployment topology but complexity in the data path itself. The current design stores structured fields as raw JSON strings without consistent boundary validation, runs a memory indexing path that includes fake embeddings, and performs filesystem plus git mirror work synchronously on the canonical memory write path.

The project does not want a hosted dependency such as Convex, and there is no urgent need to swap databases. The next storage change should therefore simplify the local SQLite path and remove work that does not create real product value.

## Goals / Non-Goals

**Goals:**
- Keep SQLite as the authoritative local store.
- Validate structured persistence boundaries before data is written or returned.
- Make memory retrieval FTS-first by default and remove pseudo-semantic embedding behavior.
- Move filesystem and git mirroring off the hot write path while preserving inspectability and version history.
- Land high-value indexes and query fixes without a full ORM rewrite.

**Non-Goals:**
- Replacing SQLite with a hosted or server database.
- Adopting Convex or another external platform.
- Bundling a full ORM migration into this change.
- Redesigning the memory recall product behavior beyond simplifying the default indexing path.

## Decisions

### Decision 1: SQLite remains the source of truth

**Choice:** Treat SQLite as the canonical store and filesystem/git outputs as mirrors.

**Rationale:** The product is local-first and single-machine. Keeping one authoritative store simplifies failure handling and verification.

### Decision 2: Boundary validation over schema churn first

**Choice:** Add explicit validation around structured JSON fields before deciding whether to normalize or migrate the ORM.

**Rationale:** The immediate bug class is malformed or weakly-typed persisted data, not the existence of JSON itself. Boundary validation buys safety with less rewrite risk.

### Decision 3: FTS-first memory indexing

**Choice:** Use SQLite FTS as the default indexing and recall path. Generate vector data only when a real embedding provider is configured.

**Rationale:** Hash-based pseudo-embeddings add code and cost without improving recall quality. FTS provides a strong local default for the "mini" use case.

### Decision 4: Async mirror queue for files and git

**Choice:** Finish canonical memory writes first, then queue filesystem and git mirror work asynchronously.

**Rationale:** Mirror work is valuable for inspection and history, but it should not block the primary write path or make canonical writes fail after they have already committed.

### Decision 5: ORM choice is deferred

**Choice:** Keep the current data access layer for this change unless a concrete blocker appears during implementation.

**Rationale:** The project benefits more from a simpler storage path now than from combining simplification with a full ORM replacement.

## Risks / Trade-offs

- **[Risk] Async mirror writes create short-lived lag between SQLite and files/git** → Mitigation: document SQLite as authoritative and add a flush hook for tests.
- **[Risk] FTS-first default may reduce recall quality for users with real embeddings configured** → Mitigation: keep vector retrieval available when a real embedding provider is configured.
- **[Risk] Boundary validation exposes legacy malformed rows** → Mitigation: fail loudly at the boundary and add targeted migration/repair utilities where needed.

## Migration Plan

1. Add validation for structured storage fields and update tests around malformed data.
2. Simplify memory indexing defaults to FTS-first and remove fake embedding behavior.
3. Queue filesystem and git mirror work asynchronously and add a test flush helper.
4. Add missing indexes and high-value query fixes.
5. Re-evaluate whether an ORM swap is still justified after the storage path is simpler.

## Open Questions

- Which persisted JSON fields deserve first-class schemas immediately, and which can remain loosely typed longer?
- Should async mirror work use a simple in-process queue or a persistent retry table for failed mirror writes?
