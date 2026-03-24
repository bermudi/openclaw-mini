# Session Management & Compaction

Sessions act as the container for an entire conversation. In production, these must be stored in a persistent database (e.g., Spanner, Redis) to maintain state across stateless API calls.

## Event Types
A session log should track:
- `user_input`: Text, audio, or image data from the user.
- `agent_response`: The model's reply.
- `tool_call`: The agent's decision to invoke an external API.
- `tool_output`: The raw data returned from the tool.

## Managing Long Context
As conversations grow, you must compact the history to manage costs and avoid "context rot."

### Compaction Strategies
1.  **Keep Last N Turns**: Simple and effective for short-term tasks.
2.  **Token-Based Truncation**: Count tokens from the most recent message backward until a limit (e.g., 4000 tokens) is reached.
3.  **Recursive Summarization**: Use an LLM to summarize the oldest messages. Prefix this summary to the remaining verbatim messages.

### Triggering Compaction
- **Count-Based**: Trigger when turn count or token size exceeds a threshold.
- **Time-Based**: Trigger after a period of inactivity (e.g., 30 minutes).
- **Event-Based**: Trigger upon task completion or topic change.
