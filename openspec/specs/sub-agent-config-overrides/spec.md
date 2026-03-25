# sub-agent-config-overrides Specification

## Purpose
TBD - created by archiving change sub-agent-config-overrides. Update Purpose after archive.
## Requirements
### Requirement: Sub-agent override declaration
The system SHALL allow each sub-agent definition to include an `overrides` object specifying zero or more of the following fields: `model`, `provider`, `credentialRef`, `maxIterations`, `allowedSkills`, `allowedTools`, and `maxToolInvocations`. At least one field SHALL be present and all values SHALL pass schema validation (e.g., provider exists in registry, positive integers, referenced skills/tools exist).

#### Scenario: Valid override payload
- **WHEN** a sub-agent manifest contains an overrides object with `model: "gpt-4"` and `provider: "openrouter"`
- **THEN** config validation SHALL accept the manifest and record the overrides for runtime use

#### Scenario: Invalid override payload - unknown provider
- **WHEN** a sub-agent manifest provides an overrides object with `provider: "made-up"`
- **THEN** config validation SHALL reject the manifest with an error indicating the provider is not found in registry

#### Scenario: Invalid override payload - removed system prompt field
- **WHEN** a sub-agent manifest provides `overrides.systemPrompt`
- **THEN** config validation SHALL reject the manifest because the SKILL.md body is now the canonical prompt source

### Requirement: Deterministic override merge
The runtime SHALL compute the effective configuration for each sub-agent by merging base gateway defaults, agent profile values, skill body instructions, and the declared overrides in that order. Override fields may replace runtime parameters, but they SHALL NOT replace the prompt body.

#### Scenario: Override replaces model only
- **WHEN** a sub-agent override sets `provider: "openrouter"` and `model: "claude-opus-4.6"`
- **THEN** the resolved config SHALL use the new provider and model while retaining the parent prompt and limits

#### Scenario: Override inherits defaults when empty
- **WHEN** a sub-agent omits the overrides block entirely
- **THEN** the resolved config SHALL equal the agent profile (which already includes base defaults)

### Requirement: Credential reference handling
When `credentialRef` is provided, the system SHALL fetch the referenced secret via the standard credential loader at instantiation time, inject it into the provider client, and SHALL NOT persist or log the raw secret.

#### Scenario: Credential reference present
- **WHEN** a sub-agent specifies `credentialRef: "providers/openrouter/planner"`
- **THEN** the runtime SHALL load the secret, configure the provider client with it, and proceed without exposing the key in logs

### Requirement: Tool and skill gating
If `allowedSkills` or `allowedTools` lists are present, the planner SHALL enforce them by rejecting any task step that invokes a disallowed skill/tool, emitting a clear error.

#### Scenario: Disallowed tool invocation
- **WHEN** a sub-agent restricted to `allowedTools: ["search"]` attempts to call `filesystem`
- **THEN** the planner SHALL abort the step with an error stating the tool is not permitted for that sub-agent

### Requirement: Telemetry of applied overrides
Each dispatched sub-agent task SHALL include structured telemetry indicating which override fields were applied so operators can audit behavior.

#### Scenario: Telemetry record emitted
- **WHEN** a sub-agent with overrides runs a task
- **THEN** the system SHALL emit a log entry containing `overrideFieldsApplied: ["model","allowedTools"]` alongside the agent identifiers

