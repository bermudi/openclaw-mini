## Why

The runtime and the dashboard currently live in the same package, which makes the project look heavier than it is and keeps UI concerns entangled with agent execution. The dashboard should be an optional operator client, not the shell that defines the runtime architecture.

## What Changes

- Move the Next.js dashboard into its own package with its own dependency set and dev/build scripts.
- Make the dashboard consume the runtime over configured HTTP and realtime endpoints instead of same-origin in-process routes.
- Preserve the operator workflows for sessions, workspace editing, and realtime task visibility while removing runtime ownership from the dashboard.
- Remove root-level UI scaffolding and dependencies that no longer belong to the runtime package.
- **BREAKING** Remove the assumption that the dashboard and runtime share one package and one origin.

## Capabilities

### New Capabilities
- `dashboard-runtime-client`: A dedicated dashboard client layer for talking to the runtime over configured API and realtime endpoints.

### Modified Capabilities
- `dashboard-realtime`: Dashboard realtime updates connect directly to the runtime rather than a sibling sidecar process.
- `dashboard-sessions`: Session views fetch from the standalone runtime instead of same-origin routes inside the UI host.
- `dashboard-workspace`: Workspace browsing and editing continue to work when the dashboard runs as a separate package.

## Impact

- Affected code: `src/app/`, `src/components/`, `src/hooks/`, dashboard scripts, root `package.json`, runtime CORS and auth configuration.
- Affected systems: developer workflow, package boundaries, dashboard deployment shape, runtime/client connectivity.
- Dependencies: separates UI dependencies from runtime dependencies and reduces root-package sprawl.
