## ADDED Requirements

### Requirement: Canonical writes are authoritative
The runtime SHALL treat canonical SQLite writes as the authoritative completion point for persisted state, and any filesystem or git mirror work SHALL occur after the canonical write path.

#### Scenario: Canonical write returns before mirror completion
- **WHEN** a memory or lifecycle write succeeds in SQLite and mirror work is still queued
- **THEN** the runtime SHALL treat the SQLite write as the authoritative success condition

#### Scenario: Mirror lag does not create a second authority
- **WHEN** filesystem or git state temporarily lags behind SQLite
- **THEN** the runtime SHALL continue treating SQLite as the source of truth for reads and subsequent writes
