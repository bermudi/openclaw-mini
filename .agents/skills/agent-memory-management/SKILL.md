---
name: agent-memory-management
description: Implements stateful AI agents using Sessions (short-term history) and Memory (long-term persistence). Use this skill when building agents that need to remember user preferences, track multi-turn state, or maintain context across different interactions.
license: Apache-2.0
metadata:
  version: "1.0"
  topic: context-engineering
---

# Agent Memory & Session Management

This skill provides a framework for **Context Engineering**—the process of dynamically assembling information within an LLM's context window to create stateful, personalized AI experiences.

## Core Concepts

1.  **Sessions**: The "workbench" for a single conversation. It holds the chronological history (events) and temporary working data (state).
2.  **Memory**: The "filing cabinet" for long-term persistence. It captures and consolidates key insights across multiple sessions.

## Implementation Workflow

### 1. Manage the Session (The "Now")
- **Capture Events**: Record every user input, model response, tool call, and tool output.
- **Maintain State**: Use a structured "scratchpad" for temporary data (e.g., items in a shopping cart).
- **Compaction**: Prevent context overflow by using strategies like:
    - **Sliding Window**: Keep only the last $N$ turns.
    - **Summarization**: Periodically summarize older messages to save tokens.

See [Session Management Details](references/SESSIONS.md) for compaction strategies.

### 2. Generate Memory (The "Always")
Memory generation is an LLM-driven ETL pipeline:
- **Extraction**: Filter the session log for meaningful facts, preferences, and goals.
- **Consolidation**: Merge new insights with existing memories, resolving conflicts and deleting invalidated data.
- **Provenance**: Track the source and "freshness" of each memory to assess trustworthiness.

See [Memory Lifecycle Deep-Dive](references/MEMORY.md) for extraction and consolidation logic.

### 3. Retrieve and Inject (The "Inference")
- **Retrieval**: Use a blended score of **Relevance** (semantic similarity), **Recency** (time-based), and **Importance** (significance).
- **Injection**:
    - **System Instructions**: Best for stable, global memories (e.g., user profiles).
    - **Conversation History**: Best for transient, episodic memories.
    - **Memory-as-a-Tool**: Allow the agent to decide when to fetch context.

See [Retrieval & Inference Strategies](references/RETRIEVAL.md) for placement guidelines.

## Best Practices
- **Strict Isolation**: Ensure memories are scoped per-user to prevent data leaks.
- **PII Redaction**: Redact sensitive information before persisting to long-term storage.
- **Asynchronous Processing**: Run memory generation in the background to avoid blocking the user experience.
