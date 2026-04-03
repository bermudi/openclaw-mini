## Context

The `withInit()` wrapper from `src/lib/api/init-guard.ts` calls `ensureInitialized()` which performs the full lazy initialization chain (config, providers, database, adapters, workspace). Currently 14 of 26 routes use it. The remaining 12 include critical external-facing endpoints that can receive requests without any prior user interaction.

## Goals / Non-Goals

**Goals:**
- All routes that access the database or initialized services are protected by `withInit()`
- External webhook routes handle cold-start gracefully
- Routes that parse JSON handle malformed input without crashing

**Non-Goals:**
- Not changing the initialization chain itself
- Not adding per-route initialization (lazy init at app level is sufficient)
- Not changing the 503 response format

## Decisions

### 1. Wrap all database-accessing routes with `withInit()`

**Decision:** Every route that calls `db.*`, `sessionService.*`, `memoryService.*`, `auditService.*`, `taskQueue.*`, or `getTool()` gets wrapped with `withInit()`.

**Rationale:** The `withInit()` wrapper is already battle-tested and returns a clean 503 if initialization fails. This is the simplest, most consistent approach.

**Alternatives considered:**
- Per-route initialization calls → inconsistent, error-prone
- Global middleware → Next.js App Router doesn't support middleware for API routes in the same way

### 2. Add try/catch around JSON.parse in trigger fire endpoints

**Decision:** Wrap `JSON.parse(rawBody)` in try/catch and return 400 for malformed JSON.

**Rationale:** Malformed JSON from external callers should produce a clean 400, not a 500 with stack trace.

### 3. Add zod validation to trigger update and channel bindings

**Decision:** Define inline zod schemas for the request bodies of `PUT /api/triggers/[id]` and `POST /api/channels/bindings`.

**Rationale:** These endpoints currently pass raw request bodies directly to service methods. Zod validation provides a clear contract and rejects invalid input at the boundary.

## Risks / Trade-offs

- **[Risk]** Adding `withInit()` to routes that already work → **Mitigation**: `ensureInitialized()` is idempotent; if already initialized, it returns the cached result immediately. No performance impact on warm routes.
- **[Risk]** Zod validation is stricter than current behavior → **Mitigation**: Only rejects clearly invalid input (missing required fields, wrong types). Existing valid requests continue to work.
- **[Trade-off]** Inline zod schemas vs. shared schemas → inline is simpler for now; can extract to shared file if duplication grows