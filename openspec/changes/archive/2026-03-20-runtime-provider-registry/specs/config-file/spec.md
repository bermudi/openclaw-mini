## ADDED Requirements

### Requirement: Config file loading
The system SHALL load configuration from `openclaw.json` in the config directory.

#### Scenario: Config file exists
- **WHEN** `openclaw.json` exists at startup
- **THEN** the system SHALL parse and validate it as JSON5

#### Scenario: Config file does not exist
- **WHEN** `openclaw.json` does not exist
- **THEN** the system SHALL fall back to environment variables

### Requirement: Config file format
The config file SHALL use JSON5 format and SHALL contain a `providers` object and an `agent` object.

#### Scenario: Valid config structure
- **WHEN** config file contains valid `providers` and `agent` sections
- **THEN** parsing SHALL succeed

#### Scenario: Config with comments
- **WHEN** config file contains JavaScript-style comments
- **THEN** parsing SHALL succeed (JSON5 support)

### Requirement: Config validation
The system SHALL validate config against a Zod schema.

#### Scenario: Invalid config rejected
- **WHEN** config file contains invalid structure
- **THEN** validation SHALL fail and system SHALL use previous config (or env vars)

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

### Requirement: Backwards compatibility with env vars
The system SHALL fall back to environment variables when no config file exists.

#### Scenario: Env vars used when no config
- **WHEN** `openclaw.json` does not exist and env vars are set
- **THEN** the system SHALL use env vars for configuration

### Requirement: Deprecation warnings
The system SHALL emit warnings when using environment variables for provider configuration.

#### Scenario: Env var deprecation warning
- **WHEN** `AI_PROVIDER` is used
- **THEN** a deprecation warning SHALL be logged suggesting use of config file

### Requirement: Config migration
The system SHALL offer to generate an initial config file from current environment variables.

#### Scenario: Migration prompt
- **WHEN** env vars are set but no config file exists
- **THEN** the system MAY prompt to generate `openclaw.json` from env vars
