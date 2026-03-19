# dashboard-workspace Specification

## Purpose
TBD - created by archiving change build-dashboard. Update Purpose after archive.
## Requirements
### Requirement: File list browser

The dashboard SHALL display a list of workspace files in a dedicated panel or tab. Each file entry SHALL show the filename and file size. The file list SHALL be fetched from `GET /api/workspace`.

#### Scenario: Load workspace shows file list

- **WHEN** the operator navigates to the workspace tab/panel
- **THEN** the dashboard SHALL fetch the file list from `GET /api/workspace`
- **AND** each file SHALL be displayed with its name and size
- **AND** files SHALL be sorted alphabetically by name

#### Scenario: Workspace is empty

- **WHEN** the workspace directory contains no `.md` files
- **THEN** the dashboard SHALL show an empty state with an option to create a new file

#### Scenario: Workspace is initialized with defaults

- **WHEN** the workspace has the default files (`IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`)
- **THEN** all five files SHALL appear in the file list

### Requirement: File content editor

When the operator selects a file from the list, the dashboard SHALL display its content in an editable text area. The content SHALL be fetched from `GET /api/workspace?file={name}`.

#### Scenario: Select file shows content

- **GIVEN** the file list is displayed
- **WHEN** the operator clicks on `SOUL.md`
- **THEN** the dashboard SHALL fetch the file content from `GET /api/workspace?file=SOUL.md`
- **AND** the content SHALL be displayed in an editable text area

#### Scenario: File not found

- **GIVEN** a file was deleted outside the dashboard
- **WHEN** the operator tries to load the file
- **THEN** the dashboard SHALL show an error message
- **AND** the file list SHALL be refreshed

### Requirement: Save with feedback

The operator SHALL be able to save edited file content. The save action SHALL send a `PUT /api/workspace` request with the filename and content. The dashboard SHALL provide visual feedback on save success or failure.

#### Scenario: Edit file and save successfully

- **GIVEN** `SOUL.md` is loaded in the editor with modified content
- **WHEN** the operator clicks save
- **THEN** a `PUT /api/workspace` request SHALL be sent with `{ file: "SOUL.md", content: "..." }`
- **AND** a success toast/notification SHALL be displayed
- **AND** the file size in the file list SHALL update to reflect the new content

#### Scenario: Save fails due to server error

- **GIVEN** `SOUL.md` is loaded in the editor
- **WHEN** the operator clicks save and the server returns an error
- **THEN** an error toast/notification SHALL be displayed
- **AND** the editor content SHALL NOT be cleared (so the operator can retry)

### Requirement: Create new workspace file

The operator SHALL be able to create a new workspace file by specifying a filename. The filename MUST match the pattern `^[A-Za-z0-9_-]+\.md$` (enforced by `isSafeWorkspaceFileName`). The new file SHALL be created via the same `PUT /api/workspace` endpoint.

#### Scenario: Create new file appears in list

- **GIVEN** the workspace editor is displayed
- **WHEN** the operator enters a new filename `NOTES.md` and provides content
- **THEN** a `PUT /api/workspace` request SHALL be sent with `{ file: "NOTES.md", content: "..." }`
- **AND** the file list SHALL refresh to include `NOTES.md`

#### Scenario: Invalid filename shows error

- **GIVEN** the operator is creating a new file
- **WHEN** the operator enters a filename like `../hack.md` or `no spaces.md`
- **THEN** the dashboard SHALL show a validation error before sending the request
- **AND** the request SHALL NOT be sent to the server

#### Scenario: Filename with disallowed characters

- **GIVEN** the operator is creating a new file
- **WHEN** the operator enters a filename containing characters outside `[A-Za-z0-9_-]` (excluding the `.md` extension)
- **THEN** the dashboard SHALL show an error explaining the allowed filename format

