## MODIFIED Requirements

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

## ADDED Requirements

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
