## Why

The current `skill-service.ts` loads skills with one monolithic function that scans a single directory and mixes discovery, parsing, validation, and caching. That makes the next step awkward in two ways:

1. we need built-in skills in `skills/` and managed skills in `data/skills/` to coexist safely
2. we need a loader shape that can later absorb new sources without rewriting the whole service

This change keeps the same public APIs, but makes the loading pipeline explicit and fixes several planning gaps in the original draft: built-in precedence must be unambiguous, provenance needs a stable public shape, and hot-reload must clear both loaded skills and cached gating checks.

## What Changes

- Replace the current one-pass loader with an explicit `discover -> merge -> validate -> cache` pipeline
- Add a `SkillLoader` abstraction with two filesystem loaders:
  - built-in skills from `skills/`
  - managed skills from `data/skills/`
- Protect built-in skills on collision. Name matching is case-insensitive, built-ins always win, and managed collisions are rejected with a warning
- Define public provenance metadata as `source: "built-in" | "managed"`; internal code may also retain source paths for logs and diagnostics
- Add precedence constants with consistent ordering: lower numbers win, built-ins use higher priority than managed skills
- Make `clearSkillCache()` clear both the loaded-skill cache and the cached binary-availability results used for gating
- Register a one-time `SIGHUP` handler in Node startup so the next lookup triggers a full reload and re-runs gating checks

## Capabilities

### New Capabilities

- `skill-loading-pipeline`: Refactor skill loading into auditable pipeline stages with explicit merge behavior across multiple sources
- `skill-precedence`: Add source-level precedence rules and collision handling for multi-source skill discovery

### Modified Capabilities

- `skill-loading`: Replace the single-directory scan with multi-source discovery while preserving the existing public lookup APIs

## Impact

- **Code**: `src/lib/services/skill-service.ts` is split into explicit stages; new loader helpers live alongside it
- **API**: `loadAllSkills()`, `getSkillSummaries()`, `getSkillForSubAgent()`, and `clearSkillCache()` keep their signatures. The public `source` field becomes provenance (`built-in` or `managed`) instead of a raw file path
- **Runtime**: managed skills are read from `path.join(process.cwd(), 'data/skills')` in this iteration; missing managed-skill directories are treated as empty
- **Diagnostics**: collision warnings, provenance, and cache invalidation become easier to audit
- **Dependencies**: no new packages
