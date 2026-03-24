## MODIFIED Requirements

### Requirement: Config validation
The system SHALL validate config against a Zod schema.

#### Scenario: Invalid config rejected at startup
- **WHEN** config file contains invalid structure
- **THEN** validation SHALL fail
- **AND** the system SHALL exit with code 1 at startup
- **AND** the system SHALL print validation errors with guidance

#### Scenario: Config validation runs at server startup
- **WHEN** the server starts
- **THEN** config validation SHALL run before any requests are handled
