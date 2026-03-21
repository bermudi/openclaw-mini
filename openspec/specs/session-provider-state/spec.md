# session-provider-state Specification

## Purpose
TBD - created by archiving change multi-provider-switching. Update Purpose after archive.
## Requirements
### Requirement: Session stores active provider
The system SHALL store the active provider in session state.

#### Scenario: Session initializes with default provider
- **WHEN** a new session starts
- **THEN** the active provider SHALL be set to `agent.provider` from config

#### Scenario: Session stores switched provider
- **WHEN** user switches provider via `/provider`
- **THEN** the session's active provider SHALL be updated
- **AND** subsequent messages SHALL use the new provider

### Requirement: Session stores active model
The system SHALL store the active model in session state.

#### Scenario: Session initializes with default model
- **WHEN** a new session starts
- **THEN** the active model SHALL be set to `agent.model` from config

#### Scenario: Session stores switched model
- **WHEN** user switches model via `/model`
- **THEN** the session's active model SHALL be updated
- **AND** subsequent messages SHALL use the new model

### Requirement: Session state is isolated
Each session SHALL maintain independent provider/model state.

#### Scenario: Multiple sessions with different providers
- **WHEN** session A uses `openai` and session B uses `anthropic`
- **THEN** each session SHALL maintain its own state independently

### Requirement: Session state is ephemeral
Session provider/model state SHALL NOT persist after the session ends.

#### Scenario: New session uses config defaults
- **WHEN** a new session starts after a previous session switched providers
- **THEN** the new session SHALL use the config defaults, not the previous session's switches

