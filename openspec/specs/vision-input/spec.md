# vision-input Specification

## Purpose
TBD - created by archiving change attachments. Update Purpose after archive.
## Requirements
### Requirement: VisionInput type definition
The system SHALL define a `VisionInput` type representing a compressed photo suitable for multimodal LLM processing.

#### Scenario: VisionInput structure
- **WHEN** a compressed photo is received from a channel
- **THEN** the system SHALL represent it as a `VisionInput` with `channelFileId` (string), `localPath` (string), and `mimeType` (string)

### Requirement: Vision inputs passed as image content parts
The agent executor SHALL pass vision inputs to the LLM as image content parts when the model supports vision.

#### Scenario: Vision-capable model with image
- **WHEN** a task has vision inputs and the active model supports vision
- **THEN** the executor SHALL include the images as `{ type: 'image', image: Buffer }` content parts in the prompt alongside any text content

#### Scenario: Multiple vision inputs
- **WHEN** a task has multiple vision inputs
- **THEN** the executor SHALL include all images as separate content parts

### Requirement: Non-vision model fallback with text
The system SHALL handle vision inputs gracefully when the active model does not support vision.

#### Scenario: Non-vision model with image and text
- **WHEN** a task has vision inputs AND text content, and the active model does not support vision
- **THEN** the executor SHALL process the text content without images, generate the text-only response, AND deliver a warning to chat: "⚠️ Your current model doesn't support vision. Send images as file attachments, or switch to a vision-capable model."

#### Scenario: Non-vision model with image only
- **WHEN** a task has vision inputs but NO text content, and the active model does not support vision
- **THEN** the executor SHALL NOT run the LLM, and SHALL deliver an error to chat: "❌ Your current model doesn't support vision. Send images as file attachments, or switch to a vision-capable model."

### Requirement: Vision capability detection
The system SHALL detect whether a model supports vision input.

#### Scenario: Poe catalog model with vision
- **WHEN** the model is in the Poe catalog and has `image` in `inputModalities`
- **THEN** the system SHALL report it as vision-capable

#### Scenario: Known vision model
- **WHEN** the model matches a known vision-capable model identifier (e.g., gpt-4o, gpt-4.1, claude-3-sonnet, claude-3-opus, claude-3-haiku, claude-3-5-sonnet, claude-3-7-sonnet, gemini-2.0-flash, gemini-2.5-pro)
- **THEN** the system SHALL report it as vision-capable

#### Scenario: Unknown model defaults
- **WHEN** the model is not in any catalog and not in the known vision models list
- **THEN** the system SHALL default to NOT vision-capable

### Requirement: Vision inputs passed through task hierarchies
The system SHALL support passing `visionInputs` through parent and sub-agent task payloads.

#### Scenario: Top-level message forwards vision inputs to a sub-agent
- **WHEN** a parent task spawns a child with inherited `visionInputs`
- **THEN** the child task SHALL preserve those `visionInputs` and the executor SHALL treat them as multimodal input

