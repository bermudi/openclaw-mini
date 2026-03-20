# session-compaction (Delta)

## MODIFIED Requirements

### Requirement: Automatic session compaction at message threshold
The system SHALL automatically trigger session compaction when the session's token usage exceeds a configurable percentage of the agent's model context window (default: 50%, configurable via `OPENCLAW_SESSION_TOKEN_THRESHOLD`). Token counting SHALL use the existing `countTokens()` utility. If token counting fails, the system SHALL fall back to the existing message-count threshold (default: 40). The message-count threshold SHALL also act as a secondary trigger — compaction fires if either condition is met. Compaction SHALL only trigger when the message being appended has `role: 'user'` (user-turn boundary detection).

#### Scenario: Session token usage exceeds threshold
- **GIVEN** an agent's model has a 128,000-token context window and the session messages total 65,000 tokens (50.8%)
- **WHEN** a new `user` message is appended via `appendToContext`
- **THEN** the system SHALL trigger compaction

#### Scenario: Session below token threshold but above message count
- **GIVEN** a session has 45 messages totaling 5,000 tokens against a 128K context window (3.9%)
- **WHEN** a new `user` message is appended
- **THEN** the system SHALL trigger compaction because the message count (46) exceeds the message-count fallback threshold (40)

#### Scenario: Session below both thresholds
- **GIVEN** a session has 25 messages totaling 3,000 tokens against a 128K context window
- **WHEN** a new message is appended
- **THEN** no compaction SHALL occur

#### Scenario: Token counting fails, falls back to message count
- **GIVEN** the tokenizer throws an error when counting session tokens
- **WHEN** a new `user` message is appended and the session has 42 messages
- **THEN** the system SHALL fall back to the message-count threshold and trigger compaction

#### Scenario: Compaction deferred on assistant message
- **GIVEN** session token usage exceeds 50% of the context window
- **WHEN** a new `assistant` message is appended via `appendToContext`
- **THEN** compaction SHALL NOT be triggered; it SHALL be deferred until the next `user` message

#### Scenario: Compaction preserves the existing summary
- **GIVEN** a session was previously compacted and contains a summary message from the prior compaction
- **WHEN** compaction triggers again
- **THEN** the prior summary message SHALL be included in the content sent to the model for re-summarization, ensuring cumulative context is not lost

## ADDED Requirements

### Requirement: Per-agent context window and threshold resolution
The compaction trigger SHALL resolve the context window and compaction threshold using the agent's per-agent configuration (see `agent-context-config` spec). The context window resolution follows: `agent.contextWindowOverride` → `ModelCatalog(agent.model)` → `ModelCatalog(globalModel)` → 128,000. The threshold resolution follows: `agent.compactionThreshold` → `OPENCLAW_SESSION_TOKEN_THRESHOLD` → 0.5.

#### Scenario: Agent with custom model and threshold
- **GIVEN** agent has `model: "gpt-4.1-mini"` (128K context) and `compactionThreshold: 0.3`
- **WHEN** the compaction trigger evaluates
- **THEN** the token threshold SHALL be calculated as 30% of 128,000 = 38,400 tokens

#### Scenario: Agent with context window override
- **GIVEN** agent has `contextWindowOverride: 32000` and `compactionThreshold: null`
- **WHEN** the compaction trigger evaluates
- **THEN** the token threshold SHALL be calculated as 50% of 32,000 = 16,000 tokens

#### Scenario: Agent with no overrides uses global defaults
- **GIVEN** agent has `model: null`, `contextWindowOverride: null`, `compactionThreshold: null`, and the global model is `gpt-4.1-mini`
- **WHEN** the compaction trigger evaluates
- **THEN** the system SHALL use ModelCatalog's context window for `gpt-4.1-mini` and the default 50% threshold
