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

