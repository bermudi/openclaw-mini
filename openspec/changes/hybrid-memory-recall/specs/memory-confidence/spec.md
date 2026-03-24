# memory-confidence (Delta)

## MODIFIED Requirements

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
