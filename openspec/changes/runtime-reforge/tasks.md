## 1. Baseline Hardening

- [ ] 1.1 Restore strict type-checking and remove build-time type suppression in the current runtime host.
- [ ] 1.2 Fix the surfaced type and build errors so the existing codebase is a trustworthy baseline before extraction.
- [ ] 1.3 Repair broken runtime scripts and identify the smallest current verification flow for the reset.

## 2. Standalone Runtime Scaffold

- [ ] 2.1 Create the standalone runtime package, entrypoint, and lifecycle bootstrap.
- [ ] 2.2 Move runtime startup, config loading, and core services into the runtime package.
- [ ] 2.3 Add runtime readiness and health reporting that no longer depends on Next.js lazy initialization.

## 3. In-Process Orchestration

- [ ] 3.1 Replace scheduler HTTP callback paths with in-process task dispatch and a reconciliation sweep.
- [ ] 3.2 Move realtime broadcasting into the runtime and remove backplane client and WS sidecar plumbing.
- [ ] 3.3 Centralize adapter startup, shutdown, and recovery in the runtime lifecycle manager.

## 4. Cleanup And Verification

- [ ] 4.1 Delete `mini-services/` ownership and remove Next-hosted runtime assumptions from the root package.
- [ ] 4.2 Update dev and test scripts to run the standalone runtime directly.
- [ ] 4.3 Run the relevant test suite and a local end-to-end runtime boot check to verify startup, dispatch, and shutdown behavior.
