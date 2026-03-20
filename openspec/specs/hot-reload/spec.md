# hot-reload Specification

## Purpose
TBD - created by archiving change runtime-provider-registry. Update Purpose after archive.
## Requirements
### Requirement: File watcher initialization
The system SHALL initialize a file watcher on `openclaw.json` when using config file mode.

#### Scenario: Watcher starts on startup
- **WHEN** config file exists and is valid
- **THEN** the system SHALL begin watching for changes to that file

### Requirement: Config change detection
The system SHALL detect when the config file is modified.

#### Scenario: Config file changed
- **WHEN** `openclaw.json` is modified on disk
- **THEN** the file watcher SHALL emit a change event

### Requirement: Hot reload on change
The system SHALL reload the provider registry when a config change is detected.

#### Scenario: Registry reloaded on config change
- **WHEN** config file changes
- **THEN** `registry.reload()` SHALL be called with the new config

### Requirement: Config revalidation before apply
The system SHALL revalidate the config with Zod before applying changes.

#### Scenario: Invalid config rejected
- **WHEN** changed config fails Zod validation
- **THEN** the previous valid config SHALL remain in effect and an error SHALL be logged

### Requirement: SDK cache invalidation
The system SHALL invalidate SDK clients when config reloads.

#### Scenario: SDK cache cleared after reload
- **WHEN** config reloads
- **THEN** `getLanguageModel()` SHALL create fresh SDK clients

### Requirement: Graceful shutdown
The system SHALL close the file watcher on graceful shutdown.

#### Scenario: Watcher closed on shutdown
- **WHEN** the process receives SIGTERM or SIGINT
- **THEN** the file watcher SHALL be closed

### Requirement: Reload debouncing
The system SHALL debounce rapid config file changes.

#### Scenario: Multiple changes debounced
- **WHEN** config file changes multiple times within 500ms
- **THEN** only one reload SHALL occur

### Requirement: Reload status notification
The system SHALL log when a config reload occurs.

#### Scenario: Reload logged
- **WHEN** config is successfully reloaded
- **THEN** an info log SHALL be emitted with the new provider list

