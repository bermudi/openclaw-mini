## 1. Schema & Validation

- [ ] 1.1 Extend agent/sub-agent schema to include `overrides` block with optional fields and validations.
- [ ] 1.2 Update config loader + doctor checks to surface override errors clearly.

## 2. Runtime Merge & Credential Handling

- [ ] 2.1 Implement deterministic merge logic (base → agent → sub-agent override) in task dispatcher.
- [ ] 2.2 Wire `credentialRef` lookups into provider client instantiation for sub-agents.
- [ ] 2.3 Add structured telemetry/logging of applied overrides per dispatched task.

## 3. Tool & Skill Enforcement

- [ ] 3.1 Update planner/executor to enforce `allowedSkills` and `allowedTools` allowlists.
- [ ] 3.2 Add failure path tests ensuring disallowed tool invocations are rejected.

## 4. Documentation & Examples

- [ ] 4.1 Document override semantics, precedence, and security notes.
- [ ] 4.2 Provide example manifests demonstrating planner/executor specialization.
