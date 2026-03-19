## 1. Schema & Validation

- [x] 1.1 Extend agent/sub-agent schema to include `overrides` block with optional fields and validations.
- [x] 1.2 Update config loader + doctor checks to surface override errors clearly.

## 2. Runtime Merge & Credential Handling

- [x] 2.1 Implement deterministic merge logic (base → agent → sub-agent override) in task dispatcher.
- [x] 2.2 Wire `credentialRef` lookups into provider client instantiation for sub-agents.
- [x] 2.3 Add structured telemetry/logging of applied overrides per dispatched task.

## 3. Tool & Skill Enforcement

- [x] 3.1 Update planner/executor to enforce `allowedSkills` and `allowedTools` allowlists.
- [x] 3.2 Add failure path tests ensuring disallowed tool invocations are rejected.

## 4. Documentation & Examples

- [x] 4.1 Document override semantics, precedence, and security notes.
- [x] 4.2 Provide example manifests demonstrating planner/executor specialization.
