# exec-isolation Specification

## Purpose
Execution tier isolation for command execution, providing host, sandbox, and locked-down execution modes with container runtime detection and tier-specific security profiles.
## Requirements
### Requirement: Execution tiers
The system SHALL support three execution tiers for command execution: `host`, `sandbox`, and `locked-down`.

#### Scenario: Host tier requested
- **WHEN** a command is launched with tier `host`
- **THEN** the system SHALL execute it directly on the host without container isolation

#### Scenario: Sandbox tier requested
- **WHEN** a command is launched with tier `sandbox`
- **THEN** the system SHALL execute it in a container (Docker or Podman) with operator-approved mounts

#### Scenario: Locked-down tier requested
- **WHEN** a command is launched with tier `locked-down`
- **THEN** the system SHALL execute it in a container with strictest restrictions: read-only mounts, no network, minimal environment

### Requirement: Tier ceiling enforcement
The system SHALL enforce configured execution-tier ceilings so a command cannot request more privilege than the runtime allows.

#### Scenario: Requested tier exceeds configured maximum
- **WHEN** a command requests a tier more privileged than the configured maximum tier
- **THEN** the system SHALL reject the command before launch

#### Scenario: Requested tier is more restrictive than default
- **WHEN** a command requests a tier more restrictive than the configured default tier and not above the configured maximum tier
- **THEN** the system SHALL honor the requested tier

### Requirement: Container runtime detection
The system SHALL auto-detect an available container runtime for `sandbox` and `locked-down` tiers.

#### Scenario: Docker available
- **WHEN** the `docker` command is available on the host
- **THEN** the system SHALL use Docker as the container runtime

#### Scenario: Podman available (Docker not available)
- **WHEN** `docker` is not available but `podman` is available
- **THEN** the system SHALL use Podman as the container runtime

#### Scenario: No container runtime available
- **WHEN** neither Docker nor Podman is available
- **THEN** the system SHALL report no container runtime available and fail `sandbox`/`locked-down` tier requests with a clear error

### Requirement: No silent fallback for sandbox/locked-down
The system SHALL not silently degrade a `sandbox` or `locked-down` execution request to `host` tier.

#### Scenario: Container runtime unavailable for sandbox
- **WHEN** a command requests tier `sandbox` or `locked-down` and no container runtime is available
- **THEN** the system SHALL fail the command with an error describing the missing container runtime

### Requirement: Tier profile differentiation
The system SHALL apply different security profiles to `sandbox` and `locked-down` execution.

#### Scenario: Sandbox profile applied
- **WHEN** a command runs in tier `sandbox`
- **THEN** the system SHALL apply mounts with read/write permissions and allow network access

#### Scenario: Locked-down profile applied
- **WHEN** a command runs in tier `locked-down`
- **THEN** the system SHALL apply read-only mounts, disable network access (`--network none`), and use minimal environment variables
