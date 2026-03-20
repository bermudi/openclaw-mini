## Context

Users can currently only change provider/model by editing `openclaw.json` and relying on hot-reload. For rapid experimentation or switching during a conversation, inline commands are more natural. The provider registry already maintains all configured providers; we need to expose them via commands and track active provider/model per-session.

## Goals / Non-Goals

**Goals:**
- Add `/provider <name>` command to switch active provider
- Add `/model <name>` command to switch active model
- Track active provider/model per-session (not global)
- List available providers for discovery

**Non-Goals:**
- Changing the config file format
- Persisting switches across sessions (session-scoped only)
- Adding new providers via commands (config file only)

## Decisions

### Decision 1: Session-scoped state

**Choice:** Active provider/model is stored in session state, not global config.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    State Hierarchy                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Config (global, persistent)                                        │
│  ───────────────────────────────────────────────────────────────────│
│  openclaw.json defines:                                             │
│  - providers: { openai, anthropic, openrouter, ... }                │
│  - agent.provider: "openai"      ← default at startup               │
│  - agent.model: "gpt-4.1-mini"   ← default at startup               │
│                                                                      │
│  Session State (per-conversation, ephemeral)                        │
│  ───────────────────────────────────────────────────────────────────│
│  session.activeProvider: "openai"    ← switched via /provider       │
│  session.activeModel: "gpt-4.1-mini" ← switched via /model          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Alternatives considered:**
- Global state → Rejected: multiple concurrent sessions would conflict
- Persist to config → Rejected: user might not want to save temporary switches

**Rationale:** Each session starts with defaults from config, can switch independently during the conversation, and switches don't affect other sessions or persist.

### Decision 2: Command format

**Choice:** Use `/provider <name>` and `/model <name>` format.

**Alternatives considered:**
- `/switch provider <name>` → More verbose, not needed
- Natural language "use openai" → Ambiguous, harder to parse

**Rationale:** Consistent with existing `/` command pattern, explicit, easy to discover.

### Decision 3: Validation at command time

**Choice:** Validate provider/model exists when command is issued, show error if invalid.

**Rationale:** Immediate feedback is better than failing silently on next message.

### Decision 4: Concurrency and race conditions

**Choice:** Switch commands are processed in the message queue, same as regular messages. No special handling needed.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Message Queue Processing                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Queue: [msg1, /provider anthropic, msg2, /model claude-3, msg3]   │
│                                                                      │
│  Processing (sequential):                                           │
│  1. msg1         → uses openai/gpt-4.1-mini (defaults)             │
│  2. /provider    → switches session to anthropic                   │
│  3. msg2         → uses anthropic/gpt-4.1-mini                     │
│  4. /model       → switches session to claude-3                    │
│  5. msg3         → uses anthropic/claude-3                         │
│                                                                      │
│  No race conditions: each request reads session state at processing │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Rationale:** The existing message queue ensures sequential processing. Each request reads session state at processing time, so no special locking needed.

### Decision 5: Reconnection behavior

**Choice:** Session state is tied to session ID. Reconnecting with the same session ID preserves switches; new session ID gets config defaults.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Reconnection Scenarios                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Scenario A: Same session ID (e.g., WebSocket reconnect)           │
│  ───────────────────────────────────────────────────────────────────│
│  User switches to anthropic → disconnects → reconnects same ID     │
│  → Session state preserved → still on anthropic                    │
│                                                                      │
│  Scenario B: New session ID (e.g., new browser tab)                │
│  ───────────────────────────────────────────────────────────────────│
│  User switches to anthropic → opens new tab (new session ID)       │
│  → New session → config defaults (openai)                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Rationale:** Session persistence is by session ID, which is the existing pattern for session state. No special handling needed — it's how sessions already work.

## Risks / Trade-offs

- **Model name validation limited** → Can't validate model exists for provider without API call; accept any string, fail on next request
- **No cross-provider model validation** → User could switch to a model that doesn't exist for that provider; error shows at inference time

## Migration Plan

1. Add `activeProvider` and `activeModel` to session state type
2. Add command parsing for `/provider` and `/model`
3. Implement switch logic with validation
4. Add `/providers` command to list available providers
5. Update agent to use session state instead of config for inference

## Open Questions

None. `/models` command is explicitly out of scope for this change (future enhancement).
