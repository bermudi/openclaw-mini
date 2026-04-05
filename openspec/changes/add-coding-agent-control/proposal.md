## Why

OpenClaw Mini can already run commands, supervise PTY sessions, and spawn focused subagents, but it still lacks a first-class controller for long-lived coding workers. That leaves an important product gap: coding work can be executed, but it cannot yet be managed as a durable session that can be started, observed, steered, resumed, or cancelled like a real runtime entity.

This matters now because the runtime has reached the point where the low-level pieces exist. The missing layer is the control plane that turns those pieces into a feature users can rely on for iterative coding workflows, background debugging, and future trigger-driven automation.

## What Changes

- Add a first-class coding-agent control capability for persistent, steerable coding sessions backed by the runtime's supervised exec surface
- Introduce control-plane operations to spawn, inspect, message, cancel, and list coding-agent sessions
- Persist coding-agent session metadata, lifecycle state, working directory, runtime backend, and recent health signals so sessions survive beyond a single prompt turn
- Allow a coding-agent session to be attached to a parent task while still being independently observable and controllable afterward
- Reuse the supervised `process` runtime as the execution substrate, but define a higher-level session controller above it instead of exposing raw process sessions as the only abstraction
- Extend the coder skill and related orchestration flows so the runtime can treat coding work as a managed session rather than a one-shot subagent or bare command launch

## Capabilities

### New Capabilities
- `coding-agent-control`: First-class lifecycle management for persistent coding-agent sessions, including spawn, inspect, steer, cancel, and resume-oriented state tracking

### Modified Capabilities
- `sub-agents`: Allow subagent orchestration to hand off work into a persistent coding-agent session and retain links between the parent task and the controlled coding session
- `exec-process-control`: Define how coding-agent sessions are backed by supervised process sessions, including session ownership, status projection, and log access
- `runtime-config`: Add configuration for coding-agent control defaults, limits, and backend behavior
- `skill-coder`: Expand the coder skill contract from "use the current exec surface" to "operate as a managed coding session under the controller"

## Impact

- **Runtime services**: new coding-agent session controller and persistence layer, plus recovery and health-check integration with the runtime loop
- **Tools**: new control-plane tools for lifecycle operations; existing exec/process tools remain the substrate, not the product surface
- **Schema and storage**: a new durable coding-session record or equivalent persisted state is required
- **Prompting and skills**: the coder skill and supervisor flows must understand managed coding sessions and their lifecycle
- **APIs and dashboard**: room for future session inspection/control endpoints and UI panels without redefining the core contract later
