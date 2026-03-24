# runtime-config (Delta)

## ADDED Requirements

### Requirement: Browser section in config schema
The system SHALL accept an optional `browser` section at the top level of `openclaw.json` for browser automation configuration.

#### Scenario: Config with browser section
- **WHEN** `openclaw.json` contains a `browser` section with valid settings
- **THEN** the config schema SHALL validate it and make settings available to the browser service

#### Scenario: Config without browser section
- **WHEN** `openclaw.json` does not contain a `browser` section
- **THEN** config validation SHALL pass and default browser settings SHALL be used
