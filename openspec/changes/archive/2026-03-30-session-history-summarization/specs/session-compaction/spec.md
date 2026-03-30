## ADDED Requirements

### Requirement: Summarization model selection
The compaction LLM call SHALL use the same model resolution chain as normal agent task execution: `agent.model` → global configured model → default fallback. No separate model configuration is required for compaction. The model used for summarization SHALL be logged alongside the compaction audit event.

#### Scenario: Agent has a configured model
- **WHEN** compaction fires for an agent with `model: "gpt-4.1"` configured
- **THEN** the LLM summary call SHALL use `gpt-4.1`

#### Scenario: Agent has no model configured, uses global default
- **WHEN** compaction fires for an agent with `model: null` and the global model is `gpt-4.1-mini`
- **THEN** the LLM summary call SHALL use `gpt-4.1-mini`

### Requirement: Structured summarization prompt
The LLM summary call SHALL use a hardcoded internal prompt that instructs the model to produce a structured summary containing: (1) session intent — what the user is trying to accomplish, (2) key decisions — choices made or confirmed, (3) artifacts — files, configurations, or outputs created, (4) open questions — unresolved items, (5) next steps — what the agent should do next. The prompt SHALL specify that the output will replace the full message history as the agent's working memory.

#### Scenario: Summary contains required structure
- **WHEN** compaction generates a summary
- **THEN** the summary text SHALL include sections covering session intent, key decisions, and next steps at minimum

#### Scenario: Summary is prefixed with session marker
- **WHEN** compaction generates a summary
- **THEN** the resulting `SessionMessage` SHALL have `role: "system"` and content beginning with `[Session Summary]`

### Requirement: Graceful degradation when summarization fails
If the LLM call for generating the summary throws an error (network failure, timeout, model error, invalid response), the system SHALL log a warning with the session ID, agent ID, and error message. Compaction SHALL abort without deleting any messages. The session SHALL continue accepting new messages normally. The next user-turn append SHALL re-evaluate the compaction threshold and MAY trigger a new compaction attempt.

#### Scenario: LLM call throws a network error
- **WHEN** the LLM summary call fails with a network error
- **THEN** no `SessionMessage` rows SHALL be deleted, the warning SHALL be logged, and `appendToContext` SHALL complete without throwing

#### Scenario: LLM returns an empty response
- **WHEN** the LLM summary call returns an empty string or whitespace-only content
- **THEN** the system SHALL treat this as a failure, log a warning, and abort compaction without deleting messages

#### Scenario: Subsequent message triggers retry
- **WHEN** compaction failed on the previous user message and the session still exceeds the token threshold
- **WHEN** a new user message is appended
- **THEN** the system SHALL attempt compaction again
