## Why

Sub-agents are currently locked to the gateway's global model/provider defaults, which prevents tailoring specialized roles (e.g., summarizer vs. planner) and forces awkward workarounds like overloading system prompts or duplicating agent definitions. This gap limits experimentation, makes it impossible to isolate blast-radius when trying a new provider, and blocks enterprise scenarios where sensitive credentials or tool sets must be scoped per sub-agent.

## What Changes

- Introduce per-sub-agent configuration overlays that can override model family, provider, API key/secret source, system prompt, max iterations, and tool/skill allowlists.
- Extend agent manifests + runtime schema to persist those overrides and surface them in config validation.
- Update execution pipeline to merge overrides deterministically (base config → profile → sub-agent overrides) before task dispatch.
- Provide guardrails: schema validation, secrets loading, and audit logging for which overrides were applied per task.
- Add documentation and examples demonstrating how to define specialized sub-agents (e.g., "planner" on higher-reasoning model, "executor" capped to deterministic toolset).

## Capabilities

### New Capabilities
- `sub-agent-config-overrides`: Defines how sub-agents declare and consume runtime overrides for model/provider credentials, prompts, skills, iteration budgets, and tool allowlists.

### Modified Capabilities
- _None_

## Impact

- Config loader & validation pipeline (likely `src/lib/services` and `config.ts`).
- Agent manifest schema and persistence (Convex tables / Markdown memories / scheduler DB if referenced).
- Task queue execution logic that instantiates sub-agents.
- Secrets management (ensuring per-provider credentials can be referenced safely).
- Docs + examples showcasing override usage.
