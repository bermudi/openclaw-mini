## Why

When an agent reads a file or runs a command on behalf of the user, it currently must repeat the entire output as part of its LLM response. This wastes tokens and adds latency — the model reads the file content, then generates a response that parrots it back. Tools need a way to flag output as "show this directly to the user" so it can bypass the LLM's response generation and go straight to the delivery pipeline. This is especially important for `exec_command` (where command stdout should go directly to chat) and `read_file` (where the user asked to see a file's contents).

Sub-agents also need a way to surface outputs to the user. Currently a sub-agent's response is consumed by the parent agent, which may or may not relay it. Sub-agents should be able to flag content for surfacing, and the parent agent should see those flags in the tool result and choose whether to pass them through.

## What Changes

- **`SurfaceDirective` type**: A new type that tools can attach to their `ToolResult` to flag content for direct delivery to chat — supports both text and file content
- **`emit_to_chat` tool**: A dedicated tool agents can call to push arbitrary text directly to chat without including it in the LLM response
- **`ToolResult` extension**: `ToolResult` gains an optional `surface` field containing an array of `SurfaceDirective`s
- **Executor surface collection**: After `generateText()` completes, the agent executor collects all surface directives from tool results and enqueues them as separate deliveries — surfaces are delivered before the LLM response
- **`exec_command` integration**: The `surfaceOutput` parameter on `exec_command` uses the surface directive mechanism to push stdout directly to chat
- **Sub-agent surface bubbling**: `spawn_subagent` collects surface directives from the child task and returns them in its tool result data, so the parent agent can see and re-emit them

## Capabilities

### New Capabilities
- `surface-directive`: Side-channel mechanism for tools to deliver content directly to chat, bypassing LLM response generation
- `emit-to-chat`: Dedicated tool for agents to push text directly to chat

### Modified Capabilities
- `outbound-delivery`: Executor collects surface directives from tool results and enqueues them as deliveries

## Impact

- **Files**: Type extension in `src/lib/types.ts` or `src/lib/tools.ts`, executor changes in `src/lib/services/agent-executor.ts`, tool updates in `src/lib/tools.ts`
- **Dependencies**: None
- **Schema**: No database changes (uses existing delivery infrastructure)
- **Depends on**: `agent-workspace-exec` (for `surfaceOutput` on `exec_command`), `attachments` (for file surface directives using `sendFile`)
