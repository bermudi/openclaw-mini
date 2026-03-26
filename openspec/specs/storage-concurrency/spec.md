# storage-concurrency Specification

## Purpose
TBD - created by archiving change sqlite-concurrency-strategy. Update Purpose after archive.
## Requirements
### Requirement: Single-writer discipline
Only one process SHALL be responsible for authoritative SQLite write operations for task and trigger lifecycle state.

#### Scenario: Scheduler needs to mutate task state
- **WHEN** scheduler needs to create or transition task state
- **THEN** it SHALL call the authoritative API instead of writing directly with its own Prisma client

#### Scenario: Non-authoritative process attempts direct lifecycle write
- **WHEN** a background mini-service attempts direct task lifecycle mutation
- **THEN** the write path SHALL be considered non-compliant and blocked by implementation policy

### Requirement: SQLite contention handling
SQLite connections SHALL be configured for contention resilience and transient lock retries.

#### Scenario: Database is temporarily locked
- **WHEN** a write operation encounters `SQLITE_BUSY`
- **THEN** the system SHALL retry with bounded backoff before failing the operation

#### Scenario: Retries exhausted
- **WHEN** lock contention persists beyond retry limit
- **THEN** the operation SHALL fail explicitly and log the failure context

### Requirement: Lock observability
The system SHALL record lock contention telemetry for operational visibility.

#### Scenario: Busy lock observed
- **WHEN** a write operation encounters `SQLITE_BUSY`
- **THEN** the system SHALL emit structured logs containing operation and retry attempt

