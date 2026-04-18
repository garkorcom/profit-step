# Core 04 — External API — Test Plan

> **Parent spec:** [`SPEC.md`](./SPEC.md)

---

## 1. API contract tests

Для каждого endpoint — минимум 2 tests:

### Documents
- ✓ POST /documents создаёт draft, returns 201 + documentId + reservation info
- ✓ POST /documents с invalid payload → 400 VALIDATION_ERROR
- ✓ GET /documents/:id возвращает document
- ✓ GET /documents/:id несуществующий → 404
- ✓ PATCH /documents/:id (draft) → обновляет
- ✓ PATCH /documents/:id (posted) → 409 DOCUMENT_NOT_EDITABLE
- ✓ POST /documents/:id/post → 200 + ledgerEntryIds
- ✓ POST /documents/:id/post (retry same Idempotency-Key) → same result, alreadyPosted: true
- ✓ POST /documents/:id/void (posted) → creates reversal document

### Balances
- ✓ GET /balances?locationId=X → array с onHand/reserved/available
- ✓ GET /balances?itemId=Y → across locations
- ✓ GET /balances/available?locationId&itemId → single object
- ✓ POST /balances/recalculate (admin) → returns drifts
- ✓ POST /balances/recalculate без admin scope → 403

### Ledger
- ✓ GET /ledger?locationId=X&from&to — returns entries
- ✓ GET /ledger?projectId=P → project-scoped
- ✓ GET /ledger/cost-summary?projectId=P&groupBy=phaseCode → aggregated

### Items, Locations, Norms
- ✓ CRUD operations на каждой коллекции
- ✓ Unique constraint на SKU
- ✓ Soft-delete (isActive: false)

### AI endpoints
- ✓ POST /agent/parse-receipt c mock Gemini → draft receipt
- ✓ POST /agent/propose-writeoff → draft issue
- ✓ POST /agent/sessions/:userId/confirm → posts draft
- ✓ POST /agent/sessions/:userId/cancel → voids draft

---

## 2. Auth tests

- ✓ No Authorization header → 401 UNAUTHORIZED
- ✓ Invalid token → 401
- ✓ Valid token, insufficient scope → 403 FORBIDDEN_SCOPE
- ✓ warehouse:read can GET, cannot POST
- ✓ warehouse:write can POST, cannot DELETE items
- ✓ warehouse:admin can call /recalculate

---

## 3. RLS tests

- ✓ Worker token → GET /documents filters to own createdBy
- ✓ Foreman → sees team
- ✓ Manager → all warehouse + van
- ✓ Admin → all

---

## 4. Rate limiting tests

- ✓ warehouse:read 100 req/min — 101-й → 429
- ✓ Headers X-RateLimit-* present

---

## 5. Idempotency tests

- ✓ Post с Idempotency-Key: abc → cached в wh_idempotency_keys
- ✓ Retry same key → same response, 0 new ledger entries
- ✓ Same key + different payload → 409 IDEMPOTENCY_KEY_CONFLICT

---

## 6. Error code coverage

Каждый error code из §7 SPEC должен иметь test.

---

## 7. Webhooks delivery tests

- ✓ Post document → event published
- ✓ Subscriber receives с правильным payload schema
- ✓ Failed delivery → retry (via existing webhook infra)

---

## 8. OpenAPI schema validation

- ✓ Generated schema matches actual responses (contract test)
- ✓ No breaking changes between versions

---

## 9. Coverage target

- Unit: 85%+ для routes
- Integration: все endpoints (happy path + 1 error path каждый)

---

## 10. История

- **2026-04-18** — v1.0.
