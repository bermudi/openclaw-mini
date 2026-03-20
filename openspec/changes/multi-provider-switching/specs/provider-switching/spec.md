## ADDED Requirements

### Requirement: Provider switching via command
The system SHALL allow users to switch the active provider via the `/provider` command.

#### Scenario: Switch to valid provider
- **WHEN** user sends `/provider anthropic`
- **THEN** the system SHALL set the session's active provider to `anthropic`
- **AND** subsequent messages SHALL use the anthropic provider

#### Scenario: Switch to invalid provider
- **WHEN** user sends `/provider nonexistent`
- **THEN** the system SHALL respond with an error listing available providers

#### Scenario: Provider persists for session
- **WHEN** user switches provider in a session
- **THEN** the switch SHALL NOT affect other sessions
- **AND** the switch SHALL NOT persist after session ends

### Requirement: Provider discovery
The system SHALL allow users to list available providers via the `/providers` command.

#### Scenario: List available providers
- **WHEN** user sends `/providers`
- **THEN** the system SHALL list all providers defined in `openclaw.json`

### Requirement: Provider command validation
The system SHALL validate that the requested provider exists in the registry.

#### Scenario: Provider exists in registry
- **WHEN** user requests a provider that exists in config
- **THEN** the switch SHALL succeed

#### Scenario: Provider missing from registry
- **WHEN** user requests a provider not in config
- **THEN** the system SHALL show an error with available providers
