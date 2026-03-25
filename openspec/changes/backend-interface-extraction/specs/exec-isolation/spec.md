## ADDED Requirements

### Requirement: Tier resolution delegates to backend interface
The system SHALL resolve execution tiers through the `IsolationBackend` interface rather than hardcoded backend logic.

#### Scenario: Sandbox tier resolves via backend
- **WHEN** a command requests tier `sandbox`
- **THEN** the system SHALL call `resolveBackend()` with the configured `BackendPreference`
- **AND** the resolved backend SHALL apply sandbox security constraints

#### Scenario: Isolated tier resolves via backend
- **WHEN** a command requests tier `isolated`
- **THEN** the system SHALL call `resolveBackend()` with the configured `BackendPreference`
- **AND** the resolved backend SHALL apply isolated security constraints

#### Scenario: Auto backend selection order
- **WHEN** `backendPreference.mode` is `'auto'`
- **THEN** the system SHALL iterate through `backendPreference.order` and select the first available backend
- **AND** backend availability SHALL be determined by `detectCapabilities().isAvailable`

#### Scenario: Explicit backend selection
- **WHEN** `backendPreference.mode` is `'explicit'`
- **THEN** the system SHALL use the first backend in `backends` that is available
- **AND** if no configured backend is available, the system SHALL fail with `BackendUnavailableError`

### Requirement: Isolated tier SHALL NOT silently degrade
The system SHALL NOT fall back from `isolated` tier to a less restrictive tier without explicit operator action.

#### Scenario: Isolated tier fails when no backend available
- **WHEN** a command requests tier `isolated` and no isolation backend is available
- **THEN** the system SHALL fail the command with `BackendUnavailableError`
- **AND** the error SHALL describe that isolated execution cannot proceed

#### Scenario: Isolated tier fails when backend cannot satisfy constraints
- **WHEN** a command requests tier `isolated` and the available backend cannot satisfy isolated constraints
- **THEN** the system SHALL fail the command with `BackendConstraintError`
- **AND** the error SHALL NOT fall back to sandbox or direct tier

### Requirement: Backend capability reporting
The system SHALL surface backend capabilities in diagnostics and error messages.

#### Scenario: Capabilities reported on startup
- **WHEN** the runtime starts
- **THEN** the system SHALL log which backends are available and their capabilities

#### Scenario: Missing backend reported in error
- **WHEN** a command fails due to unavailable backend
- **THEN** the error message SHALL include which backend was required and why it is unavailable
- **AND** the error message SHALL include a suggestion for remediation
