# runtime-config (Delta)

## ADDED Requirements

### Requirement: Guided config authoring
The system SHALL support guided generation and update of supported `openclaw.json` sections through the setup workflow.

#### Scenario: Setup creates a valid config file
- **WHEN** the operator completes onboarding on an install that does not yet have `openclaw.json`
- **THEN** the setup workflow SHALL generate `openclaw.json` at the resolved config path
- **AND** the resulting file SHALL validate against the existing config schema

#### Scenario: Setup updates supported config sections
- **WHEN** the operator edits provider, agent, runtime, search, browser, or MCP settings through onboarding
- **THEN** the saved `openclaw.json` SHALL reflect those values
- **AND** the updated file SHALL remain schema-valid

### Requirement: Guided advanced env overrides
The setup workflow SHALL distinguish supported config fields from env-only operational overrides.

#### Scenario: Config-backed values stay in openclaw.json
- **WHEN** the operator edits values that already belong to the config schema
- **THEN** onboarding SHALL persist them in `openclaw.json`
- **AND** it SHALL prefer config fields over deprecated env-based equivalents when both patterns exist

#### Scenario: Env-only values stay out of openclaw.json
- **WHEN** the operator edits advanced values that are still env-only
- **THEN** onboarding SHALL persist them through env files
- **AND** it SHALL NOT add unknown keys to `openclaw.json`
