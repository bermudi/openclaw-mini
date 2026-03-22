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
