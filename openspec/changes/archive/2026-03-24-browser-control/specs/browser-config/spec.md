# browser-config Specification

## ADDED Requirements

### Requirement: Browser configuration in openclaw.json
The system SHALL support an optional `browser` section in `openclaw.json` for browser automation settings.

#### Scenario: Browser config with all fields
- **GIVEN** `openclaw.json` contains:
  ```json
  {
    "browser": {
      "headless": true,
      "viewport": { "width": 1280, "height": 720 },
      "navigationTimeout": 30000
    }
  }
  ```
- **WHEN** the config is loaded
- **THEN** browser sessions SHALL use the specified settings

#### Scenario: Default browser config
- **GIVEN** `openclaw.json` does not contain a `browser` section
- **WHEN** a browser session is launched
- **THEN** defaults SHALL be used: headless `true`, viewport `1280x720`, navigation timeout `30000ms`

### Requirement: Headless mode configuration
The browser SHALL run in headless mode by default, configurable via `browser.headless`.

#### Scenario: Headless mode enabled (default)
- **WHEN** `browser.headless` is not set or set to `true`
- **THEN** the browser SHALL launch in headless mode

#### Scenario: Headless mode disabled
- **WHEN** `browser.headless` is set to `false`
- **THEN** the browser SHALL launch with a visible window (useful for debugging)

### Requirement: Viewport configuration
The browser viewport size SHALL be configurable via `browser.viewport`.

#### Scenario: Custom viewport
- **WHEN** `browser.viewport` is set to `{ "width": 1920, "height": 1080 }`
- **THEN** browser pages SHALL use that viewport size

#### Scenario: Viewport validation
- **WHEN** `browser.viewport.width` or `browser.viewport.height` is less than 1
- **THEN** config validation SHALL fail
