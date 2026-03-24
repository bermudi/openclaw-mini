# config-file Specification

## Purpose
TBD - created by archiving change runtime-provider-registry. Update Purpose after archive.
## Requirements
### Requirement: Config file loading
The system SHALL load configuration from `openclaw.json` in the config directory.

#### Scenario: Config file exists
- **WHEN** `openclaw.json` exists at startup
- **THEN** the system SHALL parse and validate it as JSON5

### Requirement: Config file format
The config file SHALL use JSON5 format and SHALL contain a `providers` object, an `agent` object, and optionally a `runtime` object.

#### Scenario: Valid config structure
- **WHEN** config file contains valid `providers` and `agent` sections
- **THEN** parsing SHALL succeed

#### Scenario: Config with runtime section
- **WHEN** config file contains `providers`, `agent`, and `runtime` sections
- **THEN** parsing SHALL succeed

#### Scenario: Config with comments
- **WHEN** config file contains JavaScript-style comments
- **THEN** parsing SHALL succeed (JSON5 support)

### Requirement: Runtime config schema
The `runtime` section, if present, SHALL be validated against a Zod schema with nested sections for `safety`, `retention`, `logging`, and `performance`.

#### Scenario: Valid runtime config
- **WHEN** runtime section contains valid nested sections
- **THEN** validation SHALL succeed

#### Scenario: Partial runtime config
- **WHEN** runtime section contains only some nested sections
- **THEN** validation SHALL succeed and missing sections SHALL use defaults

#### Scenario: Invalid runtime config value
- **WHEN** runtime section contains an invalid value (e.g., negative timeout)
- **THEN** validation SHALL fail with a descriptive error

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

### Requirement: Agent config fields
The `agent` section SHALL contain `provider`, `model`, and optionally `fallbackProvider` and `fallbackModel`.

#### Scenario: Agent config with fallback
- **WHEN** agent section contains `provider`, `model`, `fallbackProvider`, `fallbackModel`
- **THEN** parsing SHALL succeed

### Requirement: Provider config fields
Each provider SHALL contain `apiType` and `apiKey`, with optional `baseURL`.

#### Scenario: Provider with baseURL
- **WHEN** a provider defines `baseURL`
- **THEN** the SDK SHALL use that base URL instead of the default

### Requirement: Environment variable substitution
The system SHALL support `${ENV_VAR}` syntax in `apiKey` fields.

#### Scenario: Env var substitution
- **WHEN** provider `apiKey` is `"${OPENAI_API_KEY}"`
- **THEN** the system SHALL replace it with the value of `process.env.OPENAI_API_KEY`

