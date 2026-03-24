## Context

OpenClaw Mini currently uses lazy initialization scattered across the codebase:
- `layout.tsx` calls `initializeProviderRegistry()` and `initializeWorkspace()` in a React server component
- `adapters/index.ts` is called from the Telegram webhook route
- `db.ts` creates Prisma client lazily on first import
- `provider-registry.ts` has `ensureProviderRegistryInitialized()` called from multiple services

This means errors surface during request handling, not at startup. Missing requirements cause 500 errors mid-conversation rather than clear pre-flight failures.

## Goals / Non-Goals

**Goals:**
- Fail fast at server startup if hard requirements aren't met
- Clear, actionable error messages when startup fails
- Distinguish between hard blockers (config, DB, providers) and soft warnings (optional adapters)
- Auto-create default agent if missing
- Single initialization entry point via Next.js instrumentation

**Non-Goals:**
- Health check endpoint (can be added later)
- Graceful degradation mode (system either starts fully or not at all)
- Build-time validation (can't validate env vars or DB at build)
- CLI `openclaw check` command (separate concern)

## Decisions

### D1: Use Next.js `instrumentation.ts` for startup validation

**Rationale:** The `register()` function runs once at server startup, before any requests are handled. This is the ideal place for validation that should block the entire server.

**Alternatives considered:**
- Middleware check: Adds latency to every request, race conditions on first request
- Custom server: More complex, loses Vercel compatibility
- Build-time validation: Can't validate env vars or DB connectivity

### D2: `process.exit(1)` on hard failures

**Rationale:** Container orchestrators (Docker, Kubernetes) interpret non-zero exit as failure and can restart or alert. This makes the system's state unambiguous.

**Alternatives considered:**
- Throw error and let Next.js handle: Next.js may catch and continue in degraded state
- Return error response: Server would still be "up" but broken

### D3: Separate hard vs soft requirements

**Hard requirements (block startup):**
1. Config file exists and is valid
2. All provider API key env refs resolve
3. Database is accessible and migrated
4. At least one provider configured

**Soft requirements (log warning, continue):**
1. Telegram adapter not configured
2. WhatsApp adapter not configured
3. Workspace directory doesn't exist (will be created)
4. No hook triggers configured

**Rationale:** Optional channels shouldn't block the core system. A user running locally without Telegram should still be able to use the web chat.

### D4: Auto-create default agent

**Rationale:** Zero-config friendliness. The system creates a default agent with sensible settings if none exists, rather than requiring a setup step.

**Implementation:** After DB validation passes, check if any agent with `isDefault=true` exists. If not, create one with ID `default`, name "Default Agent", using the provider/model from config.

### D5: Module structure

```
src/
├── instrumentation.ts          # Entry point, delegates to init
└── lib/
    └── init/
        ├── index.ts             # Main orchestration
        ├── checks/
        │   ├── config.ts        # Config file validation
        │   ├── providers.ts     # Provider key resolution
        │   ├── database.ts      # DB connection + migration check
        │   └── agent.ts         # Default agent ensure
        ├── format-error.ts      # Pretty error output
        └── types.ts             # CheckResult types
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Dev server loops on invalid config | Clear error output tells user what to fix; dev server restart is expected behavior |
| Can't expose errors via HTTP | Error is printed to console before exit; orchestrator logs capture it |
| Vercel/serverless may differ | `instrumentation.ts` is supported on Vercel; test on target platform |
| Prisma migration check is SQLite-specific | Use `PRAGMA integrity_check` for SQLite; extend for other DBs later |
| Multiple init calls in dev | Guard with `initialized` flag; idempotent checks |

## Migration Plan

1. Create `src/lib/init/` module with all checks
2. Create `src/instrumentation.ts` entry point
3. Remove initialization from `layout.tsx` (keep imports for other uses)
4. Remove lazy `ensureProviderRegistryInitialized()` calls (registry is now guaranteed ready)
5. Move adapter initialization to init module
6. Test with missing config, invalid config, missing DB, etc.

**Rollback:** Remove instrumentation.ts, restore layout.tsx initialization, restore lazy pattern.

## Open Questions

- None currently - design is complete based on exploration discussion.
