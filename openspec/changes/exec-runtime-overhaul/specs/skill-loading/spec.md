## MODIFIED Requirements

### Requirement: Skill discovery from filesystem
The system SHALL scan multiple skills directories for subdirectories containing a `SKILL.md` file. The runtime SHALL load built-in skills from `skills/` in the project root and agent-managed skills from `data/skills/`.

#### Scenario: Discover built-in and managed skills
- **WHEN** `skills/` contains `planner/SKILL.md` and `data/skills/` contains `skill-manager/SKILL.md`
- **THEN** both skills SHALL be discovered and loaded

#### Scenario: Subdirectory without SKILL.md is ignored
- **WHEN** a scanned skills directory contains a subdirectory `drafts/` with no `SKILL.md`
- **THEN** that subdirectory SHALL be silently ignored

#### Scenario: Empty or missing managed skills directory
- **WHEN** `data/skills/` does not exist or is empty
- **THEN** the system SHALL still start normally and load any built-in skills it finds

### Requirement: Managed skill precedence
The system SHALL prefer agent-managed skills over built-in skills when both define the same skill name.

#### Scenario: Name collision between built-in and managed skill
- **WHEN** both `skills/coder/SKILL.md` and `data/skills/coder/SKILL.md` define the skill name `coder`
- **THEN** the system SHALL load the agent-managed definition as the active skill
