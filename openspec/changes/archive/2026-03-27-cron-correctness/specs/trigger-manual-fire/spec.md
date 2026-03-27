# trigger-manual-fire Delta Specification

## ADDED Requirements

### Requirement: Manual fire for time-based triggers
The system SHALL provide an authenticated control-plane operation that manually fires enabled heartbeat and cron triggers.

#### Scenario: Manual fire enqueues cron task
- **WHEN** an authenticated caller manually fires an enabled cron trigger
- **THEN** the system SHALL enqueue a `cron` task for the trigger's agent immediately

#### Scenario: Manual fire enqueues heartbeat task
- **WHEN** an authenticated caller manually fires an enabled heartbeat trigger
- **THEN** the system SHALL enqueue a `heartbeat` task for the trigger's agent immediately

### Requirement: Manual fire preserves schedule state
Manual fire SHALL not rewrite scheduler-owned fields for a time-based trigger.

#### Scenario: Manual fire leaves schedule timestamps unchanged
- **WHEN** a heartbeat or cron trigger with existing `lastTriggered` and `nextTrigger` values is manually fired
- **THEN** the task SHALL be enqueued without changing `lastTriggered` or `nextTrigger`

### Requirement: Manual fire rejects unsupported or unavailable targets
The manual fire operation SHALL reject missing, disabled, or non-time-based triggers.

#### Scenario: Disabled trigger is rejected
- **WHEN** an authenticated caller manually fires a disabled heartbeat or cron trigger
- **THEN** the system SHALL reject the request and SHALL NOT enqueue a task

#### Scenario: Event-driven trigger is rejected
- **WHEN** an authenticated caller manually fires a `webhook` or `hook` trigger through the manual fire operation
- **THEN** the system SHALL reject the request as unsupported

### Requirement: Manual fire requires control-plane authentication
The manual fire operation SHALL require the same internal authentication model as other trigger control-plane routes.

#### Scenario: Unauthenticated manual fire is rejected
- **WHEN** a caller invokes the manual fire operation without valid internal authentication
- **THEN** the system SHALL reject the request and SHALL NOT enqueue a task
