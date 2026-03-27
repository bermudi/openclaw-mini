## 1. Add authentication to API routes

- [x] 1.1 Add `requireInternalAuth` to `/api/input` route (POST)
- [x] 1.2 Add `requireInternalAuth` to `/api/triggers` route (GET, POST)
- [x] 1.3 Add `requireInternalAuth` to `/api/triggers/[id]` route (GET, PUT, DELETE)
- [x] 1.4 Add `requireInternalAuth` to `/api/channels/bindings` route (GET, POST)
- [x] 1.5 Replace `validateApiKey` with `requireInternalAuth` in `/api/channels/bindings/[id]` route (DELETE)

## 2. Update cross-process callers

- [x] 2.1 Update WhatsApp adapter to use `buildInternalAuthHeaders()` when calling `/api/input`
- [x] 2.2 Verify WhatsApp adapter tests work with auth

## 3. Refactor in-process callers

- [x] 3.1 Refactor A2A tool to call `inputManager.processInput()` directly instead of HTTP loopback
- [x] 3.2 Remove HTTP bearer auth handling from A2A tool (if no longer needed)

## 4. Update browser clients

- [x] 4.1 Add bearer auth to webchat `/api/input` calls (or document insecure-local requirement)
- [x] 4.2 Add bearer auth to dashboard send-message calls (or document insecure-local requirement)

## 5. Add tests

- [x] 5.1 Add test for `/api/input` rejecting requests without auth
- [x] 5.2 Add test for `/api/input` accepting requests with valid auth
- [x] 5.3 Add test for `/api/triggers` rejecting requests without auth
- [x] 5.4 Add test for `/api/triggers/[id]` rejecting requests without auth
- [x] 5.5 Add test for `/api/channels/bindings` rejecting requests without auth
- [x] 5.6 Verify existing `requireInternalAuth` tests pass

## 6. Documentation

- [x] 6.1 Update BUGS.md to remove auth gap entries
- [x] 6.2 Update any API documentation to reflect auth requirements
