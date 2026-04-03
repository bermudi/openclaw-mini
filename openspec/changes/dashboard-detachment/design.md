## Context

The current repository mixes runtime code and dashboard code inside one package. That makes it harder to understand which dependencies are actually required for the agent runtime and encourages same-origin assumptions that tie the dashboard to whatever currently hosts the runtime.

After the runtime reset, the dashboard should become a consumer of the runtime rather than part of the runtime's identity. There are no production compatibility constraints, so the dashboard can stop depending on the current package shape.

## Goals / Non-Goals

**Goals:**
- Move the dashboard into its own package with isolated UI dependencies and scripts.
- Introduce a dedicated client layer for runtime HTTP and realtime communication.
- Preserve operator workflows for sessions, workspace editing, and realtime status.
- Make the dashboard optional during runtime development and deployment.

**Non-Goals:**
- Redesigning the dashboard UX in this change.
- Forcing the runtime to preserve the current same-origin API layout.
- Replacing the dashboard framework.
- Bundling storage refactors into the dashboard split.

## Decisions

### Decision 1: Keep Next.js for the dashboard package

**Choice:** Keep the dashboard on Next.js, but move it into its own package.

**Rationale:** The problem is package coupling, not that Next.js is incapable of hosting an operator UI. Keeping the current UI stack reduces needless churn while still isolating runtime dependencies.

### Decision 2: Dedicated runtime client instead of implicit same-origin fetches

**Choice:** Add a dashboard client layer that knows the runtime base URL and realtime endpoint.

**Rationale:** The dashboard should be explicit about where it gets data from. A dedicated client also centralizes headers, error handling, and reconnect behavior.

**Alternatives considered:**
- Keep direct `fetch('/api/...')` calls everywhere: easy short term, but it preserves the old coupling.
- Proxy everything through Next server routes: workable, but it keeps the dashboard acting as an unnecessary middle tier.

### Decision 3: Dependency cleanup follows package separation

**Choice:** Delay most dependency pruning until the dashboard package exists.

**Rationale:** Once package ownership is real, dependency removal becomes obvious and low-risk instead of speculative.

### Decision 4: Runtime owns cross-origin policy, dashboard stays thin

**Choice:** Handle CORS and runtime-side auth allowances in the runtime, not via a dashboard-specific proxy layer.

**Rationale:** The dashboard is only one possible client. Runtime policy should live with the runtime.

## Risks / Trade-offs

- **[Risk] Dashboard split breaks local dev workflow temporarily** → Mitigation: add root scripts for combined and separate startup from the start.
- **[Risk] Runtime endpoint changes ripple into the UI** → Mitigation: funnel calls through one dashboard client module.
- **[Risk] Realtime reconnect behavior drifts during the split** → Mitigation: keep websocket behavior contract-driven in the dashboard specs.

## Migration Plan

1. Create the dashboard package and move existing UI assets into it.
2. Add a runtime client layer for HTTP and realtime endpoints.
3. Rewire dashboard data access through the client layer.
4. Add runtime CORS configuration needed for separate local origins.
5. Remove root-level UI ownership and then prune UI dependencies.

## Open Questions

- Should the dashboard talk to the runtime directly in production-like setups, or should an optional reverse proxy remain available for convenience?
- Should realtime stay on Socket.IO for the first split, or be revisited only after the runtime package is stable?
