## REMOVED Requirements

### Requirement: Backwards compatibility with env vars
**Reason**: Config file is now required; env vars only for secrets via `${VAR}` substitution.
**Migration**: Create `openclaw.json` with `providers` and `agent` sections.

### Requirement: Deprecation warnings
**Reason**: No longer falling back to env vars, so no need for warnings.
**Migration**: N/A

### Requirement: Config migration
**Reason**: No longer auto-generating config from env vars.
**Migration**: Users must manually create `openclaw.json`.

## MODIFIED Requirements

### Requirement: Config file does not exist
The system SHALL fail with a helpful error when `openclaw.json` does not exist.

#### Scenario: Config file missing shows error
- **WHEN** `openclaw.json` does not exist at startup
- **THEN** the system SHALL throw an error with example config structure
