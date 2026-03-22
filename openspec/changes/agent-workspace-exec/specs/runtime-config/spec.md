## MODIFIED Requirements

### Requirement: Safety limits configuration
The system SHALL allow configuration of safety limits via `runtime.safety` section.

#### Scenario: Subagent timeout configuration
- **WHEN** `runtime.safety.subagentTimeout` is set to a positive integer
- **THEN** subagent tasks SHALL be marked as failed after that many seconds in processing state

#### Scenario: Max spawn depth configuration
- **WHEN** `runtime.safety.maxSpawnDepth` is set to a positive integer
- **THEN** spawn_subagent tool SHALL reject requests that would exceed the configured depth

#### Scenario: Max iterations configuration
- **WHEN** `runtime.safety.maxIterations` is set to a positive integer
- **THEN** subagent execution SHALL stop after that many tool call iterations

#### Scenario: Max delivery retries configuration
- **WHEN** `runtime.safety.maxDeliveryRetries` is set to a positive integer
- **THEN** delivery attempts SHALL be marked as failed after that many retries

## ADDED Requirements

### Requirement: Exec configuration section
The system SHALL support a `runtime.exec` section in the config file for command execution settings.

#### Scenario: Exec section with all fields
- **WHEN** `openclaw.json` contains `runtime.exec` with `enabled`, `allowlist`, `maxTimeout`, and `maxOutputSize`
- **THEN** the system SHALL parse and validate all fields

#### Scenario: Exec enabled field
- **WHEN** `runtime.exec.enabled` is set to a boolean
- **THEN** the system SHALL use it to gate `exec_command` tool registration

#### Scenario: Exec enabled default
- **WHEN** `runtime.exec.enabled` is not set
- **THEN** the system SHALL default to `false` (exec disabled)

#### Scenario: Allowlist field
- **WHEN** `runtime.exec.allowlist` is set to an array of strings
- **THEN** the system SHALL use it as the list of permitted binary names

#### Scenario: Allowlist default
- **WHEN** `runtime.exec.allowlist` is not set
- **THEN** the system SHALL default to an empty array (no commands allowed)

#### Scenario: Max timeout field
- **WHEN** `runtime.exec.maxTimeout` is set to a positive integer
- **THEN** the system SHALL use it as the maximum execution time in seconds

#### Scenario: Max timeout default
- **WHEN** `runtime.exec.maxTimeout` is not set
- **THEN** the system SHALL default to 30 seconds

#### Scenario: Max output size field
- **WHEN** `runtime.exec.maxOutputSize` is set to a positive integer
- **THEN** the system SHALL use it as the maximum captured output size in characters

#### Scenario: Max output size default
- **WHEN** `runtime.exec.maxOutputSize` is not set
- **THEN** the system SHALL default to 10000 characters

### Requirement: Exec config access via getRuntimeConfig
The `getRuntimeConfig()` function SHALL include exec settings in its return value.

#### Scenario: Access exec config
- **WHEN** code calls `getRuntimeConfig()`
- **THEN** the returned object SHALL include an `exec` property with `enabled`, `allowlist`, `maxTimeout`, and `maxOutputSize`
