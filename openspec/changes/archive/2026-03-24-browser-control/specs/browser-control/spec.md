# browser-control Specification

## ADDED Requirements

### Requirement: browser_action compound tool
The system SHALL register a `browser_action` tool that provides headless browser control via Playwright with action-based dispatch.

#### Scenario: Navigate to URL
- **WHEN** the agent calls `browser_action` with `action: "navigate"` and `url: "https://example.com"`
- **THEN** the system SHALL launch a headless browser, navigate to the URL, and return `{ success: true, data: { title: "...", url: "..." } }`

#### Scenario: Click an element
- **WHEN** the agent calls `browser_action` with `action: "click"`, `url: "https://example.com"`, and `selector: "button#submit"`
- **THEN** the system SHALL navigate to the URL, click the element matching the CSS selector, and return the resulting page title and URL

#### Scenario: Type text into an input
- **WHEN** the agent calls `browser_action` with `action: "type"`, `url: "https://example.com"`, `selector: "input#search"`, and `text: "hello"`
- **THEN** the system SHALL navigate, type the text into the matching element, and return success

#### Scenario: Take a screenshot
- **WHEN** the agent calls `browser_action` with `action: "screenshot"` and `url: "https://example.com"`
- **THEN** the system SHALL navigate and return a base64-encoded PNG screenshot

#### Scenario: Full-page screenshot
- **WHEN** the agent calls `browser_action` with `action: "screenshot"`, `url: "https://example.com"`, and `fullPage: true`
- **THEN** the screenshot SHALL capture the full scrollable page

#### Scenario: Extract text content
- **WHEN** the agent calls `browser_action` with `action: "get_text"` and `url: "https://example.com"`
- **THEN** the system SHALL return `document.body.innerText` from the page

#### Scenario: Extract text from specific element
- **WHEN** the agent calls `browser_action` with `action: "get_text"`, `url: "https://example.com"`, and `selector: "article.main"`
- **THEN** the system SHALL return the `innerText` of the matching element

#### Scenario: Execute JavaScript
- **WHEN** the agent calls `browser_action` with `action: "evaluate"`, `url: "https://example.com"`, and `script: "document.title"`
- **THEN** the system SHALL evaluate the script and return its result

#### Scenario: Generate PDF
- **WHEN** the agent calls `browser_action` with `action: "pdf"`, `url: "https://example.com"`, and `agentId: "main"`
- **THEN** the system SHALL navigate, generate a PDF, save it to the agent sandbox directory, and return the file path

### Requirement: Ephemeral browser sessions
Each `browser_action` invocation SHALL use a fresh browser context that is closed after the action completes.

#### Scenario: Browser cleanup after action
- **WHEN** a `browser_action` call completes (success or failure)
- **THEN** the browser context and page SHALL be closed and resources released

#### Scenario: Browser cleanup on error
- **WHEN** a `browser_action` fails mid-execution (e.g., selector not found)
- **THEN** the browser SHALL still be closed and resources released

### Requirement: Opt-in Playwright dependency
The `browser_action` tool SHALL only be registered if Playwright is installed.

#### Scenario: Playwright available
- **GIVEN** `playwright` is installed in `node_modules`
- **WHEN** the system starts
- **THEN** `browser_action` SHALL be registered as an available tool

#### Scenario: Playwright not available
- **GIVEN** `playwright` is not installed
- **WHEN** the system starts
- **THEN** `browser_action` SHALL NOT be registered and no error SHALL be logged

### Requirement: Navigation timeout
Browser navigation SHALL time out after a configurable duration (default: 30 seconds).

#### Scenario: Page load timeout
- **WHEN** a page takes longer than 30 seconds to load
- **THEN** the system SHALL abort, close the browser, and return a timeout error

### Requirement: Element not found handling
When a selector-based action targets a nonexistent element, the tool SHALL return a clear error.

#### Scenario: Selector not found
- **WHEN** `browser_action` with `action: "click"` and `selector: "#nonexistent"` is called
- **THEN** the tool SHALL return `{ success: false, error: "Element not found: #nonexistent" }`
