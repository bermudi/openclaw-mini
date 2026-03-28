# startup-validation (Delta)

## ADDED Requirements

### Requirement: Structured startup diagnostics
The system SHALL expose startup validation results as structured diagnostics that can be consumed by setup tooling as well as runtime startup.

#### Scenario: Shared diagnostics used by setup doctor
- **WHEN** the setup doctor workflow requests startup diagnostics
- **THEN** the system SHALL return hard failures and soft warnings in structured form
- **AND** each item SHALL include actionable remediation guidance

#### Scenario: Runtime startup reuses shared diagnostics
- **WHEN** the Next.js startup path performs validation
- **THEN** it SHALL evaluate the same underlying requirement checks used by the setup workflow
- **AND** it SHALL preserve the existing hard-failure versus soft-warning behavior

### Requirement: Read-only validation mode
The system SHALL support a read-only validation mode for setup and verification flows that reports readiness without triggering long-running initialization side effects.

#### Scenario: Doctor avoids initialization side effects
- **WHEN** startup diagnostics are requested in read-only mode
- **THEN** the system SHALL NOT start adapters, backplane clients, or optional tools as part of validation

#### Scenario: Verification avoids destructive mutation
- **WHEN** onboarding runs its final verification step
- **THEN** the system SHALL report whether startup requirements are satisfied
- **AND** it SHALL do so without overwriting config or workspace files during the verification pass
