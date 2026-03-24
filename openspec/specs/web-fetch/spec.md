# web-fetch Specification

## Purpose
TBD - created by archiving change web-search-providers. Update Purpose after archive.
## Requirements
### Requirement: URL content extraction tool
The system SHALL register a `web_fetch` tool that fetches a URL and returns extracted text content.

#### Scenario: Fetch a web page
- **WHEN** the agent calls `web_fetch` with `url: "https://example.com"`
- **THEN** the system SHALL fetch the URL via HTTP GET and return the page's text content with HTML tags, scripts, and styles stripped

#### Scenario: Fetch with content length limit
- **WHEN** `web_fetch` retrieves content longer than 10,000 characters
- **THEN** the result SHALL be truncated to 10,000 characters with a `truncated: true` flag

#### Scenario: Fetch non-HTML content
- **WHEN** `web_fetch` fetches a URL returning `application/json` or `text/plain`
- **THEN** the system SHALL return the raw text content (no HTML stripping)

#### Scenario: Fetch fails with HTTP error
- **WHEN** `web_fetch` receives an HTTP 404 or 500 response
- **THEN** the tool SHALL return `{ success: false, error: "Fetch failed: HTTP <status>" }`

#### Scenario: Fetch timeout
- **WHEN** the fetch request takes longer than 15 seconds
- **THEN** the system SHALL abort and return a timeout error

#### Scenario: Invalid URL
- **WHEN** the agent calls `web_fetch` with a malformed URL
- **THEN** the tool SHALL return `{ success: false, error: "Invalid URL" }`

### Requirement: web_fetch respects redirects
The `web_fetch` tool SHALL follow HTTP redirects (up to 5 hops).

#### Scenario: Redirect followed
- **GIVEN** `https://short.url/abc` redirects to `https://example.com/full-page`
- **WHEN** `web_fetch` is called with `url: "https://short.url/abc"`
- **THEN** the system SHALL follow the redirect and return content from the final URL

