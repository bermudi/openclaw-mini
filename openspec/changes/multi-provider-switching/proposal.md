## Why

Users want to switch between providers and models during a chat session without restarting the application. The current system loads provider/model at startup and requires config file edits + hot-reload for changes. Inline commands like `/provider openai` or `/model gpt-4.1-mini` would enable rapid experimentation and provider fallback during conversations.

## What Changes

- **Inline provider switching**: Add `/provider <name>` command to switch active provider mid-session
- **Inline model switching**: Add `/model <name>` command to switch active model mid-session
- **Session-scoped state**: Active provider/model becomes per-session state, not global config
- **Provider availability**: All configured providers in `openclaw.json` are available for switching
- **Model listing**: Add `/models` command to list available models for the active provider

**Dependency:** Requires `standardize-env-vars` change (providers defined in `openclaw.json` only).

## Capabilities

### New Capabilities

- `provider-switching`: Runtime provider switching via inline commands without restart
- `model-switching`: Runtime model switching via inline commands without restart
- `model-listing`: List available models for the active provider via `/models` command
- `session-provider-state`: Per-session active provider/model state, independent of global config

### Modified Capabilities

None - this adds new functionality without changing existing behaviors.

## Impact

- **Session state**: Add `activeProvider` and `activeModel` to session state
- **Command parsing**: Add new inline commands (`/provider`, `/model`, `/models`) to message parser
- **Provider registry**: Expose list of available providers for `/provider` command completion
- **Model catalog**: Add provider method to list available models for `/models` command
- **Config unchanged**: Default provider/model still comes from `openclaw.json`; switching is session-only
- **Concurrency**: Switch commands are processed sequentially in the message queue; no race conditions with in-flight requests (each request uses session state at time of processing)
