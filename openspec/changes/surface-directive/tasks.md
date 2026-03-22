## 1. Type Definitions

- [ ] 1.1 Add `SurfaceDirective` interface to `src/lib/tools.ts`: `type` (`'text' | 'file'`), optional `content` (string), optional `filePath` (string), optional `mimeType` (string), optional `caption` (string)
- [ ] 1.2 Extend `ToolResult` interface with optional `surface?: SurfaceDirective[]` field

## 2. emit_to_chat Tool

- [ ] 2.1 Register `emit_to_chat` tool in `src/lib/tools.ts`: takes `text` (string), returns `{ success: true, data: { emitted: true }, surface: [{ type: 'text', content: text }] }`, risk level `low`
- [ ] 2.2 Write tests for emit_to_chat: returns correct surface directive structure

## 3. exec_command surfaceOutput Integration

- [ ] 3.1 Update `exec_command` tool result: when `surfaceOutput: true` and stdout is non-empty, include `surface: [{ type: 'text', content: stdout }]` in the tool result
- [ ] 3.2 Write tests: surfaceOutput true appends surface directive, surfaceOutput false does not, empty stdout produces no surface

## 4. Executor Surface Collection

- [ ] 4.1 Add surface collection logic in `AgentExecutor.executeTask()`: after `generateText()`, iterate all tool results across all steps, collect `SurfaceDirective` arrays in order
- [ ] 4.2 For each collected text surface directive on a message task with a delivery target, enqueue a text delivery via `enqueueDeliveryTx`
- [ ] 4.3 For each collected file surface directive on a message task with a delivery target, enqueue a file delivery via `enqueueFileDelivery`
- [ ] 4.4 Ensure surface deliveries are enqueued before the LLM response delivery (ordering via creation order in the transaction)
- [ ] 4.5 Skip surface delivery for tasks without a delivery target (non-message tasks)
- [ ] 4.6 Write tests for executor surface collection: single surface delivered, multiple surfaces in order, file surfaces use file delivery, no surfaces = unchanged behavior, non-message tasks discard surfaces

## 5. Sub-agent Surface Bubbling

- [ ] 5.1 Update executor: when completing a task, store collected surface directives alongside the task result (e.g., as `result.surfaces` on the task record)
- [ ] 5.2 Update `spawn_subagent` tool: when reading the child task result, extract `surfaces` array and include it as `data.surfaces` in the tool result
- [ ] 5.3 Write tests: sub-agent with surfaces bubbles them to parent, sub-agent without surfaces returns normal result, surfaces are not auto-delivered
