## Context

OpenClaw Mini already has most of the raw setup ingredients, but they are fragmented:
- `src/lib/config/*` loads and validates `openclaw.json`
- `src/lib/init/*` performs startup validation and emits actionable failures
- `.env.example`, `README.md`, and `SETUP.md` document env variables and optional services
- `src/lib/services/workspace-service.ts` creates default workspace bootstrap files
- Optional capabilities such as Telegram, WhatsApp, search, browser, MCP, exec, and memory tuning are configured across a mix of config sections and environment variables

The result is a reliable runtime once configured, but a rough first-run story. The runtime fails fast, which is good, yet there is no guided path for fixing those failures before startup.

## Goals / Non-Goals

**Goals:**
- Provide a single terminal-first onboarding flow that can be run before the app boots
- Reuse existing config schema, workspace bootstrap logic, and startup validation instead of creating parallel setup rules
- Support both first-run setup and reconfiguration of an existing install
- Surface advanced configuration without overwhelming the default path
- Preserve existing user-authored config and workspace content unless the operator explicitly replaces it

**Non-Goals:**
- Replacing the web dashboard as the long-term configuration UI
- Auto-installing external software such as Docker, Playwright browsers, or messaging credentials
- Managing third-party webhook registration beyond capturing the required local settings
- Introducing a new persisted setup database or alternate runtime config format

## Decisions

### D1: Use a standalone Bun CLI entrypoint with Ink

The setup flow will live behind a Bun script such as `bun run setup`, with a terminal UI implemented using Ink.

**Rationale:**
- It can run before the Next.js app starts, which is when setup help is most valuable.
- Ink gives us richer layout, progress states, validation summaries, and advanced panels than a plain prompt chain.
- Bun can execute TS/TSX directly, so the CLI can share runtime code without a build step.

**Alternatives considered:**
- Add setup screens to the dashboard only: rejected because the dashboard is unavailable when startup validation already fails.
- Use plain stdin/stdout prompts only: rejected because the request explicitly calls for a nicer onboarding experience and we want clearer progress and diagnostics.

### D2: Split UI from setup domain logic

The implementation will separate a thin Ink UI from reusable setup services:
- `scripts/setup.tsx` or equivalent CLI entrypoint
- `src/lib/setup/discovery.ts` to inspect current config, env files, and workspace state
- `src/lib/setup/plan.ts` to build a staged setup plan from user choices
- `src/lib/setup/persist.ts` to write config/env/workspace changes safely
- `src/lib/setup/doctor.ts` to expose read-only diagnostics and final verification

**Rationale:**
- The state transitions are easier to test without rendering Ink components.
- A future dashboard or non-interactive CLI can reuse the same domain layer.
- Persistence and diagnostics remain usable from tests and scripts.

**Alternatives considered:**
- Put all logic in Ink components: rejected because it couples persistence, validation, and rendering too tightly.

### D3: Keep `openclaw.json`, env files, and workspace markdown as the only sources of truth

The setup flow will write only to the artifacts the runtime already uses:
- `openclaw.json` at the resolved config path
- a local env file for secrets and env-only overrides
- workspace bootstrap markdown files in the resolved workspace directory

No setup-specific manifest or cache will be introduced.

**Rationale:**
- The runtime already trusts these files.
- Operators can keep editing files manually after setup.
- This avoids drift between “what setup shows” and “what startup actually reads.”

**Alternatives considered:**
- Store setup state in a separate YAML/JSON file and generate runtime config later: rejected because it creates a second config model.

### D4: Read from multiple env sources, but write to `.env.local` by default

Discovery will read the current process environment and local env files. When the user saves from the TUI, the flow will write managed values to `.env.local` by default, while preserving existing non-managed lines where practical.

**Rationale:**
- `.env.local` is the safest local persistence target for a Next/Bun project.
- It avoids clobbering `.env.example` or a committed `.env`.
- Secrets such as `OPENAI_API_KEY`, `OPENCLAW_API_KEY`, Telegram tokens, and credential refs need a canonical writable home.

**Alternatives considered:**
- Only write `openclaw.json`: rejected because secrets and several operational toggles are env-backed today.
- Write directly to the shell profile: rejected because it is invasive and environment-specific.

### D5: Advanced mode will reflect current ownership boundaries instead of inventing new schema

The onboarding flow will present two tiers:
- **Core setup**: database path, provider config, default agent model, internal auth, workspace basics
- **Advanced setup**: runtime sections already supported in `openclaw.json` (`runtime`, `search`, `browser`, `mcp`) plus env-only operational knobs shown in a clearly labeled advanced env panel

Env-only settings will be grouped by subsystem, for example:
- session/history tuning
- workspace/memory/skills directory overrides
- transport and service URLs
- adapter-specific paths and toggles

Deprecated env vars that already have config equivalents will be shown as legacy overrides and discouraged.

**Rationale:**
- Users get the “obscure parameters” surface they asked for.
- We do not silently invent config fields the runtime does not support.
- Advanced operators can still fully configure the system from the TUI.

**Alternatives considered:**
- Hide env-only knobs entirely: rejected because it would miss real runtime behavior.
- Migrate every env-only knob into `openclaw.json` as part of this change: rejected because it broadens the change beyond onboarding.

### D6: Extract structured startup diagnostics from the init system

The setup flow will consume the same requirement checks as runtime startup through a structured diagnostics API that returns hard failures, soft warnings, affected files/settings, and remediation guidance without requiring the Next server to boot.

`initialize()` remains the runtime startup entrypoint, but it will delegate requirement gathering to shared logic instead of owning the only consumable output.

**Rationale:**
- The TUI doctor and runtime startup must agree.
- Reusing existing checks avoids a second, subtly different validator.
- The final verification screen can show the same pass/fail contract the runtime enforces.

**Alternatives considered:**
- Re-run setup-specific validation rules: rejected because it would drift from the runtime over time.

### D7: Workspace onboarding will be additive and non-destructive

The TUI will inspect the workspace directory and:
- create the default bootstrap files if the workspace is empty
- offer optional editing/seeding for `IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, and `TOOLS.md`
- leave existing files untouched unless the user explicitly edits or resets them

**Rationale:**
- Existing `initializeWorkspace()` already treats user content as authoritative.
- This makes onboarding useful both for new users and for upgrading an existing workspace.

### D8: Verification is a first-class final step

After writes complete, the TUI will run a verification pass that summarizes:
- hard requirements now passing or still failing
- optional capabilities still unconfigured
- generated paths and files
- next commands such as `bun run dev`

The verification step is read-only and will not launch long-running services.

**Rationale:**
- Users need closure that setup actually worked.
- Running the same diagnostics immediately catches incomplete configuration.

## Risks / Trade-offs

- [Ink adds a non-trivial dependency and React-based CLI complexity] → Keep UI thin and isolate business logic in `src/lib/setup/*`.
- [Writing JSON5 and env files can cause formatting churn] → Use deterministic serializers, preserve untouched data when possible, and show a write summary before save.
- [Some capabilities cannot be fully verified offline, such as Telegram webhook reachability or WhatsApp pairing] → Mark them as optional or follow-up actions in verification instead of blocking setup.
- [Advanced mode can become a junk drawer] → Mirror existing subsystem ownership and use progressive disclosure rather than a single giant form.
- [Shared init diagnostics may tempt setup to perform startup side effects] → Keep doctor/verification read-only and reserve service startup for `initialize()`.

## Migration Plan

1. Add the standalone setup command and shared setup library.
2. Extract structured diagnostics from the current init path without changing runtime behavior.
3. Add config/env/workspace discovery and persistence helpers.
4. Implement core onboarding screens, then advanced sections.
5. Update docs and examples to make the setup command the recommended first-run path.

**Rollback:** Remove the setup command and shared setup library, keep the extracted diagnostic helpers if they remain useful to runtime startup, and revert docs to the current manual setup flow.

## Open Questions

- Should the initial implementation include a non-interactive `--doctor` flag for CI and support workflows, or should that land immediately after the interactive path?
- Do we want the setup flow to offer an optional “start dev services now” handoff, or keep process launch explicitly separate from configuration?
