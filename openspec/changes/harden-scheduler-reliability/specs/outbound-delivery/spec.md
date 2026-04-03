## MODIFIED Requirements

### Requirement: Scheduler processes deliveries
The existing scheduler service SHALL poll for pending deliveries using its own Prisma client (obtained via `getSchedulerPrisma()`), not the default `db` singleton. The delivery interval SHALL be configurable via `runtime.performance.pollInterval` instead of being hardcoded to 2 seconds.

#### Scenario: Scheduler picks up pending delivery
- **WHEN** the scheduler's `runDeliveryLoop` runs
- **THEN** it SHALL call `processPendingDeliveries(schedulerPrisma)` with the scheduler's own Prisma client

#### Scenario: Scheduler uses configurable delivery interval
- **WHEN** the scheduler schedules its next delivery loop iteration
- **THEN** the delay SHALL use `getRuntimeConfig().performance.pollInterval` (default 5000ms)