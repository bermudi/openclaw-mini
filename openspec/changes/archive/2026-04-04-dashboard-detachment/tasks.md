## 1. Dashboard Package Split

- [x] 1.1 Create the standalone dashboard package and move the current UI app, components, hooks, and static assets into it.
- [x] 1.2 Add dashboard-local build, dev, and type-check configuration.
- [x] 1.3 Keep the existing operator screens working inside the new package before broader cleanup.

## 2. Runtime Client Integration

- [x] 2.1 Create a dashboard runtime client for configured HTTP and realtime endpoints.
- [x] 2.2 Rewire session, workspace, and realtime flows to use the runtime client instead of same-origin fetches.
- [x] 2.3 Add runtime-side CORS and connection settings needed for separate dashboard and runtime origins.

## 3. Root Cleanup And Verification

- [x] 3.1 Remove root-level UI ownership and move UI dependencies under the dashboard package.
- [x] 3.2 Add root scripts for running runtime only, dashboard only, and both together.
- [x] 3.3 Verify the separated dashboard against the runtime for sessions, workspace editing, and realtime updates.
