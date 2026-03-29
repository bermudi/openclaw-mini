# setup-onboarding Specification

## Purpose
TBD - created by archiving change setup-onboarding-tui. Update Purpose after archive.
## Requirements
### Requirement: Interactive setup command
The system SHALL expose a dedicated setup command that launches an interactive terminal onboarding flow for configuring OpenClaw Mini before the main app starts.

#### Scenario: First-run setup on a new install
- **WHEN** the operator runs the setup command and no runtime config exists yet
- **THEN** the system SHALL launch the onboarding flow
- **AND** the flow SHALL present the resolved config path, env file target, and workspace path before saving

#### Scenario: Reconfiguring an existing install
- **WHEN** the operator runs the setup command and runtime artifacts already exist
- **THEN** the onboarding flow SHALL load the existing values
- **AND** the editable fields SHALL be prefilled from the current install instead of starting blank

### Requirement: Read-only doctor workflow
The setup experience SHALL include a read-only doctor workflow that inspects the current install and reports startup readiness without mutating config files, env files, or workspace files.

#### Scenario: Doctor reports startup blockers
- **WHEN** the operator runs the doctor workflow against an incomplete install
- **THEN** the system SHALL report hard failures and soft warnings separately
- **AND** each reported issue SHALL include guidance about the setting, file, or secret that needs attention

#### Scenario: Doctor does not write files
- **WHEN** the operator runs the doctor workflow
- **THEN** the system SHALL NOT create or modify `openclaw.json`, env files, or workspace bootstrap files

### Requirement: Canonical setup artifact persistence
The onboarding flow SHALL persist configuration only through the runtime artifacts already consumed by OpenClaw Mini: `openclaw.json`, local env files, and workspace bootstrap markdown.

#### Scenario: Secrets remain env-backed
- **WHEN** the operator provides provider API keys or bearer tokens during onboarding
- **THEN** the system SHALL store the secret values in a local env file
- **AND** any corresponding provider entries written to `openclaw.json` SHALL reference those values through `${ENV_VAR}` placeholders instead of raw secrets

#### Scenario: Existing install updated in place
- **WHEN** the operator saves changes from onboarding on an existing install
- **THEN** the system SHALL update the canonical runtime artifacts in place
- **AND** it SHALL NOT require a separate setup-only manifest to apply the changes

### Requirement: Advanced configuration mode
The onboarding flow SHALL offer an advanced configuration mode that surfaces supported runtime sections and env-only operational overrides without forcing them into the default setup path.

#### Scenario: Advanced mode exposes supported config sections
- **WHEN** the operator enters advanced configuration
- **THEN** the system SHALL allow editing supported `openclaw.json` sections such as `runtime`, `search`, `browser`, `mcp`, exec, and memory-related settings

#### Scenario: Advanced mode exposes env-only overrides separately
- **WHEN** the operator configures advanced settings that are still env-backed
- **THEN** the system SHALL present them as env-backed overrides
- **AND** it SHALL NOT invent unsupported keys in `openclaw.json`

### Requirement: Post-save verification summary
After onboarding writes configuration, the system SHALL run a verification pass and summarize what is ready, what is still optional, and which next steps remain.

#### Scenario: Verification after successful save
- **WHEN** onboarding finishes writing valid configuration
- **THEN** the system SHALL run a verification pass using the shared startup diagnostics
- **AND** it SHALL show which hard requirements now pass

#### Scenario: Verification highlights remaining optional setup
- **WHEN** onboarding completes with optional integrations still unconfigured
- **THEN** the verification summary SHALL keep the install marked usable if no hard requirements fail
- **AND** it SHALL list the remaining optional integrations as follow-up items rather than blockers

