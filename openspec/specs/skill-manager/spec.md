# skill-manager Specification

## Purpose
TBD - created by archiving change runtime-skill-management. Update Purpose after archive.
## Requirements
### Requirement: Skill-manager skill definition
The system SHALL include a `skills/skill-manager/SKILL.md` file defining a runtime skill-authoring specialist.

#### Scenario: Skill-manager discovered and loaded
- **WHEN** the skill-service scans the available skill directories
- **THEN** a skill named `skill-manager` SHALL be discoverable with its defined metadata and instruction body

### Requirement: Skill-manager workflow guidance
The skill-manager body SHALL describe a runtime workflow for drafting, testing, evaluating, and refining managed skills.

#### Scenario: Skill-manager creates additive managed skill
- **WHEN** the skill-manager creates a new skill under `data/skills/`
- **THEN** that skill SHALL be eligible for discovery as a managed skill without overriding a built-in skill of the same name

