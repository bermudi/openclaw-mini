## MODIFIED Requirements

### Requirement: Exec configuration section
The system SHALL support a `runtime.exec` section in the config file for command execution settings, including execution tiers, container runtime, mounts, and session limits.

#### Scenario: Exec section with advanced fields
- **WHEN** `openclaw.json` contains `runtime.exec` with fields such as `enabled`, `defaultTier`, `maxTier`, `containerRuntime`, `mounts`, `maxTimeout`, `maxOutputSize`, or session-limit settings
- **THEN** the system SHALL parse and validate those fields

#### Scenario: Exec enabled field
- **WHEN** `runtime.exec.enabled` is set to a boolean
- **THEN** the system SHALL use it to gate exec-related tool registration

#### Scenario: Default tier field
- **WHEN** `runtime.exec.defaultTier` is set to one of `host`, `sandbox`, or `locked-down`
- **THEN** the system SHALL use it as the default execution tier for command launch

#### Scenario: Maximum tier field
- **WHEN** `runtime.exec.maxTier` is set to one of `host`, `sandbox`, or `locked-down`
- **THEN** the system SHALL use it as the most privileged tier a command may request

#### Scenario: Container runtime field
- **WHEN** `runtime.exec.containerRuntime` is set to `docker` or `podman`
- **THEN** the system SHALL use that runtime for `sandbox` and `locked-down` tiers

#### Scenario: Container runtime auto-detect
- **WHEN** `runtime.exec.containerRuntime` is not set
- **THEN** the system SHALL auto-detect: prefer `docker`, fallback to `podman`

#### Scenario: Mount declarations
- **WHEN** `runtime.exec.mounts` is set to an array of mount declarations
- **THEN** the system SHALL validate each declaration for alias, host path, and permissions

#### Scenario: Exec enabled default
- **WHEN** `runtime.exec.enabled` is not set
- **THEN** the system SHALL default to `false`

#### Scenario: Default tier default
- **WHEN** `runtime.exec.defaultTier` is not set
- **THEN** the system SHALL default to `host`

#### Scenario: Max timeout default
- **WHEN** `runtime.exec.maxTimeout` is not set
- **THEN** the system SHALL default to 30 seconds for foreground execution

#### Scenario: Max output size default
- **WHEN** `runtime.exec.maxOutputSize` is not set
- **THEN** the system SHALL default to 10000 characters for foreground captured output

### Requirement: Exec config access via getRuntimeConfig
The `getRuntimeConfig()` function SHALL include exec settings in its return value, including execution tiers, container runtime, mounts, and session-control settings.

#### Scenario: Access exec config
- **WHEN** code calls `getRuntimeConfig()`
- **THEN** the returned object SHALL include an `exec` property with the resolved exec configuration fields and defaults
