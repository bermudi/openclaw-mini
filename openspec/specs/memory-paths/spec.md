# memory-paths Specification

## Purpose
TBD - created by archiving change memory-git-versioning. Update Purpose after archive.
## Requirements
### Requirement: Path-based memory keys
Memory keys SHALL use `/` as a separator to form hierarchical paths (e.g., `system/preferences`, `agent/context`). The corresponding file SHALL be stored at `data/memories/{agentId}/{key}.md`, with intermediate directories created automatically.

#### Scenario: Hierarchical key creates nested file
- **WHEN** `setMemory` is called with key `system/preferences`
- **THEN** the file SHALL be written to `data/memories/{agentId}/system/preferences.md` and the `system/` directory SHALL be created if it does not exist

#### Scenario: Deeper nesting
- **WHEN** `setMemory` is called with key `user/preferences/communication`
- **THEN** the file SHALL be written to `data/memories/{agentId}/user/preferences/communication.md`

### Requirement: Default memory key mapping
When initializing agent memory, the system SHALL use the following default keys:

| Default Key | Category |
|---|---|
| `system/preferences` | `preferences` |
| `system/history` | `history` |
| `agent/context` | `context` |

#### Scenario: New agent gets hierarchical keys
- **WHEN** `initializeAgentMemory` is called for a new agent
- **THEN** the three default memories SHALL be created with path-based keys `system/preferences`, `system/history`, and `agent/context`

### Requirement: Key validation
Memory keys SHALL be validated on write. A valid key MUST: contain only alphanumeric characters, hyphens, underscores, and `/` separators; not start or end with `/`; not contain consecutive `/` characters; and not contain `..` path traversal sequences. Invalid keys SHALL cause the write to be rejected with an error.

#### Scenario: Valid key accepted
- **WHEN** `setMemory` is called with key `user/timezone`
- **THEN** the write SHALL succeed

#### Scenario: Path traversal rejected
- **WHEN** `setMemory` is called with key `../../../etc/passwd`
- **THEN** the write SHALL be rejected with a validation error

#### Scenario: Empty segment rejected
- **WHEN** `setMemory` is called with key `system//preferences`
- **THEN** the write SHALL be rejected with a validation error

### Requirement: Migration of existing flat keys
The system SHALL provide a migration function that renames existing flat memory keys to their path-based equivalents. The migration SHALL:
1. Rename `preferences` → `system/preferences`, `history` → `system/history`, `context` → `agent/context` in the database
2. Move the corresponding files to their new paths
3. Skip keys that already contain a `/` separator
4. Be idempotent — running it multiple times SHALL have no additional effect

#### Scenario: Flat keys migrated
- **GIVEN** agent `agent_main` has memories with keys `preferences`, `history`, `context`
- **WHEN** the migration runs
- **THEN** the keys SHALL be renamed to `system/preferences`, `system/history`, `agent/context` in the database and the files SHALL be moved accordingly

#### Scenario: Already-migrated keys skipped
- **GIVEN** agent `agent_main` has a memory with key `system/preferences`
- **WHEN** the migration runs
- **THEN** the key SHALL not be modified

### Requirement: History and archive paths
History-related paths SHALL follow the hierarchical convention. The active history key SHALL be `system/history`. Archive files SHALL remain at `data/memories/{agentId}/history/{date}.md` (unchanged from current behavior, as these are not keyed memories but filesystem artifacts).

#### Scenario: History append uses hierarchical key
- **WHEN** `appendHistory` is called
- **THEN** the system SHALL use key `system/history` to load and update the history memory

