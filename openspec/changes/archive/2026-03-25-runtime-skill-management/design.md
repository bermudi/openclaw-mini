## Context

Runtime skill management is a workflow, not just a new markdown file. For an agent to create a skill safely, it needs:

- somewhere safe to write (`data/skills/`)
- a loader that can discover those managed skills without allowing built-in override
- a way to inspect existing skill files without exposing arbitrary filesystem reads
- a repeatable loop for testing and refinement

Those requirements make this a natural follow-up change rather than part of the static built-in skill overhaul.

## Goals / Non-Goals

**Goals:**
- add a `skill-manager` skill definition for managed-skill authoring and iteration
- add a scoped `read_skill_file` tool for built-in and managed skill inspection
- define a workflow for draft -> test -> evaluate -> refine
- rely on protected built-ins and additive managed skills

**Non-Goals:**
- changing built-in precedence rules again
- allowing managed skills to override built-ins
- exposing arbitrary filesystem reads through the new tool

## Decisions

### Decision 1: `skill-manager` is a follow-up skill

`skill-manager` is no longer part of the static built-in skill overhaul. It belongs here because it only makes sense once runtime writing and managed-skill loading are both available.

### Decision 2: `read_skill_file` is scoped, not general-purpose

The new tool reads from:

- `skills/<name>/SKILL.md`
- `data/skills/<name>/SKILL.md`

It does not expose arbitrary path reads.

### Decision 3: Managed skills are additive only

This change depends on the add-only collision model from `skill-loading-pipeline`. If a managed skill name collides with a built-in skill, the managed skill is rejected.

### Decision 4: Runtime authoring uses the exec runtime, not a bespoke file-write API

The skill-management workflow uses the expanded exec runtime to write files into `data/skills/` under operator-approved mounts.

## Risks / Trade-offs

- **Runtime skill authoring expands agent power** -> mitigated by mount policy, additive-only loading, and scoped read access
- **Skill quality still depends on prompt quality and eval discipline** -> acceptable; the workflow formalizes iteration rather than guaranteeing brilliance

## Migration Plan

1. wait for `skill-loading-pipeline` and `exec-runtime-overhaul`
2. add `read_skill_file`
3. add `skill-manager` definition and workflow instructions
4. test managed-skill create/read/load/test loops

## Open Questions

- None blocking beyond its declared dependencies.
