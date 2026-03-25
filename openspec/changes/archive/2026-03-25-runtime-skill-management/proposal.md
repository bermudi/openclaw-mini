## Why

We want agents to be able to create, inspect, test, and iterate on managed skills at runtime, but that behavior depends on two separate foundations:

- multi-source skill loading with protected built-ins
- a stronger execution runtime with controlled writable access to `data/skills/`

Bundling that workflow into the static built-in skill overhaul made the original proposal too broad. This follow-up isolates the runtime-managed skill story so it can depend cleanly on `skill-loading-pipeline` and `exec-runtime-overhaul`.

## What Changes

- Add a `skill-manager` skill focused on creating and iterating on managed skills in `data/skills/`
- Add a `read_skill_file` tool for scoped inspection of built-in and managed skill files
- Define the runtime workflow for drafting, testing, evaluating, and refining managed skills
- Require built-ins to remain protected from override; managed skills are additive

## Capabilities

### New Capabilities

- `skill-manager`: runtime skill authoring and iteration workflow
- `read-skill-file`: scoped tool for reading built-in and managed skills

### Modified Capabilities

- `skill-loading`: managed-skill discovery becomes a prerequisite for runtime skill authoring
- `exec-command`: mount-aware writable access to `data/skills/` becomes part of the skill-authoring workflow

## Impact

- **Dependencies**: blocked on `skill-loading-pipeline` and `exec-runtime-overhaul`
- **Code**: new scoped read tool plus skill-manager definition and tests
- **Security model**: managed skills may be created at runtime, but built-ins remain protected from override
