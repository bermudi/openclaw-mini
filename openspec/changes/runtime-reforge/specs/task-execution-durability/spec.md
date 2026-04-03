## MODIFIED Requirements

### Requirement: Stale busy-agent recovery
The runtime SHALL detect and recover stale agent status during startup and during periodic recovery sweeps.

#### Scenario: Startup recovers stale busy agent
- **WHEN** the runtime starts and finds an agent marked `busy` with no active `processing` task beyond the recovery threshold
- **THEN** the system SHALL reset the agent status to `idle`

#### Scenario: Periodic recovery catches stale state
- **WHEN** the runtime recovery sweep finds an agent that no longer has a valid processing task
- **THEN** the system SHALL restore the agent to `idle` or `error` according to the existing recovery rules
