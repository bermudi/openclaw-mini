## ADDED Requirements

### Requirement: Configurable runtime endpoint client
The dashboard SHALL use a dedicated client layer for runtime HTTP requests and realtime connections. The client SHALL read the runtime base URL and realtime endpoint from configuration rather than assuming same-origin routing.

#### Scenario: Dashboard starts against configured runtime
- **WHEN** the dashboard is started with a configured runtime base URL and realtime endpoint
- **THEN** dashboard HTTP requests and realtime subscriptions SHALL target those configured endpoints

#### Scenario: Runtime endpoint missing or invalid
- **WHEN** the dashboard starts with invalid runtime client configuration
- **THEN** the dashboard SHALL surface a clear configuration error instead of silently falling back to an implicit same-origin runtime

### Requirement: Optional dashboard runtime dependency
The runtime SHALL remain operable without the dashboard package running.

#### Scenario: Runtime runs without dashboard
- **WHEN** the standalone runtime is started and the dashboard package is not running
- **THEN** runtime task execution, scheduling, and adapters SHALL continue functioning normally
