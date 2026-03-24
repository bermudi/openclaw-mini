## ADDED Requirements

### Requirement: Planner skill definition
The system SHALL include a `skills/planner/SKILL.md` file with frontmatter fields: `name: planner`, `description` explaining multi-step task orchestration and delegation capability, and `tools` listing `spawn_subagent`, `get_datetime`, and `write_note`.

#### Scenario: Skill discovered and loaded
- **WHEN** the skill-service scans the skills directory
- **THEN** a skill named `planner` SHALL be loaded with `enabled: true`

#### Scenario: Skill description signals orchestration role
- **WHEN** the main agent receives a complex multi-step task that requires coordination across multiple domains
- **THEN** the skill summary SHALL make it clear that `planner` is the right choice for decomposition and delegation

### Requirement: Planner skill instructions
The SKILL.md body SHALL contain substantive instructions (minimum 50 lines) covering: role definition as orchestrator, how to decompose complex tasks into sub-tasks, the full roster of available skills with their capabilities (researcher, vision-analyst, coder, browser), skill selection guidance (which skill for which task), how to chain skills (vision-analyst output → researcher input → coder input), how to aggregate results from multiple sub-agents, output format (synthesized final response), error handling (sub-agent failures, partial results), and when NOT to delegate (simple tasks the main agent can handle directly).

#### Scenario: Sub-agent receives orchestration instructions
- **WHEN** a sub-agent task is created with `skill: "planner"`
- **THEN** the sub-agent's system prompt SHALL contain the full skill roster, delegation patterns, and result aggregation guidance

#### Scenario: Instructions describe skill chaining
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL describe how to chain skills sequentially (e.g., "use vision-analyst to extract data, then coder to create a chart")

#### Scenario: Instructions include the skill catalog
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL list each available skill with a brief description of what it does and when to use it

### Requirement: Planner skill can delegate to all other skills
The planner skill SHALL declare `overrides.allowedSkills` listing all other skills: `researcher`, `vision-analyst`, `coder`, and `browser`. This ensures the planner can orchestrate the full skill roster.

#### Scenario: Planner can spawn any specialist
- **WHEN** a planner sub-agent calls `spawn_subagent` with any of the four specialist skills
- **THEN** the spawn SHALL be permitted

#### Scenario: Planner skill allowlist is exhaustive
- **WHEN** the SKILL.md overrides are parsed
- **THEN** `allowedSkills` SHALL include `researcher`, `vision-analyst`, `coder`, and `browser`

### Requirement: Planner skill tool restriction
The planner skill SHALL declare `tools: ["spawn_subagent", "get_datetime", "write_note"]` in frontmatter. The planner SHALL NOT have access to `exec_command`, `browser_action`, or `send_file_to_chat` — it delegates execution, it does not execute.

#### Scenario: Delegation tools available
- **WHEN** a planner sub-agent is executing
- **THEN** it SHALL have access to `spawn_subagent`, `get_datetime`, and `write_note`

#### Scenario: No direct execution tools
- **WHEN** a planner sub-agent attempts to use `exec_command` or `browser_action`
- **THEN** the tool invocation SHALL be rejected with a permission error

### Requirement: Planner skill model configuration
The planner skill SHALL configure `overrides.model` to use a strong reasoning model capable of task decomposition and coordination. The skill SHALL set higher iteration limits than specialist skills to support multi-step orchestration with multiple sub-agent spawns.

#### Scenario: Sufficient iterations for multi-agent orchestration
- **WHEN** the SKILL.md overrides are parsed
- **THEN** `maxIterations` SHALL be at least 10 and `maxToolInvocations` SHALL be at least 8 to allow spawning multiple sub-agents and processing their results

#### Scenario: Strong reasoning model selected
- **WHEN** a planner sub-agent task is executed
- **THEN** the model SHALL be one with strong reasoning and planning capability
