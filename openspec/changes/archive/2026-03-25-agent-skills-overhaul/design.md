## Context

We already have working sub-agent execution: skills are loaded from `SKILL.md`, sub-agents inherit constrained tools, and the executor resolves runtime overrides. The weak spot is the skill layer itself.

Two things are currently wrong:

1. the built-in skills are placeholders rather than useful specialists
2. the runtime supports both a markdown body and `overrides.systemPrompt`, so the natural instruction body can be ignored

This change fixes those two issues, but deliberately does not try to solve every adjacent problem at once.

## Goals / Non-Goals

**Goals:**
- replace the placeholder skills with five substantive built-in skill definitions
- make the SKILL.md body the only prompt source for sub-agents
- remove `systemPrompt` from override schema, config resolution, and sub-agent task payloads
- give the planner a clear built-in specialist roster: `researcher`, `vision-analyst`, `coder`, `browser`
- align skill definitions to the runtime that exists today, not the runtime we plan to build later

**Non-Goals:**
- passing attachments or vision inputs through `spawn_subagent`
- adding `skill-manager`
- adding `read_skill_file`
- implementing managed-skill authoring in `data/skills/`
- overhauling the execution runtime beyond what already exists
- adding new browser-skill gating infrastructure beyond the optional `browser_action` tool registration model

## Decisions

### Decision 1: Body-only system prompt

The SKILL.md body is the canonical sub-agent prompt. `overrides.systemPrompt` is removed from:

- override schema validation
- resolved sub-agent config
- audit-field reporting
- sub-agent task payload construction/consumption

This removes the double-source-of-truth problem and makes the skill file itself authoritative.

### Decision 2: Five built-in skills, not six

This change covers five built-in skills:

- `researcher`
- `vision-analyst`
- `coder`
- `browser`
- `planner`

`skill-manager` moves out of this change because it depends on managed-skill discovery and a stronger exec runtime.

### Decision 3: Planner is an orchestrator over the built-in roster only

The planner knows how to delegate to the four specialists above. It does not reference `skill-manager` in this change.

The planner also assumes attachment handoff is not yet available, so its guidance focuses on decomposition and specialist selection rather than image-payload transfer mechanics.

### Decision 4: Browser skill follows actual tool availability

The browser skill declares `tools: [browser_action]`. This change does not fake extra skill gating with `requires.binaries: ["npx"]`, because the current browser feature is availability-based through optional Playwright tool registration.

### Decision 5: Coder skill instructions must match the current exec surface

The coder skill should not promise arbitrary shell scripting or unrestricted file authoring. Its instructions need to match the runtime that exists today:

- direct command execution through `exec_command`
- sandbox-relative file delivery through `send_file_to_chat`
- no implicit shell redirection or PTY workflows yet

That makes the first implementation honest, even if later exec-runtime work makes the skill much more capable.

### Decision 6: Consistent instruction pattern across skills

Each built-in skill body should cover:

1. role
2. approach
3. tool usage patterns
4. output shape
5. failure handling
6. boundaries

The goal is durable skill behavior, not just better one-line descriptions.

## Risks / Trade-offs

- **Vision-analyst is ahead of runtime handoff plumbing** -> acceptable; the skill can exist before planner-to-subagent image transfer lands
- **Coder remains constrained by the current exec runtime** -> acceptable; the skill is still worth defining, but its instructions must be honest about limits
- **Browser skill may load even when browser automation is not installed** -> acceptable for this change; tool availability remains the runtime truth
- **Removing `systemPrompt` changes test/docs expectations** -> acceptable and necessary to eliminate dead instruction bodies

## Migration Plan

1. remove `systemPrompt` from sub-agent override schema and resolution
2. stop passing `systemPrompt` through sub-agent task payloads
3. replace placeholder built-in skills with substantive skill files
4. update skill-related specs/tests to reflect the body-only prompt model
5. validate skill loading and sub-agent behavior with the new built-in roster

## Open Questions

- None blocking. Attachment propagation and runtime skill management are now handled separately.
