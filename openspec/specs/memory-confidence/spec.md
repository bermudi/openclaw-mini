# memory-confidence Specification

## Purpose
TBD - created by archiving change memory-quality-lifecycle. Update Purpose after archive.
## Requirements
### Requirement: Confidence field on memories
Every memory entry SHALL have a `confidence` field (Float, range 0.0–1.0, default 1.0). Memories created explicitly by the user or system SHALL have confidence 1.0. The field SHALL be stored in the database and returned in all memory API responses.

#### Scenario: Explicit memory has full confidence
- **WHEN** `setMemory` is called directly (not by the reflector)
- **THEN** the memory SHALL be created or updated with `confidence: 1.0`

#### Scenario: Confidence returned in API
- **WHEN** `GET /api/agents/:id/memory` returns memories
- **THEN** each memory object SHALL include a `confidence` field

### Requirement: Last reinforced timestamp
Every memory entry SHALL have a `lastReinforcedAt` timestamp (nullable DateTime). This field SHALL be set to the current time whenever the memory is created, updated, or reinforced by the reflector. It SHALL be used as the reference point for decay calculations.

#### Scenario: New memory sets reinforcement timestamp
- **WHEN** a memory is created via `setMemory`
- **THEN** `lastReinforcedAt` SHALL be set to the current time

#### Scenario: Update resets reinforcement timestamp
- **WHEN** an existing memory is updated via `setMemory`
- **THEN** `lastReinforcedAt` SHALL be reset to the current time

### Requirement: Confidence-aware context loading
The memory recall pipeline SHALL use memory confidence as a recall policy control during automatic prompt assembly and explicit memory retrieval. Automatic prompt recall SHALL exclude memories below a configurable recall threshold and SHALL prioritize higher-confidence candidates after retrieval fusion and before token-budget filtering. Explicit memory search and exact retrieval SHALL return confidence metadata for every result and MAY expose lower-confidence memories without automatically injecting them into prompt context.

#### Scenario: Low-confidence memories excluded from automatic recall
- **GIVEN** an agent has memories with confidences 0.92, 0.74, and 0.18 and the automatic recall threshold is 0.40
- **WHEN** automatic prompt recall runs
- **THEN** the memory with confidence 0.18 SHALL be excluded from the recall candidate set before prompt injection

#### Scenario: Explicit search exposes low-confidence memory with metadata
- **GIVEN** an agent has a low-confidence memory that matches a `memory_search` query
- **WHEN** the explicit search is executed
- **THEN** the result SHALL include the matching memory with its confidence metadata and SHALL NOT cause the memory to be auto-injected into prompt context

### Requirement: Confidence decay
A scheduled decay job SHALL reduce the confidence of memories that have not been reinforced recently. The decay formula SHALL be: `newConfidence = confidence × (0.5 ^ (daysSinceReinforced / halfLifeDays))`. The default half-life SHALL be 14 days, configurable via `OPENCLAW_MEMORY_DECAY_HALF_LIFE_DAYS`.

#### Scenario: Memory decays after 14 days
- **GIVEN** a memory has confidence 1.0 and `lastReinforcedAt` 14 days ago
- **WHEN** the decay job runs
- **THEN** the memory's confidence SHALL be updated to approximately 0.5

#### Scenario: Recently reinforced memory does not decay
- **GIVEN** a memory has `lastReinforcedAt` 1 day ago
- **WHEN** the decay job runs
- **THEN** the memory's confidence SHALL decrease negligibly (less than 5%)

### Requirement: Soft-delete at confidence floor
Memories whose confidence falls below a configurable floor (default: 0.1) SHALL be soft-deleted by setting their category to `archived`. Archived memories SHALL NOT be loaded into agent context but SHALL remain in the database for potential recovery.

#### Scenario: Memory falls below floor
- **GIVEN** a memory has confidence 0.08 after decay
- **WHEN** the decay job processes it
- **THEN** the memory's category SHALL be set to `archived`

#### Scenario: Archived memory excluded from context
- **GIVEN** a memory has category `archived`
- **WHEN** `loadAgentContext()` is called
- **THEN** the archived memory SHALL NOT be included

### Requirement: Decay job scheduling
The confidence decay job SHALL run as part of the existing daily cleanup schedule (alongside `cleanupHistoryArchives` and `cleanupOldSessions`). It SHALL process all non-archived memories for all agents in a single batch.

#### Scenario: Decay runs daily
- **WHEN** the daily cleanup job executes
- **THEN** the decay function SHALL be called and all eligible memories SHALL have their confidence updated

