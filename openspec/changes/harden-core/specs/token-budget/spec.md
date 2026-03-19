# token-budget Specification

## Purpose
Token-aware context assembly that respects model context window limits when building prompts from session, memory, and workspace sources, replacing hard character caps.

## ADDED Requirements

### Requirement: Token-aware prompt assembly
The `AgentExecutor.buildPrompt` method SHALL assemble the prompt within a token budget derived from the active model's context window size. Token counting SHALL use the `gpt-tokenizer` library. The total budget SHALL be the model's context window minus a configurable response reserve (default: 20% of context window, minimum 1,000 tokens).

#### Scenario: Budget calculated for a model with 128K context
- **GIVEN** the active model has a 128,000-token context window and the response reserve is 20%
- **WHEN** the prompt is assembled
- **THEN** the total prompt token budget SHALL be 102,400 tokens

#### Scenario: Budget calculated for a small model
- **GIVEN** the active model has a 4,096-token context window and the response reserve is 20%
- **WHEN** the prompt is assembled
- **THEN** the total prompt token budget SHALL be 3,276 tokens

### Requirement: Priority ordering for context allocation
The prompt budget SHALL be allocated in the following priority order:

1. **System prompt** (workspace bootstrap context) — always included in full
2. **Task-specific content** (the message/event payload section) — always included in full
3. **Session context** — filled up to the remaining budget after system prompt and task content
4. **Memory snapshot** — gets whatever budget remains after session context

#### Scenario: Small context fits entirely
- **GIVEN** the system prompt uses 2,000 tokens, task content uses 500 tokens, session context uses 1,000 tokens, and memory snapshot uses 800 tokens
- **WHEN** the budget is 102,400 tokens
- **THEN** all four sections SHALL be included in full without truncation

#### Scenario: Large session gets truncated to budget
- **GIVEN** the system prompt uses 3,000 tokens, task content uses 500 tokens, and session context would use 100,000 tokens
- **WHEN** the budget is 102,400 tokens
- **THEN** the session context SHALL be truncated to fit within 98,900 tokens (budget minus system prompt and task content), and memory snapshot SHALL be excluded

#### Scenario: Memory excluded when session fills budget
- **GIVEN** session context consumes all remaining budget after system prompt and task content
- **WHEN** the prompt is assembled
- **THEN** the memory snapshot section SHALL be omitted entirely from the prompt

### Requirement: Respects model context limit
The system SHALL maintain a registry of known model context window sizes. For unrecognized models, the system SHALL default to a conservative context window size (default: 8,192 tokens). The `model-provider.ts` module SHALL expose a function to retrieve the context window size for the active model.

#### Scenario: Known model returns correct context size
- **WHEN** the active model is `gpt-4.1-mini`
- **THEN** the system SHALL return the known context window size for that model

#### Scenario: Unknown model uses default
- **WHEN** the active model is `custom-model-v1` and is not in the registry
- **THEN** the system SHALL use 8,192 tokens as the context window size

### Requirement: Graceful degradation
If token counting fails (e.g., the tokenizer throws an error for unexpected input), the system SHALL fall back to a character-based estimation (4 characters per token) and log a warning. The prompt assembly SHALL never fail due to a tokenizer error.

#### Scenario: Tokenizer error triggers fallback
- **GIVEN** the tokenizer throws an error when encoding a session message
- **WHEN** the prompt is assembled
- **THEN** the system SHALL estimate tokens using character count divided by 4, log a warning, and produce a valid prompt

### Requirement: Session context truncation preserves structure
When session context must be truncated to fit the budget, truncation SHALL remove the oldest messages first. If a compaction summary message exists, it SHALL be preserved (never truncated) as it represents the compressed history. Truncation SHALL operate on whole messages, not partial message content.

#### Scenario: Truncation keeps summary and recent messages
- **GIVEN** session context contains a summary message and 15 regular messages, and only 8 messages fit in the budget
- **WHEN** truncation is applied
- **THEN** the summary message and the 7 most recent regular messages SHALL be included; the 8 oldest regular messages SHALL be dropped
