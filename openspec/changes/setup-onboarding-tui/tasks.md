## 1. CLI Foundation

- [ ] 1.1 Add the setup command entrypoint, package script, and Ink-based dependencies needed for a standalone Bun TUI.
- [ ] 1.2 Create the shared setup module structure and types for discovery, planning, persistence, diagnostics, and screen state.

## 2. Shared Diagnostics And Discovery

- [ ] 2.1 Extract structured, read-only startup diagnostics from the existing init checks while preserving current runtime startup behavior.
- [ ] 2.2 Implement setup discovery for config path resolution, env sources, workspace state, existing providers, auth settings, and optional channel configuration.

## 3. Persistence Helpers

- [ ] 3.1 Implement `openclaw.json` creation/update helpers that write schema-valid provider, agent, runtime, search, browser, and MCP settings.
- [ ] 3.2 Implement env persistence helpers for `.env.local`, including secret storage, credential refs, and advanced env-only overrides.
- [ ] 3.3 Implement workspace bootstrap helpers that seed defaults, edit existing files, and support explicit single-file resets without touching unrelated files.

## 4. Onboarding Experience

- [ ] 4.1 Build the core Ink onboarding flow for database, provider/model selection, internal auth, and workspace bootstrap setup.
- [ ] 4.2 Add optional integration screens for Telegram, WhatsApp, and other setup-adjacent service settings.
- [ ] 4.3 Add advanced configuration screens for runtime tuning, exec, memory, search, browser, MCP, and env-only operational knobs.
- [ ] 4.4 Add the read-only doctor workflow and post-save verification summary using the shared diagnostics API.

## 5. Verification And Documentation

- [ ] 5.1 Add regression tests for diagnostics extraction, config/env persistence, advanced override handling, and non-destructive workspace onboarding.
- [ ] 5.2 Update `README.md`, `SETUP.md`, `.env.example`, and example config/documentation so `bun run setup` becomes the recommended first-run path.
