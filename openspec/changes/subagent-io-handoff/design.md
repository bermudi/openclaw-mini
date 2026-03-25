## Context

The codebase already has a useful attachment model:

- inbound files become `Attachment[]`
- inbound images for multimodal use become `VisionInput[]`
- the executor already knows how to process `visionInputs`

But the wiring is incomplete. The input manager drops those arrays before the task is created, and `spawn_subagent` only sends text-plus-skill metadata. That means the runtime has the pieces for multimodal work, but not the connective tissue.

## Goals / Non-Goals

**Goals:**
- preserve inbound attachments and vision inputs when message tasks are created
- allow parent tasks to pass `attachments` and `visionInputs` into child sub-agent tasks
- reuse the existing type shapes instead of inventing a parallel sub-agent attachment format
- preserve delivery context so child tools like `send_file_to_chat` can target the original chat

**Non-Goals:**
- redefining the `Attachment` or `VisionInput` types
- adding base64 attachment payloads
- changing the skill-loading system
- adding runtime skill authoring

## Decisions

### Decision 1: Reuse `Attachment` and `VisionInput`

The sub-agent payload path will reuse the existing runtime types from `src/lib/types.ts`.

That means attachment handoff uses file-based local paths already established by inbound download handling. We do not introduce a new base64-or-URL attachment schema for sub-agents.

### Decision 2: `spawn_subagent` accepts optional `attachments` and `visionInputs`

`spawn_subagent` grows optional fields for attachment-aware delegation.

This keeps the tool explicit: parent agents decide whether a child needs the original files/images or not.

### Decision 3: Delivery context is inherited by child tasks

Sub-agent tasks should retain delivery context from the parent task when created through `spawn_subagent`.

That lets child tools surface files to the same outbound destination as the original message flow, instead of depending on message-task-only delivery behavior.

### Decision 4: Preserve attachments at the first boundary

`input-manager` must carry `attachments` and `visionInputs` into the task payload for message tasks. Without that, every later stage is operating on missing data.

## Risks / Trade-offs

- **More payload data per task** -> acceptable; attachment metadata is small compared to the files themselves
- **Sub-agent tasks can now reference more local files** -> acceptable; they reference already-downloaded files, not arbitrary new host paths
- **Planner behavior still depends on prompt quality** -> acceptable; this change provides the data path, not automatic orchestration quality

## Migration Plan

1. preserve attachment arrays in message task payload creation
2. extend `spawn_subagent` input schema and payload creation
3. update executor payload typing and delivery-target handling for sub-agent tasks
4. add tests for inbound preservation, parent-to-child handoff, and file delivery from child tasks

## Open Questions

- None blocking. This change intentionally reuses existing attachment and vision types.
