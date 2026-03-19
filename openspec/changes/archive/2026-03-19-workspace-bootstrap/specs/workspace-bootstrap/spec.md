## ADDED Requirements

### Requirement: Workspace directory structure
The system SHALL use `data/workspace/` as the workspace directory. The following Markdown files SHALL be recognized as bootstrap files: `IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md`, `HEARTBEAT.md`.

#### Scenario: Workspace directory exists with files
- **WHEN** `data/workspace/` contains `SOUL.md` and `AGENTS.md`
- **THEN** both files SHALL be loaded and injected into the system prompt

#### Scenario: Workspace directory does not exist
- **WHEN** `data/workspace/` does not exist
- **THEN** the system SHALL create it and populate it with default bootstrap files

### Requirement: First-boot initialization
On first startup, if the workspace directory is empty or does not exist, the system SHALL create default bootstrap files: `IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, and `TOOLS.md`. Default files SHALL contain placeholder content that makes the agent functional out of the box.

#### Scenario: First boot with no workspace
- **WHEN** the application starts and `data/workspace/` does not exist
- **THEN** the directory SHALL be created with 5 default Markdown files

#### Scenario: Workspace already has files
- **WHEN** the application starts and `data/workspace/` already contains at least one `.md` file
- **THEN** no default files SHALL be created (existing files are never overwritten)

### Requirement: Bootstrap file loading order
Bootstrap files SHALL be loaded in a fixed order: IDENTITY.md → SOUL.md → USER.md → AGENTS.md → TOOLS.md → MEMORY.md. Each file's content SHALL be wrapped with a labeled section header.

#### Scenario: All files present
- **WHEN** all 6 bootstrap files exist in the workspace
- **THEN** they SHALL appear in the system prompt in the order: Identity, Persona & Tone, User Profile, Operating Instructions, Tool Notes, Long-Term Memory

#### Scenario: Some files missing
- **WHEN** only `SOUL.md` and `AGENTS.md` exist
- **THEN** only those two files SHALL be injected, in their defined order, with missing files silently skipped

#### Scenario: Empty file is skipped
- **WHEN** `TOOLS.md` exists but contains only whitespace
- **THEN** it SHALL be skipped and not appear in the system prompt

### Requirement: Per-file and total character caps
Each bootstrap file SHALL be truncated to a maximum of 20,000 characters. The total combined bootstrap content SHALL NOT exceed 150,000 characters. When the total cap is reached, remaining files in the loading order SHALL be skipped.

#### Scenario: File exceeds per-file cap
- **WHEN** `AGENTS.md` contains 25,000 characters
- **THEN** it SHALL be truncated to 20,000 characters with a `[... truncated]` notice appended

#### Scenario: Total cap reached
- **WHEN** IDENTITY.md (5K) + SOUL.md (5K) + USER.md (5K) + AGENTS.md (20K) + TOOLS.md (20K) + MEMORY.md (20K) totals exceed 150,000 characters
- **THEN** files that would push the total past the cap SHALL be skipped entirely

### Requirement: Heartbeat-specific context
`HEARTBEAT.md` SHALL only be injected into the system prompt when the current task type is `heartbeat`. It SHALL NOT be included for message, cron, webhook, or other task types.

#### Scenario: Heartbeat task includes HEARTBEAT.md
- **WHEN** a heartbeat task is executed and `HEARTBEAT.md` exists
- **THEN** its content SHALL be injected into the prompt as a "Heartbeat Checklist" section

#### Scenario: Message task excludes HEARTBEAT.md
- **WHEN** a message task is executed and `HEARTBEAT.md` exists
- **THEN** `HEARTBEAT.md` content SHALL NOT appear in the system prompt

### Requirement: System prompt uses workspace content
The `AgentExecutor.getSystemPrompt()` method SHALL replace its hardcoded persona string with content loaded from workspace files. The agent's name and persona SHALL come from `IDENTITY.md` and `SOUL.md`, not from hardcoded text.

#### Scenario: Custom persona from SOUL.md
- **WHEN** `SOUL.md` contains "You are a pirate captain. Speak in pirate dialect."
- **THEN** the agent's responses SHALL reflect the pirate persona

#### Scenario: No workspace files exist
- **WHEN** the workspace directory is empty and no initialization has occurred
- **THEN** the system prompt SHALL still be functional with a minimal default prompt

### Requirement: Workspace file API
The system SHALL expose API endpoints for managing workspace files: list all files, read a specific file, and update a specific file.

#### Scenario: List workspace files
- **WHEN** a GET request is made to `/api/workspace`
- **THEN** the response SHALL include all `.md` files in `data/workspace/` with their names and sizes

#### Scenario: Read a workspace file
- **WHEN** a GET request is made to `/api/workspace?file=SOUL.md`
- **THEN** the response SHALL include the full content of `SOUL.md`

#### Scenario: Update a workspace file
- **WHEN** a PUT request is made to `/api/workspace` with `{ file: "SOUL.md", content: "..." }`
- **THEN** the file SHALL be written to disk and the next agent prompt SHALL reflect the change

#### Scenario: Path traversal prevention
- **WHEN** a request includes a filename like `../../etc/passwd`
- **THEN** the request SHALL be rejected and the file SHALL NOT be read or written
