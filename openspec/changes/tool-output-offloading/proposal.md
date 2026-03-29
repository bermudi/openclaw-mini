## Why

Large tool results accumulate in conversation history across iterations, consuming context window tokens that can never be reclaimed. On a long-running task with 15–20 tool calls averaging 2,000–4,000 tokens each, intermediate results alone can exhaust half the context window — crowding out session history and memory that the agent actually needs. There is currently no mechanism to shed this weight once a tool result is delivered.

## What Changes

- A new offloading wrapper intercepts tool results that exceed a configurable token threshold (default: 2,000 tokens) and writes the full content to a scoped workspace file under `data/workspace/offload/`
- The original tool result in the conversation is replaced with a compact reference: file path, line count, and a 10-line preview
- The agent can retrieve full content using existing workspace tools (`read_workspace_file`, `list_workspace_files`) whenever needed
- Offload files are scoped to a task execution and cleaned up after the task completes
- Threshold is configurable via `OPENCLAW_OFFLOAD_TOKEN_THRESHOLD` (default: 2,000)
- Offloading is opt-out per tool via a `noOffload` flag for tools that return structured data the executor must inspect (e.g., `spawn_subagent`, `deliver_message`)

## Capabilities

### New Capabilities

- `tool-output-offloading`: Automatic detection and workspace-offloading of large tool results, replacing bulky conversation entries with compact file references and previews

### Modified Capabilities

- `token-budget`: Offloading directly reduces the token footprint of tool results in the conversation, making token budget allocation more predictable on long tasks; the priority ordering remains unchanged but effective tool-result cost is now bounded

## Impact

- `src/lib/tools.ts` — add `noOffload?: boolean` flag to tool definition metadata; wrap `getToolsForAgent` / `getToolsByNames` output with offloading interceptor
- `src/lib/services/agent-executor.ts` — integrate offload context (task ID, cleanup registry) into tool execution context
- `src/lib/services/workspace-service.ts` — add `writeOffloadFile`, `cleanOffloadFiles` helpers scoped to `data/workspace/offload/`
- `src/lib/utils/token-counter.ts` — no changes; reused for threshold evaluation
- New env var: `OPENCLAW_OFFLOAD_TOKEN_THRESHOLD`
- No schema migrations required
