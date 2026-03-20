# agent-context-config Specification

## Purpose
Per-agent model, context window, and compaction threshold configuration, allowing each agent to run independently tuned for its use case and cost profile.

## ADDED Requirements

### Requirement: Per-agent model field
The Agent table SHALL have a nullable `model` column (String). When set, it overrides the global `agent.model` from RuntimeConfig for all operations involving that agent (prompt assembly, compaction trigger, model fallback).

#### Scenario: Agent with custom model
- **GIVEN** agent `research_agent` has `model: "claude-3-7-sonnet-latest"`
- **WHEN** the agent executes a task
- **THEN** the system SHALL use `claude-3-7-sonnet-latest` instead of the global default model

#### Scenario: Agent without custom model uses global
- **GIVEN** agent `quick_bot` has `model: null`
- **WHEN** the agent executes a task
- **THEN** the system SHALL use the global `agent.model` from RuntimeConfig

### Requirement: Per-agent context window override
The Agent table SHALL have a nullable `contextWindowOverride` column (Int). When set, it overrides the ModelCatalog lookup entirely — the system uses this value as the context window size for all token budget and compaction calculations.

#### Scenario: Agent with context window override
- **GIVEN** agent `cheap_bot` has `contextWindowOverride: 32000`
- **WHEN** the compaction trigger evaluates or prompt budget is calculated
- **THEN** the system SHALL use 32,000 as the context window size, regardless of what ModelCatalog reports for the agent's model

#### Scenario: Agent without override uses ModelCatalog
- **GIVEN** agent `default_bot` has `contextWindowOverride: null` and `model: "gpt-4.1-mini"`
- **WHEN** the context window is needed
- **THEN** the system SHALL look up `gpt-4.1-mini` in ModelCatalog and use the reported context window size

### Requirement: Per-agent compaction threshold
The Agent table SHALL have a nullable `compactionThreshold` column (Float, range 0.1–0.9). When set, it overrides both the `OPENCLAW_SESSION_TOKEN_THRESHOLD` environment variable and the system default (0.5) for that agent's sessions.

#### Scenario: Agent with low threshold for cost savings
- **GIVEN** agent `frugal_bot` has `compactionThreshold: 0.3`
- **WHEN** the compaction trigger evaluates
- **THEN** compaction SHALL trigger when session tokens exceed 30% of the context window

#### Scenario: Agent with high threshold for deep conversations
- **GIVEN** agent `research_agent` has `compactionThreshold: 0.7`
- **WHEN** the compaction trigger evaluates
- **THEN** compaction SHALL trigger when session tokens exceed 70% of the context window

#### Scenario: Agent without threshold uses global default
- **GIVEN** agent `default_bot` has `compactionThreshold: null`
- **WHEN** the compaction trigger evaluates
- **THEN** the system SHALL use `OPENCLAW_SESSION_TOKEN_THRESHOLD` (or 0.5 if unset)

### Requirement: Context window resolution order
The system SHALL resolve the effective context window size in the following priority order:
1. `agent.contextWindowOverride` (if set)
2. `ModelCatalog.getContextWindow(agent.model)` (if agent has a custom model)
3. `ModelCatalog.getContextWindow(globalConfig.model)` (global default model)
4. 128,000 tokens (hardcoded floor)

#### Scenario: Full resolution chain
- **GIVEN** agent has `contextWindowOverride: null`, `model: null`, and the global model is `gpt-4.1-mini`
- **WHEN** the context window is resolved
- **THEN** the system SHALL use `ModelCatalog.getContextWindow("gpt-4.1-mini")`

### Requirement: Validation on write
When setting `compactionThreshold`, the system SHALL validate the value is between 0.1 and 0.9 (inclusive). Values outside this range SHALL be rejected with a validation error. When setting `contextWindowOverride`, the value MUST be a positive integer of at least 1,000.

#### Scenario: Invalid compaction threshold rejected
- **WHEN** an agent update sets `compactionThreshold: 0.05`
- **THEN** the update SHALL be rejected with a validation error

#### Scenario: Valid compaction threshold accepted
- **WHEN** an agent update sets `compactionThreshold: 0.6`
- **THEN** the update SHALL succeed
