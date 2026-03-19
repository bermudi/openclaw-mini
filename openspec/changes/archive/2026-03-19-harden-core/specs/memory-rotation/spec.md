# memory-rotation Specification

## Purpose
Bounded memory history growth with date-based archival and configurable retention, preventing unbounded database row and file growth.

## ADDED Requirements

### Requirement: History size cap
The memory history value for an agent SHALL be capped at a configurable maximum size (default: 50 KB). The size SHALL be measured in bytes (UTF-8 encoded length) of the history memory value.

#### Scenario: History within cap is unaffected
- **GIVEN** an agent's history memory value is 30 KB
- **WHEN** `appendHistory` is called with a 200-byte entry
- **THEN** the entry SHALL be appended normally and no rotation SHALL occur

#### Scenario: History exceeds cap and triggers rotation
- **GIVEN** an agent's history memory value is 49.5 KB
- **WHEN** `appendHistory` is called with a 1 KB entry that would push the total past 50 KB
- **THEN** the system SHALL rotate the current history to an archive file before appending the new entry

### Requirement: Rotation to dated archive files
When rotation is triggered, the system SHALL move the current history content to a dated archive file at `data/memories/<agentId>/history/YYYY-MM-DD.md` where the date is the current date. If an archive file for the current date already exists, the new content SHALL be appended to it. After archiving, the active history memory value SHALL be reset to contain only the new entry being appended.

#### Scenario: First rotation of the day
- **GIVEN** no archive file exists for today's date
- **WHEN** rotation triggers for agent `agent_main`
- **THEN** the system SHALL create `data/memories/agent_main/history/2026-03-19.md` containing the rotated history content, and reset the active history to the new entry

#### Scenario: Second rotation on the same day
- **GIVEN** `data/memories/agent_main/history/2026-03-19.md` already exists with prior rotated content
- **WHEN** rotation triggers again on the same day
- **THEN** the new rotated content SHALL be appended to the existing `2026-03-19.md` file

### Requirement: Archive cleanup
The system SHALL provide a cleanup function that deletes archive files older than a configurable retention period (default: 30 days). This cleanup SHALL be invoked by the scheduler's daily cleanup job.

#### Scenario: Cleanup removes old archives
- **GIVEN** archive files exist for dates 60, 45, 30, 15, and 5 days ago
- **WHEN** the cleanup job runs with a 30-day retention period
- **THEN** archives from 60 and 45 days ago SHALL be deleted; archives from 30, 15, and 5 days ago SHALL be retained

#### Scenario: No archives to clean up
- **WHEN** the cleanup job runs and no archive files exist older than the retention period
- **THEN** no files SHALL be deleted and no errors SHALL be raised

### Requirement: Rotation preserves recent entries
After rotation, the active history memory value SHALL contain only the entry that triggered the rotation (the newest entry). All prior content SHALL be in the archive file. This ensures the active history always starts fresh after rotation.

#### Scenario: Active history after rotation
- **GIVEN** rotation was triggered by appending entry X
- **WHEN** rotation completes
- **THEN** the active history memory value SHALL contain only entry X with its timestamp header
- **AND** the pre-rotation content SHALL exist in the dated archive file

### Requirement: Rotation during active task
Rotation SHALL be safe to execute while a task is in progress. Because the task queue guarantees sequential execution per agent, concurrent calls to `appendHistory` for the same agent SHALL NOT occur. Rotation is performed inline within `appendHistory` before the append, ensuring atomicity within a single call.

#### Scenario: Task completes and triggers rotation
- **GIVEN** an agent is processing a task and the task's post-commit side effects call `appendHistory`
- **WHEN** the append would exceed the history cap
- **THEN** rotation SHALL complete before the new entry is written, and the next task's `appendHistory` call SHALL see the reset history
