## Why

The exec-runtime-overhaul design introduces a pluggable isolation backend architecture with Landlock, Firejail, Docker, and Podman implementations. Without a formal interface contract, each backend evolves independently, making capability detection ad-hoc, error handling inconsistent, and testing fragile. Extracting a typed `IsolationBackend` interface enables backend implementations to be tested in isolation, enables runtime capability reporting, and establishes clear contracts for launch, mount validation, and cleanup.

## What Changes

- Introduce `IsolationBackend` as a typed interface contract with mandatory and optional operations
- Define `BackendCapabilities` for runtime capability detection and reporting
- Standardize backend lifecycle: `detect()` → `validate()` → `launch()` → `cleanup()`
- Define `SecurityProfile` enum with `sandbox` and `isolated` variants that map to backend-specific constraints
- Establish mount validation protocol: backends validate alias-based mounts against their constraint models
- Add graceful degradation strategy: when a backend is unavailable, the system surfaces a actionable error rather than silently falling through
- Create `exec-isolation-backend` spec documenting the interface and all implementations

## Capabilities

### New Capabilities
- `exec-isolation-backend`: Typed interface contract for isolation backends (Landlock, Firejail, Docker, Podman, none). Defines mandatory operations (`launch`, `cleanup`, `detectCapabilities`), optional operations, mount validation protocol, and security profile mapping. Creates `specs/exec-isolation-backend/spec.md`.

### Modified Capabilities
- `exec-isolation`: Add requirement that tier resolution delegates to backend interface. Backend selection algorithm moves into this spec. Add requirement that `isolated` tier MUST NOT silently degrade to `direct`.

## Impact

- Affects `src/runtime/exec/` where backend implementations live
- Affects `runtime-config` spec to add backend preference ordering and capability reporting
- New spec `exec-isolation-backend` provides a testable contract for each backend implementation
- Enables unit testing of backend selection logic without spawning actual processes
