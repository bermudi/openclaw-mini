## 1. Add withInit() to database-accessing routes

- [x] 1.1 Wrap `GET /api/sessions` with `withInit()` — ALREADY DONE
- [ ] 1.2 Wrap `GET /api/sessions/messages` with `withInit()` — ROUTE DOES NOT EXIST (may need to create or was renamed)
- [ ] 1.3 Wrap `POST /api/sessions/[id]/compact` with `withInit()`
- [x] 1.4 Wrap `GET/PUT/DELETE /api/agents/[id]` with `withInit()` — GET already done, need to verify PUT/DELETE
- [ ] 1.5 Wrap `GET/POST /api/agents/[id]/memory` with `withInit()`
- [ ] 1.6 Wrap `GET /api/agents/[id]/memory/history` with `withInit()`
- [ ] 1.7 Wrap `GET /api/agents/[id]/memory/[key]/at/[sha]` with `withInit()`
- [ ] 1.8 Wrap `GET /api/audit` with `withInit()`
- [x] 1.9 Wrap `GET/POST /api/tools` with `withInit()` — ALREADY DONE

## 2. Add withInit() to external-facing webhook routes

- [ ] 2.1 Wrap `POST /api/webhooks/[source]` with `withInit()`
- [ ] 2.2 Wrap `GET /api/webhooks/[source]` with `withInit()` — ROUTE DOES NOT EXIST (POST only?)
- [x] 2.3 Wrap `POST /api/channels/telegram/webhook` with `withInit()` — ALREADY DONE

## 3. Add withInit() to remaining channel routes

- [x] 3.1 Wrap `GET/POST /api/channels/bindings` with `withInit()` — ALREADY DONE
- [ ] 3.2 Wrap `DELETE /api/channels/bindings/[id]` with `withInit()`
- [x] 3.3 Wrap `GET /api/channels/whatsapp/qr` with `withInit()` — ALREADY DONE

## 4. Add input validation and error handling

- [x] 4.1 Add try/catch around `JSON.parse()` in `POST /api/triggers/[id]/fire` — ALREADY DONE (wrapped in outer try/catch)
- [ ] 4.2 Add zod validation schema to `PUT /api/triggers/[id]`
- [x] 4.3 Add channel type validation to `POST /api/channels/bindings` — ALREADY DONE (validates against ChannelType enum)

## 5. Verify and test

- [ ] 5.1 Run existing tests to ensure no regressions
- [ ] 5.2 Verify remaining 8 routes now use `withInit()` by grepping the codebase

## Triage Notes (2026-04-03)

Many tasks were already completed in previous refactors. Remaining work:
- 1.3, 1.5, 1.6, 1.7 (session/memory routes)
- 1.4 verification for PUT/DELETE /api/agents/[id]
- 1.8 /api/audit
- 2.1 webhook routes
- 3.2 DELETE binding route
- 4.2 zod validation for PUT triggers