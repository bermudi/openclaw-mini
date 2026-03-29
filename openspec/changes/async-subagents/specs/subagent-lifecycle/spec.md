## MODIFIED Requirements

### Requirement: Cascading cancellation
When a parent task fails, the system SHALL fail all its pending and processing child sub-agent tasks with error "Parent task failed". Already-completed or already-cancelled child tasks SHALL NOT be affected.

#### Scenario: Parent fails with pending children
- **WHEN** a parent task fails and has 2 child sub-agent tasks with status `pending`
- **THEN** both child tasks SHALL be set to `failed` with error "Parent task failed"

#### Scenario: Parent fails with mixed-status children
- **WHEN** a parent task fails and has 1 child task with status `completed`, 1 with status `pending`, and 1 with status `failed` (already cancelled)
- **THEN** only the `pending` child task SHALL be failed; the `completed` and already-`failed` child tasks SHALL NOT be modified

#### Scenario: Parent completes successfully
- **WHEN** a parent task completes successfully
- **THEN** no cascade action SHALL be taken on child tasks

## ADDED Requirements

### Requirement: Supervisor-initiated cancellation
A subagent task in `pending` or `processing` status SHALL be cancellable by the supervisor via the `cancel_subagent` tool. The task SHALL be transitioned to `failed` with error `"Cancelled by supervisor"`. This is equivalent to a task failure for all cascade and sweep purposes.

#### Scenario: Pending task cancelled by supervisor
- **WHEN** `cancel_subagent` is called for a task with status `pending`
- **THEN** the task SHALL transition to `failed` with error `"Cancelled by supervisor"` and any child tasks SHALL be cascaded per the cascading cancellation requirement

#### Scenario: Processing task cancelled by supervisor
- **WHEN** `cancel_subagent` is called for a task with status `processing`
- **THEN** the task SHALL transition to `failed` with error `"Cancelled by supervisor"` and any child tasks SHALL be cascaded per the cascading cancellation requirement

#### Scenario: Terminal task cannot be cancelled
- **WHEN** `cancel_subagent` is called for a task with status `completed` or `failed`
- **THEN** the task status SHALL NOT be changed and the tool SHALL return an appropriate error

### Requirement: Orphaned-sweep excludes supervisor-cancelled tasks
The orphaned sub-agent sweep SHALL NOT attempt to re-fail tasks that were already failed with reason `"Cancelled by supervisor"`. The sweep's stale-detection logic applies only to tasks stuck in `processing` without an explicit terminal reason.

#### Scenario: Cancelled task not re-failed by sweep
- **WHEN** the orphaned sweep runs and encounters a task with status `failed` and error `"Cancelled by supervisor"`
- **THEN** the sweep SHALL skip that task and SHALL NOT generate a new failure event for it
