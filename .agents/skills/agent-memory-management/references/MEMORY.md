# Memory Lifecycle: Extraction & Consolidation

Memory transforms raw conversational noise into structured, persistent knowledge.

## 1. Extraction
The goal is to identify "meaningful" information. This is defined by the agent's purpose.
- **Topic Definitions**: Provide the LLM with specific categories to look for (e.g., "User Personal Info", "Business Feedback").
- **Few-Shot Examples**: Show the LLM examples of raw text and the corresponding extracted "fact."

## 2. Consolidation
Consolidation ensures the memory corpus remains coherent and accurate.
- **Merge**: Combine "I want to go to NYC" and "I'm planning a trip to New York" into a single entity.
- **Update**: Change "User is interested in marketing" to "User is leading a Q4 marketing project."
- **Delete**: Remove memories that are contradicted by newer information or have decayed over time.

## 3. Provenance & Trust
Track the lineage of every memory:
- **Source Type**: Bootstrapped (high trust), User Input (explicit = high, implicit = medium), Tool Output (low/short-term).
- **Freshness**: Older memories should generally carry less weight if they conflict with newer ones.
- **Corroboration**: Increase confidence when multiple sources provide consistent information.

## 4. Memory Scope
- **User-Level**: Persistent across all sessions for a specific user.
- **Session-Level**: Isolated to a single conversation (used for compaction).
- **Application-Level**: Shared baseline knowledge for all users (must be sanitized).
