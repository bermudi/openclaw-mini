## 1. Workspace Offload Helpers

- [ ] 1.1 Add `writeOffloadFile(taskId, toolName, callIndex, content)` to `workspace-service.ts` that writes to `data/workspace/offload/<taskId>/<toolName>-<callIndex>.md`
- [ ] 1.2 Add `cleanOffloadFiles(taskId)` to `workspace-service.ts` that removes `data/workspace/offload/<taskId>/` recursively, logging on failure
- [ ] 1.3 Add `OPENCLAW_OFFLOAD_TOKEN_THRESHOLD` env var to `src/lib/config/runtime.ts` (default: 2000)
- [ ] 1.4 Export offload path resolver `getOffloadDir(taskId)` for use in tests

## 2. Offloading Wrapper

- [ ] 2.1 Create `src/lib/utils/offload-wrapper.ts` with `wrapWithOffloading(tool, context)` higher-order function that intercepts `execute`, checks token count, and either returns inline or writes + returns compact reference
- [ ] 2.2 Implement compact reference message format: path, line count, 10-line preview, retrieval instruction
- [ ] 2.3 Handle token counting failure gracefully: fall back to `Math.ceil(content.length / 4)` and continue
- [ ] 2.4 Add `noOffload?: boolean` to tool definition type in `src/lib/tools.ts`

## 3. Tool Registry Integration

- [ ] 3.1 In `getToolsForAgent`, apply `wrapWithOffloading` to each tool that does not have `noOffload: true`, passing task-scoped offload context
- [ ] 3.2 Mark `spawn_subagent`, `deliver_message`, `deliver_file`, `send_message_to_agent` with `noOffload: true` in their tool definitions
- [ ] 3.3 Confirm `getToolsByNames` (used for subagent execution) does NOT apply the offloading wrapper

## 4. Executor Integration

- [ ] 4.1 Thread `taskId` into the offload context when calling `getToolsForAgent` in `agent-executor.ts`
- [ ] 4.2 Add `cleanOffloadFiles(taskId)` call in the task completion path (both success and failure branches) with error suppression
- [ ] 4.3 Confirm offloading is skipped for `isSubagent` execution path

## 5. Tests

- [ ] 5.1 Unit test `wrapWithOffloading`: result below threshold passes through unchanged
- [ ] 5.2 Unit test `wrapWithOffloading`: result above threshold writes file and returns compact reference with correct format
- [ ] 5.3 Unit test `wrapWithOffloading`: `noOffload: true` tool with large result passes through unchanged
- [ ] 5.4 Unit test `wrapWithOffloading`: token counting failure falls back to char estimation
- [ ] 5.5 Unit test `cleanOffloadFiles`: cleanup removes scoped directory; failure is caught and logged
- [ ] 5.6 Integration test: `getToolsForAgent` wraps tools, `getToolsByNames` does not
