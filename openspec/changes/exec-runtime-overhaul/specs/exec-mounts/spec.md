## ADDED Requirements

### Requirement: Declarative execution mounts
The system SHALL support declarative execution mounts in `runtime.exec.mounts`.

#### Scenario: Mount declared in config
- **WHEN** `runtime.exec.mounts` contains an entry with `alias`, `hostPath`, and `permissions`
- **THEN** the system SHALL validate and register that entry as an execution mount

#### Scenario: Invalid mount declaration
- **WHEN** a mount declaration is missing a required field or uses an invalid permission value
- **THEN** config validation SHALL fail

### Requirement: Stable mount aliases
Each configured execution mount SHALL expose a stable alias that commands can use as a logical mount name.

#### Scenario: Alias available to runtime
- **WHEN** a command runs with a configured mount alias `obsidian`
- **THEN** the runtime SHALL make that mount available under the alias `obsidian`

### Requirement: Mount permission enforcement
The system SHALL enforce declared mount permissions in sandboxed and isolated execution.

#### Scenario: Read-only mount write attempt
- **WHEN** a command running in `sandbox` or `isolated` tier attempts to write through a `read-only` mount
- **THEN** the runtime SHALL deny the write

#### Scenario: Read-write mount write attempt
- **WHEN** a command running in `sandbox` or `isolated` tier writes through a `read-write` mount
- **THEN** the runtime SHALL permit the write subject to backend policy

### Requirement: Mount path validation
The system SHALL validate configured mount host paths before command launch.

#### Scenario: Missing mount path with create disabled
- **WHEN** a configured mount host path does not exist and `createIfMissing` is false or unset
- **THEN** the command launch SHALL fail with a mount validation error

#### Scenario: Missing mount path with create enabled
- **WHEN** a configured mount host path does not exist and `createIfMissing` is true
- **THEN** the runtime SHALL create the path before command launch

### Requirement: Mount-aware working directory resolution
The system SHALL resolve requested working directories against configured mounts.

#### Scenario: Working directory by mount alias
- **WHEN** a command requests a working directory inside a configured mount alias
- **THEN** the runtime SHALL resolve that working directory relative to the mounted path

#### Scenario: Working directory outside configured mounts in isolated execution
- **WHEN** a command in `sandbox` or `isolated` tier requests a working directory outside configured mounts
- **THEN** the runtime SHALL reject the command
