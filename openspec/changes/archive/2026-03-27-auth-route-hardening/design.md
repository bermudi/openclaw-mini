## Context

OpenClaw-Mini has an established authentication pattern using `requireInternalAuth` from `src/lib/api-auth.ts`. This helper validates bearer tokens via `verifyInternalBearerToken`, logs failures to audit, and supports a development bypass via `OPENCLAW_ALLOW_INSECURE_LOCAL`.

Currently, several critical routes bypass this pattern:
- `/api/input` - no auth at all
- `/api/triggers` (GET/POST) - no auth at all
- `/api/triggers/[id]` (GET/PUT/DELETE) - no auth at all
- `/api/channels/bindings/[id]` (DELETE) - uses inline`validateApiKey` instead of the shared helper
- `/api/channels/bindings` (GET/POST) - no auth at all

The system is designed as a **private control plane with explicit public ingress endpoints**. Webhook routes (`/api/webhooks/[source]`, `/api/channels/telegram/webhook`) correctly use per-trigger signature verification instead of bearer auth.

## Goals / Non-Goals

**Goals:**
- Close authentication gaps on control-plane routes
- Standardize on `requireInternalAuth` across all protected routes
- Update trusted callers to send bearer tokens
- Maintain development ergonomics via `OPENCLAW_ALLOW_INSECURE_LOCAL`

**Non-Goals:**
- Multi-tenant RBAC or role-based permissions
- Public webchat authentication (requires separate design for session-based auth)
- Service mesh or mTLS
- Rate limiting

## Decisions

### D1: Use `requireInternalAuth` for all control-plane routes

**Rationale:** The helper already provides:
- Timing-safe token comparison
- Audit logging of failures with route and source IP context
- Consistent error responses
- `OPENCLAW_ALLOW_INSECURE_LOCAL` bypass for local development

**Alternatives considered:**
- Keep `validateApiKey` pattern: rejected - inconsistent, doesn't log failures
- Add new auth middleware: rejected - unnecessary complexity, existing helper works

### D2: In-process callers should use `inputManager` directly

**Rationale:** The A2A tool (`tools.ts`) currently calls `/api/input` via HTTP, but it's in the same process. Using `inputManager.processInput()` directly avoids:
- HTTP overhead
- Need for bearer token management in-process
- Self-referential auth complexity

**Alternatives considered:**
- Add bearer auth to A2A HTTP call: works but wasteful

### D3: Cross-process callers need bearer tokens

WhatsApp adapter runs in a separate process and must call `/api/input`. It should use `buildInternalAuthHeaders()` to include the bearer token.

Browser clients (webchat, dashboard) should only run in:
1. `OPENCLAW_ALLOW_INSECURE_LOCAL=true` mode for local development
2. Behind an authenticating reverse proxy for production

### D4: Channel bindings routes use same auth as other admin routes

The inconsistency between `bindings` (unprotected) and `bindings/[id]` (protected with legacy pattern) is a security gap. Both need `requireInternalAuth`.

## Risks / Trade-offs

**Breaking existing callers:**
- WhatsApp adapter will need code changes
- A2A tool needs refactor to direct call
- Browserclients need environment awareness
→ Mitigation: Update all callers in this change, add tests

**Public webchat not addressed:**
- Current `/api/input` allows browser-to-agent chat
- Locking it down breaks public-facing deployments
→ Mitigation: Document that public webchat requires reverse proxy auth or `OPENCLAW_ALLOW_INSECURE_LOCAL`. Future change for session-based browser auth.

**Timing:**
- Any external scripts calling `/api/input` or `/api/triggers` will break
→ Mitigation: This is intentional security hardening; external integrations should use webhook routes with signature verification

## Migration Plan

1. Add `requireInternalAuth` to all affected routes
2. Update WhatsApp adapter to use`buildInternalAuthHeaders()`
3. Refactor A2A tool to call `inputManager.processInput()` directly
4. Update browser clients to handle auth (or rely on insecure-local mode)
5. Add tests for new protected routes
6. Update documentation

**Rollback:** Revert commits; routes return to unauthenticated state.

## Open Questions

(none addressed in this change)