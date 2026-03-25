# skill-researcher Specification

## Purpose
TBD - created by archiving change agent-skills-overhaul. Update Purpose after archive.
## Requirements
### Requirement: Researcher skill definition
The system SHALL include a `skills/researcher/SKILL.md` file with frontmatter fields `name: researcher`, a research-oriented `description`, and `tools` listing `web_search`, `web_fetch`, and `write_note`.

#### Scenario: Skill discovered and loaded
- **WHEN** the skill-service scans the built-in skills directory
- **THEN** a skill named `researcher` SHALL be discoverable with its defined metadata and instruction body

#### Scenario: Skill description enables main agent selection
- **WHEN** the main agent receives a task requiring web research (e.g., "find the latest AI models from OpenAI")
- **THEN** the skill summary in the system prompt SHALL contain enough context for the main agent to select `researcher` via `spawn_subagent`

### Requirement: Researcher skill instructions
The SKILL.md body SHALL contain substantive instructions covering role definition, search strategy, source evaluation, summarization format, tool usage patterns for `web_search` and `web_fetch`, output shape, and failure handling.

#### Scenario: Sub-agent receives full instructions
- **WHEN** a sub-agent task is created with `skill: "researcher"`
- **THEN** the sub-agent's system prompt SHALL contain the full SKILL.md body with research methodology guidance

#### Scenario: Instructions do not duplicate in overrides
- **WHEN** the SKILL.md is parsed
- **THEN** `overrides.systemPrompt` SHALL be invalid because the body is the canonical system prompt

### Requirement: Researcher skill tool restriction
The researcher skill SHALL declare `tools: ["web_search", "web_fetch", "write_note"]` in frontmatter. The sub-agent SHALL NOT have access to `exec_command`, `browser_action`, `spawn_subagent`, or `send_file_to_chat`.

#### Scenario: Tool access enforced
- **WHEN** a researcher sub-agent attempts to use `exec_command`
- **THEN** the tool invocation SHALL be rejected with a permission error

#### Scenario: Core tools available
- **WHEN** a researcher sub-agent is executing
- **THEN** it SHALL have access to `web_search`, `web_fetch`, and `write_note`

### Requirement: Researcher skill model configuration
The researcher skill SHALL configure `overrides.model` to use a fast/cheap model suitable for search and summarization tasks. The skill SHALL set `overrides.maxIterations` and `overrides.maxToolInvocations` to reasonable limits for research workflows.

#### Scenario: Model override applied
- **WHEN** a researcher sub-agent task is executed
- **THEN** the model SHALL be the one specified in `overrides.model` (not the parent agent's model)

#### Scenario: Iteration limits enforced
- **WHEN** a researcher sub-agent reaches its `maxIterations` limit
- **THEN** execution SHALL stop and return whatever findings have been gathered so far

