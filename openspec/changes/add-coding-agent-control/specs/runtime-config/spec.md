## ADDED Requirements

### Requirement: Coding-agent configuration section
The system SHALL support a `runtime.codingAgents` section in the config file for coding-agent control behavior.

#### Scenario: Config with coding-agent section
- **WHEN** `openclaw.json` contains `runtime.codingAgents`
- **THEN** the system SHALL parse and validate the section against the runtime schema

#### Scenario: Config without coding-agent section
- **WHEN** `openclaw.json` does not contain `runtime.codingAgents`
- **THEN** the system SHALL use documented defaults for coding-agent control settings

### Requirement: Coding-agent enablement and limits
The `runtime.codingAgents` section SHALL control whether coding-agent control is enabled and how many sessions may run concurrently.

#### Scenario: Feature enablement
- **WHEN** `runtime.codingAgents.enabled` is `true`
- **THEN** the coding-agent control surface SHALL be available to the runtime

#### Scenario: Feature disabled by default
- **WHEN** `runtime.codingAgents.enabled` is not configured
- **THEN** the system SHALL default coding-agent control to disabled

#### Scenario: Concurrency limit configured
- **WHEN** `runtime.codingAgents.maxConcurrentSessionsPerAgent` is set to a positive integer
- **THEN** the controller SHALL enforce that limit when spawning coding-agent sessions for a given agent

### Requirement: Coding-agent backend defaults
The `runtime.codingAgents` section SHALL support defaults for backend selection and inspection behavior.

#### Scenario: Default backend configured
- **WHEN** `runtime.codingAgents.defaultBackend` is set
- **THEN** the controller SHALL use that backend when a caller does not explicitly choose one

#### Scenario: Output tail limit configured
- **WHEN** `runtime.codingAgents.outputTailLimit` is set to a positive integer
- **THEN** inspection operations SHALL cap returned recent output to that many characters by default
