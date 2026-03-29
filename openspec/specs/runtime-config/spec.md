# runtime-config Specification

## Purpose
Centralized runtime configuration for OpenClaw including safety limits, retention policies, logging, performance tuning, and execution runtime settings.
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

### Requirement: Exec config access via getRuntimeConfig
The `getRuntimeConfig()` function SHALL include resolved exec settings, including tier, mount, backend, and session-control configuration.

#### Scenario: Access exec config
- **WHEN** code calls `getRuntimeConfig()`
- **THEN** the returned object SHALL include an `exec` property with the resolved exec configuration fields and defaults

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

### Requirement: MCP section in config schema
The system SHALL accept an optional `mcp` section at the top level of `openclaw.json` for MCP server declarations.

#### Scenario: Config with mcp section
- **WHEN** `openclaw.json` contains an `mcp` section with valid server declarations
- **THEN** the config schema SHALL validate it and make server definitions available via `getMcpServers()`

#### Scenario: Config without mcp section
- **WHEN** `openclaw.json` does not contain an `mcp` section
- **THEN** config validation SHALL pass and `getMcpServers()` SHALL return an empty record

#### Scenario: Unknown fields in mcp section rejected
- **WHEN** `openclaw.json` contains `"mcp": { "servers": {}, "unknownField": true }`
- **THEN** config validation SHALL fail due to strict schema enforcement

### Requirement: Guided config authoring
The system SHALL support guided generation and update of supported `openclaw.json` sections through the setup workflow.

#### Scenario: Setup creates a valid config file
- **WHEN** the operator completes onboarding on an install that does not yet have `openclaw.json`
- **THEN** the setup workflow SHALL generate `openclaw.json` at the resolved config path
- **AND** the resulting file SHALL validate against the existing config schema

#### Scenario: Setup updates supported config sections
- **WHEN** the operator edits provider, agent, runtime, search, browser, or MCP settings through onboarding
- **THEN** the saved `openclaw.json` SHALL reflect those values
- **AND** the updated file SHALL remain schema-valid

### Requirement: Guided advanced env overrides
The setup workflow SHALL distinguish supported config fields from env-only operational overrides.

#### Scenario: Config-backed values stay in openclaw.json
- **WHEN** the operator edits values that already belong to the config schema
- **THEN** onboarding SHALL persist them in `openclaw.json`
- **AND** it SHALL prefer config fields over deprecated env-based equivalents when both patterns exist

#### Scenario: Env-only values stay out of openclaw.json
- **WHEN** the operator edits advanced values that are still env-only
- **THEN** onboarding SHALL persist them through env files
- **AND** it SHALL NOT add unknown keys to `openclaw.json`

