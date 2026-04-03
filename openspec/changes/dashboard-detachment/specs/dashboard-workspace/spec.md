## MODIFIED Requirements

### Requirement: File list browser

The dashboard SHALL display a list of workspace files using the configured runtime client instead of same-origin route assumptions.

#### Scenario: Load workspace shows file list

- **WHEN** the operator navigates to the workspace tab or panel
- **THEN** the dashboard SHALL fetch the file list through the runtime client
- **AND** each file SHALL be displayed with its name and size
- **AND** files SHALL be sorted alphabetically by name

#### Scenario: Workspace is empty

- **WHEN** the workspace directory contains no `.md` files
- **THEN** the dashboard SHALL show an empty state with an option to create a new file

### Requirement: Save with feedback

The operator SHALL be able to save edited file content through the configured runtime client. The dashboard SHALL provide visual feedback on save success or failure.

#### Scenario: Edit file and save successfully

- **GIVEN** a workspace file is loaded in the editor with modified content
- **WHEN** the operator clicks save
- **THEN** the dashboard SHALL send the save request through the runtime client
- **AND** a success toast or notification SHALL be displayed

#### Scenario: Save fails due to runtime error

- **GIVEN** a workspace file is loaded in the editor
- **WHEN** the operator clicks save and the runtime returns an error
- **THEN** an error toast or notification SHALL be displayed
- **AND** the editor content SHALL NOT be cleared
