# agent-sandbox Specification

## Purpose
TBD - created by archiving change agent-workspace-exec. Update Purpose after archive.
## Requirements
### Requirement: Per-agent sandbox directory
The system SHALL provide a persistent sandbox directory for each agent at `data/sandbox/{agentId}/`.

#### Scenario: Sandbox directory creation on first access
- **WHEN** a service calls `getSandboxDir(agentId)` for an agent that has no sandbox yet
- **THEN** the system SHALL create `data/sandbox/{agentId}/` and return the absolute path

#### Scenario: Sandbox directory already exists
- **WHEN** a service calls `getSandboxDir(agentId)` for an agent with an existing sandbox
- **THEN** the system SHALL return the existing absolute path without modification

### Requirement: Structured sandbox subdirectories
The sandbox SHALL contain structured subdirectories for different file categories.

#### Scenario: Downloads subdirectory
- **WHEN** a service calls `getSandboxDownloadsDir(agentId)`
- **THEN** the system SHALL return and ensure `data/sandbox/{agentId}/downloads/` exists

#### Scenario: Output subdirectory
- **WHEN** a service calls `getSandboxOutputDir(agentId)`
- **THEN** the system SHALL return and ensure `data/sandbox/{agentId}/output/` exists

### Requirement: Sandbox path safety
The sandbox service SHALL prevent path traversal outside the sandbox root.

#### Scenario: Path traversal attempt
- **WHEN** a caller provides a path containing `..` segments that would resolve outside `data/sandbox/`
- **THEN** the system SHALL reject the path with an error

#### Scenario: Safe relative path
- **WHEN** a caller provides a simple filename or relative path within the sandbox
- **THEN** the system SHALL resolve it relative to the agent's sandbox directory

