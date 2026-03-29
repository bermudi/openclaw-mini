# startup-validation Specification

## Purpose
TBD - created by archiving change init-system. Update Purpose after archive.
## Requirements
### Requirement: Startup validation entry point
The system SHALL validate all hard requirements at server startup via the Next.js instrumentation API.

#### Scenario: Instrumentation runs validation
- **WHEN** the Next.js server starts
- **THEN** the system SHALL execute the `register()` function in `instrumentation.ts`
- **AND** the system SHALL complete all validation checks before accepting requests

#### Scenario: Validation only runs in Node.js runtime
- **WHEN** `process.env.NEXT_RUNTIME` is not `edge`
- **THEN** the system SHALL run validation

### Requirement: Hard requirement failure blocks startup
The system SHALL exit with code 1 if any hard requirement fails validation.

#### Scenario: Missing config file exits
- **WHEN** the config file does not exist at the expected path
- **THEN** the system SHALL print a formatted error message
- **AND** the system SHALL call `process.exit(1)`

#### Scenario: Invalid config schema exits
- **WHEN** the config file fails schema validation
- **THEN** the system SHALL print the validation errors
- **AND** the system SHALL call `process.exit(1)`

#### Scenario: Missing provider API key exits
- **WHEN** a provider's `apiKey` references an undefined environment variable
- **THEN** the system SHALL print which provider and env var are missing
- **AND** the system SHALL call `process.exit(1)`

#### Scenario: Database connection failure exits
- **WHEN** the database cannot be reached or `DATABASE_URL` is not set
- **THEN** the system SHALL print the connection error
- **AND** the system SHALL call `process.exit(1)`

#### Scenario: Database not migrated exits
- **WHEN** the database exists but migrations have not been applied
- **THEN** the system SHALL print a message indicating migrations are needed
- **AND** the system SHALL call `process.exit(1)`

### Requirement: Soft requirement failures produce warnings
The system SHALL log warnings for soft requirement failures but continue startup.

#### Scenario: Missing Telegram adapter warns
- **WHEN** `TELEGRAM_BOT_TOKEN` is not set
- **THEN** the system SHALL log a warning that Telegram is not configured
- **AND** the system SHALL continue startup

#### Scenario: Missing WhatsApp adapter warns
- **WHEN** `WHATSAPP_ENABLED` is not `true`
- **THEN** the system SHALL log a warning that WhatsApp is not configured
- **AND** the system SHALL continue startup

#### Scenario: Missing workspace directory warns
- **WHEN** the workspace directory does not exist
- **THEN** the system SHALL log that it will be created on first use
- **AND** the system SHALL continue startup

### Requirement: Default agent auto-creation
The system SHALL create a default agent if none exists after database validation passes.

#### Scenario: No default agent exists
- **WHEN** no agent with `isDefault=true` exists in the database
- **THEN** the system SHALL create a default agent
- **AND** the agent SHALL use the provider and model from config
- **AND** the agent SHALL have `isDefault=true`

#### Scenario: Default agent already exists
- **WHEN** an agent with `isDefault=true` already exists
- **THEN** the system SHALL NOT create a new agent

### Requirement: Formatted startup error output
The system SHALL produce formatted, actionable error messages when startup fails.

#### Scenario: Error output includes guidance
- **WHEN** startup fails due to a hard requirement
- **THEN** the error message SHALL include what failed
- **AND** the error message SHALL include the expected state
- **AND** the error message SHALL include suggested remediation steps

### Requirement: Idempotent initialization
The system SHALL prevent multiple initialization runs.

#### Scenario: Double initialization prevented
- **WHEN** `initialize()` is called more than once
- **THEN** the system SHALL return immediately without re-running checks

