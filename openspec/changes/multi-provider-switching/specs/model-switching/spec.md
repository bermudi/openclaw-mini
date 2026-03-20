## ADDED Requirements

### Requirement: Model switching via command
The system SHALL allow users to switch the active model via the `/model` command.

#### Scenario: Switch to valid model
- **WHEN** user sends `/model claude-3-5-sonnet-20241022`
- **THEN** the system SHALL set the session's active model to `claude-3-5-sonnet-20241022`
- **AND** subsequent messages SHALL use that model

#### Scenario: Model persists for session
- **WHEN** user switches model in a session
- **THEN** the switch SHALL NOT affect other sessions
- **AND** the switch SHALL NOT persist after session ends

### Requirement: Model name acceptance
The system SHALL accept any model name string without pre-validation.

#### Scenario: Any model name accepted
- **WHEN** user sends `/model any-string-here`
- **THEN** the system SHALL set the active model to that string
- **AND** validation SHALL occur at inference time (not command time)

**Rationale:** Model catalogs vary by provider; validating model existence would require API calls or maintaining catalogs. Better to accept any string and fail at inference if invalid.

### Requirement: Model with current provider
The system SHALL use the current active provider when switching models.

#### Scenario: Model uses current provider
- **WHEN** user switches model while provider is `openai`
- **THEN** the model SHALL be used with the `openai` provider
