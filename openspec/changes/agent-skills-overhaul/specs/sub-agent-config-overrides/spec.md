## MODIFIED Requirements

### Requirement: Sub-agent override declaration
The system SHALL allow each sub-agent definition to include an `overrides` object specifying zero or more of the following fields: `model`, `provider`, `credentialRef`, `maxIterations`, `allowedSkills`, `allowedTools`, and `maxToolInvocations`. At least one field SHALL be present and all values SHALL pass schema validation.

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
The runtime SHALL compute the effective configuration for each sub-agent by merging base gateway defaults, agent profile values, skill body instructions, and declared overrides in that order. Override fields may replace runtime parameters, but they SHALL NOT replace the prompt body.

#### Scenario: Override replaces model only
- **WHEN** a sub-agent override sets `provider: "openrouter"` and `model: "claude-opus-4.6"`
- **THEN** the resolved config SHALL use the new provider and model while retaining the skill body as the system prompt
