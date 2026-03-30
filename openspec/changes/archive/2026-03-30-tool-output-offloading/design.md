## Context

Tool results in the AI SDK `generateText` loop accumulate as `tool-result` messages in conversation history. Each iteration appends the full tool output verbatim — there is no eviction or compression at this layer. On long tasks with many tool calls, this is the fastest path to context exhaustion.

The token budget system (`buildPrompt`) already manages session messages and memory with explicit budgets, but the tool-call history (produced within the `generateText` loop itself) is outside that budget's reach — the AI SDK controls the message array, not the executor. By the time the executor sees a result, it's already in the model's context.

The practical solution is to intercept tool results *before* they become part of the conversation — at the tool execution boundary — and replace large ones with compact references.

## Goals / Non-Goals

**Goals:**
- Bound the per-tool-call token cost to a small fixed ceiling (reference + preview)
- Preserve full result content in an accessible workspace file for agent retrieval
- Be transparent to all existing tools with no per-tool changes required
- Respect an opt-out flag for tools whose results the executor must inspect structurally (e.g. `spawn_subagent`)
- Clean up offload files after task completion

**Non-Goals:**
- Compressing or summarizing tool results (we write them verbatim, just not inline)
- Offloading tool *inputs* (write operations already have filesystem paths; this covers outputs only)
- Changing the AI SDK integration surface or `generateText` call sites
- Applying offloading to subagent task execution (subagents already have isolated context; main agent receives only their final response)

## Decisions

### Decision: Wrap at the tool-registry level, not inside individual tools

**Chosen:** Wrap the tool `execute` function in `getToolsForAgent` / `getToolsByNames` at return time. Each tool's execute is wrapped once by an `offloadingWrapper(tool, context)` higher-order function.

**Alternatives considered:**
- *Post-process inside `generateText` step callback* — AI SDK doesn't expose a stable hook for this; fragile.
- *Per-tool opt-in wrapping* — requires touching all 30+ tools; maintenance burden.
- *Middleware in `agent-executor.ts`* — would require reimplementing the AI SDK message loop; over-engineering.

The tool-registry approach is minimal: one wrapper, one insertion point, zero per-tool changes.

---

### Decision: Write offload files to `data/workspace/offload/<taskId>/`

**Chosen:** Scoped subdirectory per task. Files are named `<toolName>-<callIndex>.md` (or `.json` if the result is JSON). Path is fully accessible via existing `read_workspace_file` and `list_workspace_files` tools.

**Alternatives considered:**
- *System temp dir* — not accessible to the agent via workspace tools; defeats the purpose.
- *Flat `data/workspace/offload/` directory* — concurrent tasks would intermix files; confusing.
- *In-memory store returned as context* — doesn't survive across `generateText` steps since the agent needs to be able to re-read.

---

### Decision: Threshold at 2,000 tokens (configurable via `OPENCLAW_OFFLOAD_TOKEN_THRESHOLD`)

**Chosen:** 2,000 tokens (~8KB text). Keeps individual tool results to at most ~50 tokens (reference line) while the full content is only a workspace read away.

The LangChain reference uses 20,000 tokens, but their model is designed for deep research tasks. OpenClaw-Mini targets general-purpose assistant behavior where results in the 500–3,000 token range are common. 2,000 is a reasonable middle ground.

**Configurable:** operators running OpenClaw against large-context research tasks can raise the threshold.

---

### Decision: opt-out via `noOffload: true` on tool definition, not opt-in

**Chosen:** All tools are offloaded by default; tools declare `noOffload: true` to skip wrapping. This is safer than opt-in (new tools are protected automatically) and the opt-out list is small:
- `spawn_subagent` — executor reads `success`/`data` fields from result
- `deliver_message` / `deliver_file` — surface directives must remain inline
- `send_message_to_agent` — result is tiny by design

---

### Decision: Preview is first 10 lines, remainder truncated

**Chosen:** Consistent with LangChain's approach. Gives the agent enough signal to decide whether to read the full file. 10 lines is sufficient for JSON structure headers, search result titles, command output summaries, etc.

---

### Decision: Cleanup is best-effort, post-task

**Chosen:** After `taskQueue.completeTask` or on failure path in `executeTask`, the offload directory for that task is removed. If cleanup fails it is logged but doesn't affect task outcome.

Offload files are ephemeral scratch space — they don't need the reliability guarantees of memory or session storage. Best-effort cleanup avoids over-engineering a non-critical operation.

## Risks / Trade-offs

- **Agent may not read back offloaded content when it should** → Mitigation: the compact reference message explicitly instructs the agent: `"Full result saved to <path>. Use read_workspace_file to retrieve if needed."` The agent's instructions already cover using workspace tools.
- **Threshold too low for structured tool results** → Mitigation: `noOffload: true` flag on any tool whose results are compact but structurally important to the executor.
- **Token counting adds latency per tool call** → Mitigation: `countTokens()` is already in use throughout the prompt assembly path. For typical tool results (< 2,000 tokens) the check completes in microseconds.
- **Offload directory survives if process crashes mid-task** → Mitigation: a startup sweep can clean up orphaned offload dirs older than N hours (out of scope for this change; acceptable debt).

## Migration Plan

- No schema migrations
- No breaking changes to existing tools
- Threshold env var is additive; existing deployments use the default
- Offloading wrapper is inserted at the tool-registry call sites; no existing call sites change their signatures
- Rollout: deploy, monitor context window usage metrics, tune threshold if needed
