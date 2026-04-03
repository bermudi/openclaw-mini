## ADDED Requirements

### Requirement: Task loop has backoff on persistent failures
The `runTaskLoop` SHALL track consecutive failure counts and apply exponential backoff to the poll interval when failures occur. The backoff SHALL be calculated as `pollInterval * 2^failures`, capped at 60 seconds. The failure counter SHALL reset to 0 on any successful iteration.

#### Scenario: Backoff after consecutive failures
- **WHEN** `processPendingTasks()` fails 3 consecutive times
- **THEN** the next poll is delayed by `pollInterval * 8` (capped at 60s)

#### Scenario: Backoff resets on success
- **WHEN** `processPendingTasks()` succeeds after previous failures
- **THEN** the failure counter resets to 0 and the next poll uses the normal interval

#### Scenario: Backoff is capped at 60 seconds
- **WHEN** the calculated backoff exceeds 60 seconds
- **THEN** the delay is capped at 60 seconds

### Requirement: Trigger loop has backoff on persistent failures
The `runTriggerLoop` SHALL track consecutive failure counts and apply exponential backoff to the heartbeat interval when failures occur. The backoff SHALL be calculated as `heartbeatInterval * 2^failures`, capped at 60 seconds. The failure counter SHALL reset to 0 on any successful iteration.

#### Scenario: Backoff after consecutive failures
- **WHEN** `processDueTriggers()` fails 3 consecutive times
- **THEN** the next poll is delayed by `heartbeatInterval * 8` (capped at 60s)

#### Scenario: Backoff resets on success
- **WHEN** `processDueTriggers()` succeeds after previous failures
- **THEN** the failure counter resets to 0 and the next poll uses the normal interval

### Requirement: Delivery loop interval is configurable
The `runDeliveryLoop` SHALL use a configurable interval from `getRuntimeConfig().performance.pollInterval` (or a dedicated `deliveryInterval` setting if available) instead of a hardcoded 5000ms value.

#### Scenario: Delivery loop uses config interval
- **WHEN** `runDeliveryLoop` schedules its next iteration
- **THEN** the delay uses the configured poll interval, not a hardcoded value

#### Scenario: Default delivery interval
- **WHEN** no delivery interval is explicitly configured
- **THEN** the delivery loop uses `pollInterval` (default 5000ms) as the interval