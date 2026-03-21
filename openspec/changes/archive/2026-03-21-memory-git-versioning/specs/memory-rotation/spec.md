# memory-rotation (Delta)

## MODIFIED Requirements

### Requirement: Rotation to dated archive files
When rotation is triggered, the system SHALL move the current history content to a dated archive file at `data/memories/<agentId>/history/YYYY-MM-DD.md` where the date is the current date. If an archive file for the current date already exists, the new content SHALL be appended to it. After archiving, the active history memory value SHALL be reset to contain only the new entry being appended. If git versioning is enabled, the archive file creation and history reset SHALL be committed with message `Archive system/history to history/YYYY-MM-DD`.

#### Scenario: First rotation of the day
- **GIVEN** no archive file exists for today's date
- **WHEN** rotation triggers for agent `agent_main`
- **THEN** the system SHALL create `data/memories/agent_main/history/2026-03-19.md` containing the rotated history content, reset the active history to the new entry, and if git is enabled, create a commit with message `Archive system/history to history/2026-03-19`

#### Scenario: Second rotation on the same day
- **GIVEN** `data/memories/agent_main/history/2026-03-19.md` already exists with prior rotated content
- **WHEN** rotation triggers again on the same day
- **THEN** the new rotated content SHALL be appended to the existing `2026-03-19.md` file and a git commit SHALL be created if versioning is enabled
