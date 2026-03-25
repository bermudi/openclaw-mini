# exec-isolation-backend Specification

## Purpose

Defines a typed interface contract (`IsolationBackend<T>`) for isolation backends used by `sandbox` and `isolated` execution tiers. Establishes mandatory and optional operations, capability detection, mount validation protocol, and security profile mapping. Implementations include Landlock, Firejail, Docker, Podman, and `none` (direct execution).

## Requirements

### Requirement: IsolationBackend interface contract
All isolation backends SHALL implement the `IsolationBackend` interface with mandatory and optional operations.

#### Scenario: Backend implements mandatory operations
- **WHEN** a backend is registered in the runtime
- **THEN** it SHALL implement `id`, `launch()`, `cleanup()`, and `detectCapabilities()`

#### Scenario: Backend implements optional operations
- **WHEN** a backend implements `validateMounts()`
- **THEN** the runtime SHALL call it before launch to validate mount constraints
- **WHEN** a backend implements `getSecurityConstraints()`
- **THEN** the runtime SHALL call it to retrieve profile-specific constraints

### Requirement: Backend identifier
Each backend SHALL expose a unique `BackendId` identifying its type.

#### Scenario: Landlock backend identifier
- **WHEN** Landlock backend is instantiated
- **THEN** `backend.id` SHALL equal `'landlock'`

#### Scenario: Firejail backend identifier
- **WHEN** Firejail backend is instantiated
- **THEN** `backend.id` SHALL equal `'firejail'`

#### Scenario: Docker backend identifier
- **WHEN** Docker backend is instantiated
- **THEN** `backend.id` SHALL equal `'docker'`

#### Scenario: Podman backend identifier
- **WHEN** Podman backend is instantiated
- **THEN** `backend.id` SHALL equal `'podman'`

#### Scenario: None backend identifier
- **WHEN** None backend is instantiated
- **THEN** `backend.id` SHALL equal `'none'`

### Requirement: Launch operation
The `launch()` method SHALL spawn a command with the given configuration and return a `LaunchResult`.

#### Scenario: Successful launch
- **WHEN** `backend.launch(cfg)` is called with valid configuration
- **THEN** the backend SHALL spawn the command with appropriate isolation
- **AND** the backend SHALL return a `LaunchResult` with a valid `sessionId`
- **AND** for process backends (Firejail, Docker, Podman), `LaunchResult.pid` SHALL be populated
- **AND** for container backends, `LaunchResult.containerId` SHALL be populated

#### Scenario: Launch with mounts
- **WHEN** `cfg.mounts` contains mount entries
- **THEN** the backend SHALL expose each mount at `/mnt/<alias>` inside the execution context
- **AND** permissions SHALL be enforced according to `mount.permissions`

#### Scenario: Launch with sandbox profile
- **WHEN** `cfg.profile` is `'sandbox'`
- **THEN** the backend SHALL apply standard sandbox security constraints
- **AND** the backend SHALL use `getSecurityConstraints('sandbox')` if available

#### Scenario: Launch with isolated profile
- **WHEN** `cfg.profile` is `'isolated'`
- **THEN** the backend SHALL apply stricter constraints than sandbox
- **AND** the backend SHALL use `getSecurityConstraints('isolated')` if available
- **AND** if the backend cannot satisfy isolated constraints, it SHALL reject launch with `BackendConstraintError`

#### Scenario: Launch with PTY
- **WHEN** `cfg.pty` is configured
- **THEN** the backend SHALL allocate a pseudo-terminal for the command
- **AND** `LaunchResult.pty` SHALL contain PTY connection details

### Requirement: Cleanup operation
The `cleanup()` method SHALL release all resources associated with a session.

#### Scenario: Cleanup after command exits
- **WHEN** `backend.cleanup(sessionId)` is called
- **THEN** the backend SHALL terminate any remaining processes in that session
- **AND** the backend SHALL release any allocated PTY resources
- **AND** for container backends, the backend SHALL stop and remove the container

#### Scenario: Cleanup with container backend
- **WHEN** a Docker or Podman session is cleaned up
- **THEN** the backend SHALL stop the container if still running
- **AND** the backend SHALL remove the container filesystem

### Requirement: Capability detection
The `detectCapabilities()` method SHALL return a `BackendCapabilities` object describing what the backend can do on the current system.

#### Scenario: Landlock detection on supported kernel
- **WHEN** Landlock backend calls `detectCapabilities()` on a system with kernel >= 5.13 and Landlock enabled
- **THEN** the result SHALL have `isAvailable: true`
- **AND** `supportedFilesystemRestrictions` SHALL include `'landlock'`

#### Scenario: Landlock detection on unsupported kernel
- **WHEN** Landlock backend calls `detectCapabilities()` on a system with kernel < 5.13
- **THEN** the result SHALL have `isAvailable: false`

#### Scenario: Firejail detection with binary present
- **WHEN** Firejail backend calls `detectCapabilities()` and `firejail` is on PATH
- **THEN** the result SHALL have `isAvailable: true`

#### Scenario: Firejail detection with binary missing
- **WHEN** Firejail backend calls `detectCapabilities()` and `firejail` is not on PATH
- **THEN** the result SHALL have `isAvailable: false`

#### Scenario: Docker detection with daemon running
- **WHEN** Docker backend calls `detectCapabilities()` and Docker daemon is accessible
- **THEN** the result SHALL have `isAvailable: true`

#### Scenario: Docker detection with daemon inaccessible
- **WHEN** Docker backend calls `detectCapabilities()` and Docker socket is not accessible
- **THEN** the result SHALL have `isAvailable: false`

#### Scenario: Podman detection with binary present
- **WHEN** Podman backend calls `detectCapabilities()` and `podman` is on PATH
- **THEN** the result SHALL have `isAvailable: true`

#### Scenario: None backend always available
- **WHEN** None backend calls `detectCapabilities()`
- **THEN** the result SHALL have `isAvailable: true`
- **AND** `supportedFilesystemRestrictions` SHALL be empty
- **AND** `supportedNetworkingRestrictions` SHALL be empty
- **AND** `resourceLimits` SHALL indicate no limits enforced

### Requirement: Capability structure
`BackendCapabilities` SHALL describe filesystem restrictions, networking restrictions, mount support, and resource limits.

#### Scenario: Capabilities include filesystem restrictions
- **WHEN** `detectCapabilities()` returns
- **THEN** `supportedFilesystemRestrictions` SHALL list all filesystem restriction types the backend can enforce
- **AND** `supportsReadOnlyMounts` SHALL indicate if read-only mounts are supported
- **AND** `supportsReadWriteMounts` SHALL indicate if read-write mounts are supported
- **AND** `supportsTmpfs` SHALL indicate if tmpfs mounts are supported

#### Scenario: Capabilities include resource limits
- **WHEN** `detectCapabilities()` returns
- **THEN** `resourceLimits` SHALL describe default and maximum enforceable limits for memory, CPU, and process count

### Requirement: Mount validation protocol
Backends that implement `validateMounts()` SHALL validate mounts against their constraints before launch.

#### Scenario: Valid mount list passes validation
- **WHEN** `backend.validateMounts(mounts)` is called with mounts within backend constraints
- **THEN** the result SHALL have `valid: true`

#### Scenario: Mount count exceeds maximum
- **WHEN** `backend.validateMounts(mounts)` is called with more mounts than `maxMounts`
- **THEN** the result SHALL have `valid: false`
- **AND** `errors` SHALL contain an entry for each excess mount

#### Scenario: Unsupported host path rejected
- **WHEN** `backend.validateMounts(mounts)` is called with a host path the backend cannot mount
- **THEN** the result SHALL have `valid: false`
- **AND** `errors` SHALL identify the unsupported mount

### Requirement: Security constraints per profile
Backends that implement `getSecurityConstraints()` SHALL map `SecurityProfile` to backend-specific constraints.

#### Scenario: Sandbox profile constraints
- **WHEN** `backend.getSecurityConstraints('sandbox')` is called
- **THEN** the returned `SecurityConstraints` SHALL reflect standard sandbox policy
- **AND** `networkMode` SHALL allow outbound connections

#### Scenario: Isolated profile constraints
- **WHEN** `backend.getSecurityConstraints('isolated')` is called
- **THEN** the returned `SecurityConstraints` SHALL be stricter than sandbox
- **AND** `networkMode` SHALL be `'none'` or equivalent isolation
- **AND** `readonlyPaths` SHALL include sensitive system directories

### Requirement: None backend direct execution
The `none` backend SHALL be used exclusively for `direct` tier execution.

#### Scenario: None backend launch
- **WHEN** `none.launch(cfg)` is called
- **THEN** the command SHALL be executed directly on the host without isolation
- **AND** `cfg.mounts` SHALL be ignored (no mount enforcement)

#### Scenario: None backend capabilities
- **WHEN** `none.detectCapabilities()` is called
- **THEN** it SHALL return `isAvailable: true`
- **AND** all `supported*Restrictions` arrays SHALL be empty
- **AND** `resourceLimits` SHALL indicate no enforcement

### Requirement: Error reporting
Backend unavailability SHALL be reported with actionable error messages.

#### Scenario: BackendUnavailableError includes suggestion
- **WHEN** a backend is unavailable
- **THEN** the error SHALL include a `suggestion` field with remediation steps
- **AND** the error SHALL identify the specific reason (`binary-not-found`, `kernel-unsupported`, `permission-denied`, `socket-inaccessible`)

#### Scenario: BackendConstraintError on profile failure
- **WHEN** a backend cannot satisfy requested profile constraints
- **THEN** the error SHALL identify which constraint could not be satisfied
- **AND** the error SHALL suggest an alternative profile if available
