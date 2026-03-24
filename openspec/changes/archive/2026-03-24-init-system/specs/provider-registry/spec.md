## MODIFIED Requirements

### Requirement: Provider registry initialization
The system SHALL initialize a provider registry at startup by loading provider definitions from the runtime config.

#### Scenario: Registry loads providers at server startup
- **WHEN** the server starts via instrumentation
- **THEN** the provider registry SHALL be initialized before any requests are handled
- **AND** the provider registry SHALL contain all defined providers

#### Scenario: Registry initialization failure exits
- **WHEN** provider registry initialization fails (e.g., invalid provider config)
- **THEN** the system SHALL exit with code 1 at startup
- **AND** the system SHALL print the initialization error

### Requirement: Provider validation
The system SHALL validate provider definitions when registering them.

#### Scenario: Valid provider registration
- **WHEN** a provider with valid `apiType` and `apiKey` is registered
- **THEN** registration SHALL succeed

#### Scenario: Invalid apiType rejected
- **WHEN** a provider with unknown `apiType` is registered
- **THEN** registration SHALL fail with an error
- **AND** the system SHALL exit at startup if this occurs during initialization
