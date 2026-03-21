# memory-versioning Specification

## Purpose
TBD - created by archiving change memory-git-versioning. Update Purpose after archive.
## Requirements
### Requirement: Git repository initialization
The system SHALL initialize a git repository inside `data/memories/{agentId}/` on the first memory write for an agent if no repository exists. Initialization SHALL create the repo with `git init`, configure a default author, and create an initial commit containing all existing memory files.

#### Scenario: First write initializes repo
- **GIVEN** agent `agent_main` has no git repo in `data/memories/agent_main/`
- **WHEN** `setMemory` is called for `agent_main`
- **THEN** the system SHALL run `git init` in the agent's memory directory, commit the written file, and subsequent calls to `git log` SHALL return at least one commit

#### Scenario: Existing repo is reused
- **GIVEN** agent `agent_main` already has a git repo in `data/memories/agent_main/`
- **WHEN** `setMemory` is called
- **THEN** the system SHALL NOT re-initialize the repo and SHALL add a new commit

### Requirement: Commit on every memory write
Every call to `saveToFile()` SHALL be followed by a `git add {file}` and `git commit -m "{message}"` in the agent's memory directory. The commit message SHALL follow the format `{Action} {key}` where Action is one of: `Create`, `Update`, `Delete`, `Append`, `Archive`.

#### Scenario: Memory creation commits
- **WHEN** `setMemory` creates a new memory with key `system/preferences`
- **THEN** a git commit SHALL be created with message `Create system/preferences`

#### Scenario: Memory update commits
- **GIVEN** a memory with key `system/preferences` already exists
- **WHEN** `setMemory` updates it
- **THEN** a git commit SHALL be created with message `Update system/preferences`

#### Scenario: Memory deletion commits
- **WHEN** `deleteMemory` is called for key `agent/context`
- **THEN** a git commit SHALL be created with message `Delete agent/context`

#### Scenario: History append commits
- **WHEN** `appendHistory` writes to the history file
- **THEN** a git commit SHALL be created with message `Append system/history`

### Requirement: Graceful degradation without git
If the `git` binary is not found on the system PATH at startup, the system SHALL log a warning and disable all git operations. Memory reads and writes SHALL continue functioning normally without versioning. A `GIT_MEMORY_ENABLED` environment variable set to `"false"` SHALL also disable git operations.

#### Scenario: Git not installed
- **GIVEN** `git` is not available on PATH
- **WHEN** the memory service initializes
- **THEN** the system SHALL log a warning and all memory operations SHALL succeed without creating commits

#### Scenario: Git explicitly disabled
- **GIVEN** `GIT_MEMORY_ENABLED` is set to `"false"`
- **WHEN** `setMemory` is called
- **THEN** the file SHALL be written but no git operations SHALL occur

### Requirement: Memory history retrieval
The system SHALL provide a function to retrieve the commit history for a specific memory key or for all memories of an agent. The history SHALL return an array of entries containing: commit SHA, timestamp, and commit message. Results SHALL be ordered newest-first with a configurable limit (default: 50).

#### Scenario: History for a specific key
- **GIVEN** agent `agent_main` has 10 commits touching `system/preferences`
- **WHEN** memory history is requested for key `system/preferences` with limit 5
- **THEN** the system SHALL return the 5 most recent commits, each with SHA, timestamp, and message

#### Scenario: Full agent memory history
- **GIVEN** agent `agent_main` has 25 total commits across all keys
- **WHEN** memory history is requested without a key filter
- **THEN** the system SHALL return up to 50 commits (newest-first) across all memory files

### Requirement: Time-travel memory reads
The system SHALL provide a function to read the content of a memory file at a specific commit SHA. The function SHALL use `git show {sha}:{path}` to retrieve the file content at that point in history.

#### Scenario: Read memory at a past commit
- **GIVEN** `system/preferences` was updated 3 times, producing commits A, B, C (newest)
- **WHEN** the content is requested at commit A
- **THEN** the system SHALL return the content of `system/preferences.md` as it was at commit A

#### Scenario: Read non-existent file at a commit
- **WHEN** the content is requested for a key that did not exist at the specified commit
- **THEN** the system SHALL return `null`

### Requirement: Memory history API endpoints
The system SHALL expose two API endpoints:
1. `GET /api/agents/:id/memory/history` — returns commit history, with optional `key` and `limit` query parameters
2. `GET /api/agents/:id/memory/:key/at/:sha` — returns memory content at a specific commit SHA

#### Scenario: API returns history
- **WHEN** `GET /api/agents/agent_main/memory/history?key=system/preferences&limit=10` is called
- **THEN** the response SHALL be a JSON array of commit entries with `sha`, `timestamp`, and `message` fields

#### Scenario: API returns memory at commit
- **WHEN** `GET /api/agents/agent_main/memory/system/preferences/at/abc123` is called
- **THEN** the response SHALL contain the memory `value` as it was at commit `abc123`

