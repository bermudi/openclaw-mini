## Context

The agent executor currently has a single output path: the LLM's text response is enqueued as a delivery. Tools return `ToolResult` objects that the LLM consumes to formulate its response. If the user asks "show me my list," the LLM must read the list content from the tool result and repeat it verbatim in its response — burning tokens proportional to the file size.

The `agent-workspace-exec` change adds `exec_command` with a `surfaceOutput` boolean flag. The `attachments` change adds file delivery support via `sendFile()`. This change wires them together through a general-purpose surface directive mechanism.

## Goals / Non-Goals

**Goals:**
- Define a `SurfaceDirective` type that tools attach to `ToolResult` to flag content for direct chat delivery
- Collect surfaces after execution and enqueue them as deliveries before the LLM response
- Provide an `emit_to_chat` tool for agents to explicitly push content to chat
- Wire `exec_command`'s `surfaceOutput` flag to produce surface directives
- Allow sub-agents to bubble surface directives up through `spawn_subagent`

**Non-Goals:**
- Streaming partial tool output to chat in real-time (surfaces are collected after execution completes)
- User-configurable tool visibility / observability (separate concern)
- Automatic surfacing heuristics (agent/tool must explicitly flag content)

## Decisions

### 1. SurfaceDirective as an array on ToolResult

Extend `ToolResult` with an optional `surface` field:

```typescript
interface SurfaceDirective {
  type: 'text' | 'file';
  content?: string;      // for type: 'text'
  filePath?: string;     // for type: 'file'
  mimeType?: string;     // for type: 'file'
  caption?: string;      // optional label for both types
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  surface?: SurfaceDirective[];  // NEW
}
```

An array because a single tool call might produce multiple surfaceable outputs (e.g., exec runs a command that generates a file and has text output — both could be surfaced).

**Alternative considered:** A separate `surfaceOutput` field with just a string. Rejected because it doesn't support files and doesn't compose well with multiple outputs.

### 2. Collection and delivery in the executor's post-processing

After `generateText()` returns, the executor already iterates over `result.steps` to extract tool calls and results. Adding surface collection is a natural extension:

1. Iterate all tool results from all steps
2. Collect all `SurfaceDirective`s into an ordered array
3. For each directive, enqueue a delivery (text or file) with the task's delivery target
4. Then enqueue the LLM's text response as usual

Surfaces are delivered first so the user sees the content before the agent's commentary about it. Each surface directive becomes a separate delivery to avoid mixing content types.

### 3. `emit_to_chat` as a simple tool that returns a surface directive

Rather than having `emit_to_chat` call the delivery service directly (which would require the task context), it simply returns a `ToolResult` with a surface directive. The executor's collection mechanism handles the actual delivery. This keeps tools stateless and the delivery logic centralized.

```typescript
registerTool('emit_to_chat', tool({
  description: 'Send text directly to the user chat without including it in your response',
  inputSchema: z.object({
    text: z.string().describe('Text to send to chat'),
  }),
  execute: async ({ text }) => ({
    success: true,
    data: { emitted: true },
    surface: [{ type: 'text', content: text }],
  }),
}), { riskLevel: 'low' });
```

### 4. `exec_command` surfaceOutput wiring

When `surfaceOutput: true` is passed to `exec_command`, the tool appends stdout as a text surface directive to its result. The executor collects it like any other surface.

No changes to exec_command's core logic — just the result construction:

```typescript
const result: ToolResult = {
  success: true,
  data: { stdout, stderr, exitCode },
  surface: surfaceOutput ? [{ type: 'text', content: stdout }] : undefined,
};
```

### 5. Sub-agent surface bubbling through spawn_subagent

When a sub-agent task completes, the `spawn_subagent` tool already reads the child task's result. The child's execution may have produced surface directives that were collected by the executor. These are stored alongside the task result.

The `spawn_subagent` tool includes them in its own result data as `data.surfaces`. The parent agent sees them in the tool result and can choose to re-emit them via `emit_to_chat` or ignore them. The parent stays in control — sub-agent surfaces are not automatically delivered.

**Alternative considered:** Auto-delivering sub-agent surfaces. Rejected because the parent agent should decide what reaches the user — a sub-agent might produce intermediate output that shouldn't be surfaced.

## Risks / Trade-offs

- **[Surfaces delivered before response]** → The user might see raw output before the agent's contextual explanation. This is intentional — the output IS the content, the agent's response is commentary. If this feels wrong for some tools, they can choose not to use surfaces.
- **[No streaming]** → Surfaces are collected after all steps complete, not streamed during execution. For long-running exec commands, the user waits for the full result. Mitigation: acceptable for now; streaming surfaces would require a WebSocket push during execution, which is a larger change.
- **[Sub-agent surfaces not auto-delivered]** → Parent agent must explicitly re-emit them. This adds a step but preserves the parent's authority over what reaches the user. The parent agent's system prompt should mention this capability.
