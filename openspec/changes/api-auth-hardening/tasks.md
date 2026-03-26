## 1. Shared Auth Policy

- [ ] 1.1 Define one auth mechanism for internal/admin APIs (`Authorization: Bearer <token>`)
- [ ] 1.2 Add shared token verification utility for Next.js routes and mini-services
- [ ] 1.3 Add startup validation for required auth secrets

## 2. Protect Next.js Admin Routes

- [ ] 2.1 Enforce auth on `/api/agents`
- [ ] 2.2 Enforce auth on `/api/tasks` (including execute/create paths)
- [ ] 2.3 Enforce auth on `/api/sessions`, `/api/audit`, `/api/skills`, `/api/workspace`, `/api/tools`
- [ ] 2.4 Ensure unauthenticated requests return 401 without sensitive details

## 3. Protect Service Boundaries

- [ ] 3.1 Add auth check for `POST /broadcast` in `openclaw-ws`
- [ ] 3.2 Update scheduler HTTP calls to include service auth token
- [ ] 3.3 Verify webhook signature auth remains separate and unaffected

## 4. Ops & Observability

- [ ] 4.1 Add security logs for auth failures (route, source IP, reason)
- [ ] 4.2 Add docs for secure local/dev and deployment configuration
- [ ] 4.3 Add explicit `OPENCLAW_ALLOW_INSECURE_LOCAL=true` escape hatch for local-only testing

## 5. Testing

- [ ] 5.1 Add route tests that assert 401 for missing/invalid tokens
- [ ] 5.2 Add route tests that assert 200/expected behavior for valid token
- [ ] 5.3 Add integration test for scheduler-to-Next.js authenticated task flow
- [ ] 5.4 Add integration test for authenticated/unauthenticated WS broadcast
