## Why

Sub-agents currently inherit skill prompts and tool constraints correctly, but they do not reliably inherit the message IO they need to do useful multimodal work.

Two concrete gaps exist today:

- inbound `attachments` and `visionInputs` are dropped when message tasks are created
- `spawn_subagent` cannot pass attachments or vision inputs into child tasks, and delivery context does not cleanly support child-produced files surfacing back to the original chat

This change focuses on that IO handoff layer. It does not change skill content or runtime-managed skills; it makes sub-agents capable of receiving files/images and returning deliverable outputs in a consistent way.

## What Changes

- Preserve `attachments` and `visionInputs` when message tasks are created from inbound channel input
- Extend `spawn_subagent` so parent agents can pass attachment-related payloads into child tasks
- Standardize on the existing `Attachment` and `VisionInput` structures rather than inventing a second attachment format
- Ensure sub-agent execution can receive inherited delivery context when child tools need to surface files back to chat
- Clarify how planner/parent agents should hand off images and files to specialists like `vision-analyst` and `coder`

## Capabilities

### Modified Capabilities

- `sub-agents`: sub-agent spawning gains attachment-aware payload propagation
- `inbound-attachments`: task payload creation preserves downloaded attachments and vision inputs
- `vision-input`: sub-agent tasks can carry `visionInputs` through the same executor path as top-level message tasks
- `outbound-files`: child tasks can surface file deliveries through inherited delivery context

## Impact

- **Code**: touches `input-manager`, `spawn_subagent`, sub-agent task payload typing, and agent executor payload handling
- **Runtime model**: reuses existing `Attachment` and `VisionInput` types from `src/lib/types.ts`
- **User impact**: planner-style workflows can finally pass image/file context to specialists instead of only plain text
- **Dependencies**: no new packages
