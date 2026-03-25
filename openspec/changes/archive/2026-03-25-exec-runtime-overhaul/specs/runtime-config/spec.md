## MODIFIED Requirements

### Requirement: Exec configuration section
The system SHALL support a `runtime.exec` section in the config file for command execution settings, including execution tiers, container runtime, mounts, session limits, and launch defaults.

#### Scenario: Exec section with advanced fields
- **WHEN** `openclaw.json` contains `runtime.exec` with fields such as `enabled`, `defaultTier`, `maxTier`, `containerRuntime`, `mounts`, `maxTimeout`, `maxOutputSize`, or session-limit settings
- **THEN** the system SHALL parse and validate those fields

#### Scenario: Exec enabled field
- **WHEN** `runtime.exec.enabled` is set to a boolean
- **THEN** the system SHALL use it to gate exec-related behavior

#### Scenario: Default tier field
- **WHEN** `runtime.exec.defaultTier` is set to one of `host`, `sandbox`, or `locked-down`
- **THEN** the system SHALL use it as the default execution tier for command launch

#### Scenario: Maximum tier field
- **WHEN** `runtime.exec.maxTier` is set to one of `host`, `sandbox`, or `locked-down`
- **THEN** the system SHALL use the configured privilege ordering to reject requests above that ceiling

#### Scenario: Container runtime auto-detect
- **WHEN** `runtime.exec.containerRuntime` is not set
- **THEN** the system SHALL auto-detect: prefer `docker`, fallback to `podman`

#### Scenario: Mount declarations
- **WHEN** `runtime.exec.mounts` is set to an array of mount declarations
- **THEN** the system SHALL validate each declaration for alias, host path, permissions, and creation policy

#### Scenario: Exec enabled default
- **WHEN** `runtime.exec.enabled` is not set
- **THEN** the system SHALL default to `false`

#### Scenario: Default tier requires unavailable container runtime
- **WHEN** `runtime.exec.defaultTier` is `sandbox` or `locked-down` and no supported container runtime is available
- **THEN** startup validation SHALL fail with a clear error

#### Scenario: Missing container runtime for non-default isolated request
- **WHEN** startup succeeds with a non-isolated default tier and a later command requests `sandbox` or `locked-down` without a supported container runtime
- **THEN** that command SHALL fail with a clear runtime error

### Requirement: Exec config access via `getRuntimeConfig`
The `getRuntimeConfig()` function SHALL include resolved exec settings, including tier, mount, backend, and session-control configuration.

#### Scenario: Access exec config
- **WHEN** code calls `getRuntimeConfig()`
- **THEN** the returned object SHALL include an `exec` property with the resolved exec configuration fields and defaults
