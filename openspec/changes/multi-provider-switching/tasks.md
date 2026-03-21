## 1. Session State Extension

- [x] 1.1 Add `activeProvider` and `activeModel` fields to session state type
- [x] 1.2 Initialize session state with config defaults (`agent.provider`, `agent.model`)
- [x] 1.3 Update session creation to set initial provider/model from config

## 2. Command Parsing

- [x] 2.1 Add `/provider <name>` command to message parser
- [x] 2.2 Add `/model <name>` command to message parser
- [x] 2.3 Add `/providers` command to list available providers
- [x] 2.4 Parse command arguments and validate non-empty

## 3. Provider Switching Logic

- [x] 3.1 Create `switchProvider(sessionId, providerName)` function
- [x] 3.2 Validate provider exists in registry
- [x] 3.3 Update session's `activeProvider` on valid switch
- [x] 3.4 Return error with available providers on invalid switch

## 4. Model Switching Logic

- [x] 4.1 Create `switchModel(sessionId, modelName)` function
- [x] 4.2 Update session's `activeModel` on switch
- [x] 4.3 Accept any model string (no pre-validation)

## 5. Integration

- [x] 5.1 Update agent inference to use session's `activeProvider` and `activeModel`
- [x] 5.2 Wire command handlers to switching functions
- [x] 5.3 Return confirmation message on successful switch

## 6. Testing

- [x] 6.1 Test `/provider` with valid provider
- [x] 6.2 Test `/provider` with invalid provider (shows available)
- [x] 6.3 Test `/model` with various model names
- [x] 6.4 Test `/providers` lists all configured providers
- [x] 6.5 Test session isolation (multiple sessions with different providers)
- [x] 6.6 Test new session uses config defaults (not previous session's switches)
