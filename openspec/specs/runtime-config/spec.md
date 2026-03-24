# runtime-config Specification

## Purpose
TBD - created by archiving change centralize-runtime-config. Update Purpose after archive.
## Requirements
### Requirement: Runtime configuration section
The system SHALL support a `runtime` section in the config file for centralized runtime behavior configuration.

#### Scenario: Config with runtime section
- **WHEN** `openclaw.json` contains a `runtime` section
- **THEN** the system SHALL parse and validate it against the runtime schema

#### Scenario: Config without runtime section
- **WHEN** `openclaw.json` does not contain a `runtime` section
- **THEN** the system SHALL use default values for all runtime settings

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

### Requirement: Retention policy configuration
The system SHALL allow configuration of data retention via `runtime.retention` section.

#### Scenario: Task retention configuration
- **WHEN** `runtime.retention.tasks` is set to a positive integer
- **THEN** the cleanup job SHALL delete completed/failed tasks older than that many days

#### Scenario: Audit log retention configuration
- **WHEN** `runtime.retention.auditLogs` is set to a positive integer
- **THEN** the cleanup job SHALL delete audit logs older than that many days

### Requirement: Logging configuration
The system SHALL allow configuration of logging behavior via `runtime.logging` section.

#### Scenario: Prisma log level configuration
- **WHEN** `runtime.logging.prisma` is set to an array of log levels
- **THEN** PrismaClient instances SHALL use those log levels

### Requirement: Performance tuning configuration
The system SHALL allow configuration of performance parameters via `runtime.performance` section.

#### Scenario: Poll interval configuration
- **WHEN** `runtime.performance.pollInterval` is set to a positive integer
- **THEN** the scheduler SHALL poll for tasks at that interval in milliseconds

#### Scenario: Heartbeat interval configuration
- **WHEN** `runtime.performance.heartbeatInterval` is set to a positive integer
- **THEN** the scheduler SHALL check for due triggers at that interval in milliseconds

#### Scenario: Delivery batch size configuration
- **WHEN** `runtime.performance.deliveryBatchSize` is set to a positive integer
- **THEN** the delivery processor SHALL process at most that many deliveries per batch

#### Scenario: Context window configuration
- **WHEN** `runtime.performance.contextWindow` is set to a positive integer
- **THEN** the session compaction logic SHALL use that as the default token limit

#### Scenario: Compaction threshold configuration
- **WHEN** `runtime.performance.compactionThreshold` is set to a number between 0 and 1
- **THEN** session compaction SHALL trigger when token usage exceeds that fraction of context window

### Requirement: Runtime config access
The system SHALL provide a typed API for accessing runtime configuration values with defaults.

#### Scenario: Access runtime config
- **WHEN** code calls `getRuntimeConfig()`
- **THEN** the system SHALL return a typed object with all runtime settings (from config or defaults)

#### Scenario: Default values
- **WHEN** a runtime setting is not configured
- **THEN** the system SHALL return the documented default value

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

### Requirement: Search configuration section
The system SHALL accept an optional `search` section at the top level of `openclaw.json` for web search provider configuration.

#### Scenario: Config with search API keys
- **WHEN** `openclaw.json` contains `"search": { "braveApiKey": "...", "tavilyApiKey": "..." }`
- **THEN** the config schema SHALL validate it and make API keys available to the search service

#### Scenario: Config without search section
- **WHEN** `openclaw.json` does not contain a `search` section
- **THEN** config validation SHALL pass and the search service SHALL fall back to environment variables and then DuckDuckGo

#### Scenario: Environment variables take precedence
- **GIVEN** `BRAVE_API_KEY` env var is set and `search.braveApiKey` is also set in config
- **WHEN** the search provider is resolved
- **THEN** the env var value SHALL take precedence

### Requirement: Browser section in config schema
The system SHALL accept an optional `browser` section at the top level of `openclaw.json` for browser automation configuration.

#### Scenario: Config with browser section
- **WHEN** `openclaw.json` contains a `browser` section with valid settings
- **THEN** the config schema SHALL validate it and make settings available to the browser service

#### Scenario: Config without browser section
- **WHEN** `openclaw.json` does not contain a `browser` section
- **THEN** config validation SHALL pass and default browser settings SHALL be used

