## Why

Our current built-in skills are structurally weak. `planner` and `executor` are placeholders with thin instructions, limited tool value, and duplicated prompt sources. The SKILL.md body should be the primary place where a skill teaches the sub-agent how to work, but today that body can be shadowed by `overrides.systemPrompt`, which makes the markdown instructions effectively dead code.

We still want a real built-in skill suite, but this change is now intentionally narrower than the original draft. It focuses on the static built-in skills and the body-only prompt model. Sub-agent attachment handoff and runtime skill management move into separate follow-up changes so this proposal can be implemented coherently.

## What Changes

- **REMOVE** the placeholder `skills/executor/SKILL.md`
- **REPLACE** the existing placeholder `skills/planner/SKILL.md` with a substantive orchestration skill
- **ADD** four specialist built-in skills:
  - `skills/researcher/SKILL.md`
  - `skills/vision-analyst/SKILL.md`
  - `skills/coder/SKILL.md`
  - `skills/browser/SKILL.md`
- **FIX** skill instruction sourcing: remove `overrides.systemPrompt` from the codebase; the SKILL.md body becomes the canonical system prompt
- **ALIGN** the browser skill with the actual optional browser tool model: it declares `browser_action`, but this change does not add extra Playwright-specific skill gating logic
- **DEFER** sub-agent attachment passthrough to a dedicated follow-up change
- **DEFER** runtime-managed skills and the `skill-manager` workflow to a dedicated follow-up change

## Capabilities

### New Capabilities

- `skill-researcher`: built-in research specialist skill definition
- `skill-vision-analyst`: built-in image and chart analysis skill definition
- `skill-coder`: built-in code/execution specialist skill definition aligned to the current exec surface
- `skill-browser`: built-in browser automation skill definition for the optional `browser_action` tool
- `skill-planner`: rewritten built-in orchestration skill definition

### Modified Capabilities

- `skill-loading`: clarify that the SKILL.md body is the canonical system prompt and `overrides.systemPrompt` is invalid
- `sub-agent-config-overrides`: remove `systemPrompt` from the allowed override fields

## Impact

- **Skills directory**: remove 2 placeholder skill definitions and replace them with 5 substantive built-in skills
- **Code**: remove `systemPrompt` from sub-agent override handling and stop passing it through sub-agent task payloads
- **Tests/specs**: update sub-agent override expectations to match the body-only prompt model
- **Dependencies**: no new packages; this change relies on existing tool surfaces only
- **Follow-ups**:
  - sub-agent IO handoff handles attachment and delivery-context propagation
  - runtime skill management handles `skill-manager`, `read_skill_file`, and managed-skill workflows
