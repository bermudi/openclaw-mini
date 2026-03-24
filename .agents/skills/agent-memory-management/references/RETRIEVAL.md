# Retrieval & Inference Strategies

Retrieval is the "hot path" of an agent's response and must be optimized for latency (target < 200ms).

## Retrieval Dimensions
Don't rely solely on vector similarity. Use a blended score:
1.  **Relevance**: Semantic similarity to the current query.
2.  **Recency**: How recently the memory was created/updated.
3.  **Importance**: How critical the memory is (defined at generation time).

## Timing for Retrieval
- **Proactive**: Load memories automatically at the start of every turn. High availability but adds latency to every turn.
- **Reactive (Memory-as-a-Tool)**: The agent calls a `load_memory` tool only when it needs more context. More efficient but requires an extra LLM reasoning step.

## Placement for Inference
| Placement | Best For | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **System Instructions** | Stable, global facts (User Profile) | High authority, clean history | Risk of "over-influence" |
| **Conversation History** | Transient, episodic facts | Flexible, "in-the-moment" | Can be noisy, increases token cost |
| **Tool Output** | Specific data lookups | Precise, on-demand | Requires tool-use capability |

## Optimization Techniques
- **Query Rewriting**: Use an LLM to expand ambiguous user queries into precise search terms.
- **Reranking**: Fetch the top 50 results via similarity, then use a smaller model to rerank the top 5.
- **Caching**: Store the results of expensive retrieval queries for identical subsequent turns.
