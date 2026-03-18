## Context

Gateway agents inherit a single configuration stack today: global defaults → agent profile. Sub-agents spawned from an agent reuse the same stack, so all downstream tasks share the identical model/provider credentials, system prompt, tool palette, and iteration budget. This causes three pain points: (1) specialization requires creating separate agents rather than lightweight sub-agents, (2) experimentation with alternative providers risks the entire session, and (3) security teams cannot scope sensitive keys to specific sub-agents. We need a deterministic override layer that lets each sub-agent describe adjustments without duplicating the full agent profile.

## Goals / Non-Goals

**Goals:**
- Allow sub-agents to declare overrides for model, provider, credential source, system prompt, iteration bounds, allowed skills/tools, and default max tool invocations per iteration.
- Merge overrides predictably: base config → agent profile → sub-agent overlay, with validation ensuring conflicting fields are rejected.
- Ensure secrets are referenced via vault keys or env handles, never embedded literals.
- Surface applied overrides in logs/telemetry for auditability.

**Non-Goals:**
- Building UI/CLI editors for sub-agent configs.
- Introducing dynamic override mutation mid-task (overrides remain static for the sub-agent definition).
- Changing how heartbeats/cron triggers enqueue tasks beyond reading the new schema.

## Decisions

1. **Schema extension via `subAgents[].overrides` object**
   - Fields: `model`, `provider`, `credentialRef`, `systemPrompt`, `maxIterations`, `allowedSkills`, `allowedTools`, `maxToolInvocations`.
   - Validation uses Zod: each field optional, but at least one required. Lists enforce inclusion of existing skill/tool identifiers.
   - Alternative considered: new top-level "profiles" referenced by sub-agents. Rejected to keep definitions co-located with sub-agent metadata and avoid extra indirection for v1.

2. **Override merge strategy**
   - Build `ResolvedAgentConfig = deepMerge(baseConfig, agentProfile)` then apply override fields last via explicit assignment (not generic deep merge) to avoid accidental inheritance of nested objects we don't yet support.
   - Alternative: layered config engine (e.g., json-schema patch). Rejected as heavy for current scope; will revisit if overrides expand beyond shallow fields.

3. **Credential handling**
   - `credentialRef` maps to existing secret loader (Convex/file). Loader returns provider-specific key/secret pair during agent instantiation; never persisted.
   - Alternative: allow inline API keys. Rejected for security.

4. **Tool/skill gating**
   - Execution planner intersects requested tool/skill with allowlists. If a sub-agent lacks permission, planner fails fast with "tool not permitted" error.
   - Alternative: best-effort warnings. Rejected because deterministic enforcement is required to prevent privilege escalation.

5. **Telemetry**
   - Task dispatcher logs `agentId`, `subAgentId`, `overrideFieldsApplied` ensuring audit trails. Minimal overhead via structured logger already in codebase.

## Risks / Trade-offs

- **Complex config debugging** → Mitigated by `openclaw-mini doctor` additions verifying override schema and printing resolved configs in verbose mode.
- **Partial overrides leading to inconsistent behavior** → Mitigated by schema requiring at least one field and explicit documentation about precedence order.
- **Provider credential misconfiguration** → Mitigated by referencing existing credential loader and adding smoke tests for each provider override path.
- **Future expansion pressure** (e.g., temperature, safety settings) → Acceptable; design keeps overrides add-only and schema-driven.
