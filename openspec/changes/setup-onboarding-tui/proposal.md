## Why

First-run setup is currently spread across `README.md`, `SETUP.md`, `.env`, `openclaw.json`, workspace markdown files, and fail-fast startup errors. That makes OpenClaw Mini feel harder to boot than it needs to be, and it hides important optional capabilities like channels, MCP, browser control, search, exec, and memory tuning behind scattered docs and obscure environment variables.

## What Changes

- Add an interactive terminal onboarding flow, exposed as a dedicated setup command, to guide first-time and repeat configuration.
- Add a read-only doctor/verification mode that inspects the current install, reports missing requirements, and links each failure to the exact setting or file to fix.
- Detect and prefill existing `openclaw.json`, `.env` values, workspace bootstrap files, and channel settings so setup updates the current installation instead of overwriting it.
- Generate and update the canonical setup artifacts: `openclaw.json`, local env files, workspace bootstrap markdown, and optional channel-specific settings.
- Add an advanced configuration path that surfaces runtime sections already supported today (`runtime`, `search`, `browser`, `mcp`, exec, memory) plus currently env-only operational knobs that advanced operators may want to tune.
- Reuse the existing startup validation checks through structured diagnostics so the setup flow and runtime startup report the same requirements and remediation guidance.
- Add a final verification step that runs init checks after setup and summarizes what is ready, what remains optional, and the next commands to run.

## Capabilities

### New Capabilities

- `setup-onboarding`: Interactive terminal onboarding and doctor workflows for configuring providers, auth, workspace bootstrap, optional channels, and advanced runtime settings.

### Modified Capabilities

- `startup-validation`: Validation results become consumable as structured diagnostics so the onboarding flow can present the same hard failures and soft warnings before startup.
- `runtime-config`: Guided setup can author and update supported config sections, including advanced runtime, search, browser, MCP, exec, and memory settings.
- `workspace-bootstrap`: First-run onboarding can seed and customize workspace bootstrap files without overwriting existing user-authored content.

## Impact

- **New CLI/TUI surface**: setup command and Ink-based onboarding screens
- **Config management**: readers/writers for `openclaw.json` and local env files with safe merge behavior
- **Startup checks**: shared diagnostics between runtime startup and the setup doctor flow
- **Workspace setup**: first-run bootstrap seeding and optional persona/profile editing
- **Docs**: `README.md`, `SETUP.md`, `.env.example`, and example config updates to match the new guided flow
- **Dependencies**: terminal UI dependency for the onboarding experience plus any small supporting libraries for prompts and env/config persistence
