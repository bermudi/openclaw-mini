## 1. Add withInit() to database-accessing routes

- [ ] 1.1 Wrap `GET /api/sessions` with `withInit()`
- [ ] 1.2 Wrap `GET /api/sessions/messages` with `withInit()`
- [ ] 1.3 Wrap `POST /api/sessions/[id]/compact` with `withInit()`
- [ ] 1.4 Wrap `GET/PUT/DELETE /api/agents/[id]` with `withInit()`
- [ ] 1.5 Wrap `GET/POST /api/agents/[id]/memory` with `withInit()`
- [ ] 1.6 Wrap `GET /api/agents/[id]/memory/history` with `withInit()`
- [ ] 1.7 Wrap `GET /api/agents/[id]/memory/[key]/at/[sha]` with `withInit()`
- [ ] 1.8 Wrap `GET /api/audit` with `withInit()`
- [ ] 1.9 Wrap `GET/POST /api/tools` with `withInit()`

## 2. Add withInit() to external-facing webhook routes

- [ ] 2.1 Wrap `POST /api/webhooks/[source]` with `withInit()`
- [ ] 2.2 Wrap `GET /api/webhooks/[source]` with `withInit()`
- [ ] 2.3 Wrap `POST /api/channels/telegram/webhook` with `withInit()`

## 3. Add withInit() to remaining channel routes

- [ ] 3.1 Wrap `GET/POST /api/channels/bindings` with `withInit()`
- [ ] 3.2 Wrap `DELETE /api/channels/bindings/[id]` with `withInit()`
- [ ] 3.3 Wrap `GET /api/channels/whatsapp/qr` with `withInit()`

## 4. Add input validation and error handling

- [ ] 4.1 Add try/catch around `JSON.parse()` in `POST /api/triggers/[id]/fire` and `POST /api/internal/triggers/[id]/fire`
- [ ] 4.2 Add zod validation schema to `PUT /api/triggers/[id]`
- [ ] 4.3 Add channel type validation to `POST /api/channels/bindings`

## 5. Verify and test

- [ ] 5.1 Run existing tests to ensure no regressions
- [ ] 5.2 Verify all 14 routes now use `withInit()` by grepping the codebase