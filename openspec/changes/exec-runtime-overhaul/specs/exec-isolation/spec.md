## ADDED Requirements

### Requirement: Execution tiers
The system SHALL support three execution tiers for command execution: `direct`, `sandbox`, and `isolated`.

#### Scenario: Direct tier requested
- **WHEN** a command is launched with tier `direct`
- **THEN** the system SHALL execute it without an isolation backend

#### Scenario: Sandbox tier requested
- **WHEN** a command is launched with tier `sandbox`
- **THEN** the system SHALL execute it through a configured isolation backend with standard restrictions

#### Scenario: Isolated tier requested
- **WHEN** a command is launched with tier `isolated`
- **THEN** the system SHALL execute it through a configured isolation backend with stricter restrictions than `sandbox`

### Requirement: Tier ceiling enforcement
The system SHALL enforce configured execution-tier ceilings so a command cannot request more privilege than the runtime allows.

#### Scenario: Requested tier exceeds configured maximum
- **WHEN** a command requests a tier more privileged than the configured maximum tier
- **THEN** the system SHALL reject the command before launch

#### Scenario: Requested tier is more restrictive than default
- **WHEN** a command requests a tier more restrictive than the configured default tier and not above the configured maximum tier
- **THEN** the system SHALL honor the requested tier

### Requirement: Backend selection
The system SHALL resolve an isolation backend for `sandbox` and `isolated` execution from configured backend preferences.

#### Scenario: Explicit backend configured
- **WHEN** the runtime config specifies a concrete backend such as `landlock`, `firejail`, `docker`, or `podman`
- **THEN** the system SHALL attempt to use that backend for qualifying tiers

#### Scenario: Auto backend configured
- **WHEN** the runtime config specifies backend `auto`
- **THEN** the system SHALL select the first available backend from the configured preference order

### Requirement: No silent fallback for isolated execution
The system SHALL not silently degrade an `isolated` execution request to a less restrictive tier.

#### Scenario: Isolated backend unavailable
- **WHEN** a command requests tier `isolated` and no suitable isolation backend is available
- **THEN** the system SHALL fail the command with an error describing the missing backend capability

### Requirement: Isolation profile differentiation
The system SHALL apply different security profiles to `sandbox` and `isolated` execution even when they use the same backend type.

#### Scenario: Sandbox profile applied
- **WHEN** a command runs in tier `sandbox`
- **THEN** the system SHALL apply the standard sandbox policy for environment filtering, resource limits, and mount permissions

#### Scenario: Isolated profile applied
- **WHEN** a command runs in tier `isolated`
- **THEN** the system SHALL apply a stricter policy than `sandbox` for environment filtering, resource limits, and mount permissions
