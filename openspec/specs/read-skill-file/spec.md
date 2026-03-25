# read-skill-file Specification

## Purpose
TBD - created by archiving change runtime-skill-management. Update Purpose after archive.
## Requirements
### Requirement: Scoped skill file reader
The system SHALL provide a `read_skill_file` tool for reading `SKILL.md` files from built-in and managed skill directories.

#### Scenario: Read built-in skill file
- **WHEN** a caller requests a built-in skill by name
- **THEN** the tool SHALL read `skills/<name>/SKILL.md`

#### Scenario: Read managed skill file
- **WHEN** a caller requests a managed skill by name
- **THEN** the tool SHALL read `data/skills/<name>/SKILL.md`

#### Scenario: Path scope enforced
- **WHEN** a caller attempts to escape the allowed skill directories
- **THEN** the tool SHALL reject the request

