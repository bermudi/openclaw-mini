## ADDED Requirements

### Requirement: Check async subagent status
The `check_subagent` tool SHALL accept a task ID, fetch the live task status from the task queue, update the corresponding registry entry, and return the current status and result (if complete).

#### Scenario: Check completed task returns result
- **WHEN** `check_subagent` is called with a task ID whose task queue status is `completed`
- **THEN** the tool SHALL return `{ success: true, data: { taskId: "<id>", status: "completed", result: "<subagent response>" } }` and update the registry entry to `status: "completed"` with a `lastCheckedAt` timestamp

#### Scenario: Check in-progress task returns running status
- **WHEN** `check_subagent` is called with a task ID whose task queue status is `pending` or `processing`
- **THEN** the tool SHALL return `{ success: true, data: { taskId: "<id>", status: "running" } }` and update the registry entry's `lastCheckedAt` timestamp

#### Scenario: Check failed task returns error
- **WHEN** `check_subagent` is called with a task ID whose task queue status is `failed`
- **THEN** the tool SHALL return `{ success: true, data: { taskId: "<id>", status: "failed", error: "<error message>" } }` and update the registry entry to `status: "failed"`

#### Scenario: Check unknown task ID
- **WHEN** `check_subagent` is called with a task ID that does not exist in the task queue
- **THEN** the tool SHALL return `{ success: false, error: "Task not found: <id>" }`

#### Scenario: Check task ID not in registry
- **WHEN** `check_subagent` is called with a task ID that exists in the task queue but is not in the current session's registry
- **THEN** the tool SHALL still fetch and return the live status without modifying the registry

### Requirement: Cancel async subagent
The `cancel_subagent` tool SHALL accept a task ID, mark the task as failed with reason `"Cancelled by supervisor"` if it is not already in a terminal state, update the registry entry to `status: "cancelled"`, and return confirmation.

#### Scenario: Cancel pending task
- **WHEN** `cancel_subagent` is called with a task ID whose task queue status is `pending`
- **THEN** the task SHALL be transitioned to `failed` with error `"Cancelled by supervisor"`, the registry entry SHALL be updated to `status: "cancelled"`, and the tool SHALL return `{ success: true, data: { taskId: "<id>", message: "Subagent cancelled." } }`

#### Scenario: Cancel processing task
- **WHEN** `cancel_subagent` is called with a task ID whose task queue status is `processing`
- **THEN** the task SHALL be transitioned to `failed` with error `"Cancelled by supervisor"`, the registry entry SHALL be updated to `status: "cancelled"`, and the tool SHALL return `{ success: true, data: { taskId: "<id>", message: "Subagent cancelled." } }`

#### Scenario: Cancel already completed task
- **WHEN** `cancel_subagent` is called with a task ID whose task queue status is `completed`
- **THEN** the tool SHALL NOT modify the task, SHALL update the registry entry to `status: "completed"`, and SHALL return `{ success: false, error: "Cannot cancel: task already completed." }`

#### Scenario: Cancel already failed task
- **WHEN** `cancel_subagent` is called with a task ID whose task queue status is `failed`
- **THEN** the tool SHALL NOT modify the task and SHALL return `{ success: false, error: "Cannot cancel: task already failed." }`

#### Scenario: Cancel unknown task ID
- **WHEN** `cancel_subagent` is called with a task ID not found in the task queue
- **THEN** the tool SHALL return `{ success: false, error: "Task not found: <id>" }`

### Requirement: List async subagents
The `list_subagents` tool SHALL return all entries from the current session's async task registry, refreshing live status for all non-terminal entries in a single batched query.

#### Scenario: List with mixed-status tasks
- **WHEN** `list_subagents` is called and the registry contains entries with statuses `pending`, `completed`, and `cancelled`
- **THEN** the tool SHALL fetch live status for the `pending` entry from the task queue, update its registry record if status changed, and return all entries with their current statuses in a human-readable summary

#### Scenario: List with empty registry
- **WHEN** `list_subagents` is called and the session has no async task registry entries
- **THEN** the tool SHALL return `{ success: true, data: { tasks: [], message: "No async subagents tracked in this session." } }`

#### Scenario: Batch status refresh for non-terminal tasks
- **WHEN** `list_subagents` is called and the registry has multiple non-terminal entries
- **THEN** the tool SHALL fetch their statuses in a single DB query (using an `IN` clause on task IDs) rather than making one query per entry
