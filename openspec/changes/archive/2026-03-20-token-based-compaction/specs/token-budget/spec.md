# token-budget (Delta)

## ADDED Requirements

### Requirement: Token counting utility available to compaction
The `countTokens()` function in `token-counter.ts` SHALL be usable by the session compaction service to count tokens across an array of session messages. No changes to the function signature are required — this requirement documents that `countTokens` is now consumed by both the prompt assembly (AgentExecutor) and the compaction trigger (SessionService).

#### Scenario: Compaction uses countTokens
- **GIVEN** a session has 35 messages
- **WHEN** the compaction trigger evaluates whether to compact
- **THEN** it SHALL call `countTokens()` on the concatenated message content to determine total token usage
