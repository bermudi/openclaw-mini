## MODIFIED Requirements

### Requirement: Performance tuning configuration
The `runtime.performance.pollInterval` setting SHALL control both the task polling interval AND the delivery loop interval. The delivery loop SHALL no longer use a hardcoded 5000ms value.

#### Scenario: Poll interval configuration
- **WHEN** `runtime.performance.pollInterval` is set to a positive integer
- **THEN** the scheduler SHALL poll for tasks at that interval in milliseconds
- **AND** the delivery loop SHALL run at that same interval in milliseconds