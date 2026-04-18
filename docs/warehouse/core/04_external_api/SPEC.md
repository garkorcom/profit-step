# Core 04 — External API

> **Parent:** [`MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Tests:** [`TESTS.md`](./TESTS.md)
> **Scope:** REST endpoints, tool-calling surface для other agents, webhooks, RLS, error codes.

---

## 1. Base URL

- Production: `https://agentapi-xxx.a.run.app/api/warehouse/*`
- Hosting rewrite: `https://profit-step.web.app/api/warehouse/*`
- Emulator: `http://localhost:5001/.../api/warehouse/*`

---

## 2. Authentication

All endpoints (except public ones) require `Authorization: Bearer <agent-token>`.

**Scopes:**
- `warehouse:read` — GET endpoints
- `warehouse:write` — + create/edit drafts, post (not void)
- `warehouse:admin` — + void, reversal, recalculate, category-policies

---

## 3. Endpoints

### 3.1. Documents

```
POST   /api/warehouse/documents
GET    /api/warehouse/documents
GET    /api/warehouse/documents/:id
PATCH  /api/warehouse/documents/:id
POST   /api/warehouse/documents/:id/post
POST   /api/warehouse/documents/:id/void
GET    /api/warehouse/documents/:id/history      (admin, debug)
```

**Create draft** (example для issue):
```
POST /api/warehouse/documents
Body:
{
  "docType": "issue",
  "eventDate": "2026-04-18",
  "sourceLocationId": "loc_van_denis",
  "reason": "project_installation",
  "projectId": "proj_dvorkin_2026",
  "phaseCode": "rough_in",
  "lines": [
    { "itemId": "item_outlet_15a", "uom": "each", "qty": 3 },
    { "itemId": "item_wire_12_2_nmb", "uom": "ft", "qty": 15 }
  ],
  "source": "ai"
}
```

Response `201`:
```json
{
  "documentId": "doc_01JFG...",
  "docNumber": "ISS-2026-00456",
  "status": "draft",
  "reservedQty": { "item_outlet_15a": 3, "item_wire_12_2_nmb": 15 },
  "reservationExpiresAt": "2026-04-20T14:00:00Z"
}
```

**Post** (idempotent):
```
POST /api/warehouse/documents/:id/post
Headers: Idempotency-Key: <client-key>
Body: {}
```

Response `200`:
```json
{
  "documentId": "...", "status": "posted",
  "ledgerEntryIds": ["le_...", "le_..."],
  "alreadyPosted": false,
  "balanceDelta": [
    { "locationId": "...", "itemId": "...", "onHandBefore": 10, "onHandAfter": 7, "reservedBefore": 3, "reservedAfter": 0 }
  ]
}
```

**Void**:
```
POST /api/warehouse/documents/:id/void
Body: { "reason": "wrong_qty", "note": "freeform" }
```

Response `200`:
```json
{ "status": "voided", "reversalDocumentId": "doc_..." }
```

### 3.2. Balances

```
GET /api/warehouse/balances?locationId=X&minAvailableQty=0
GET /api/warehouse/balances?itemId=Y
GET /api/warehouse/balances/available?locationId=X&itemId=Y
POST /api/warehouse/balances/recalculate        (admin)
```

### 3.3. Ledger

```
GET /api/warehouse/ledger?locationId=X&from=...&to=...
GET /api/warehouse/ledger?itemId=Y
GET /api/warehouse/ledger?projectId=P&phaseCode=rough_in
GET /api/warehouse/ledger/cost-summary?projectId=P&groupBy=phaseCode
```

### 3.4. Items

```
POST   /api/warehouse/items
GET    /api/warehouse/items
GET    /api/warehouse/items/:id
PATCH  /api/warehouse/items/:id      (not stockByLocation — запрещено)
DELETE /api/warehouse/items/:id      (soft-delete)
```

### 3.5. Locations

```
POST   /api/warehouse/locations
GET    /api/warehouse/locations
PATCH  /api/warehouse/locations/:id
```

### 3.6. Norms

```
POST  /api/warehouse/norms
GET   /api/warehouse/norms?taskType=X
PATCH /api/warehouse/norms/:id
```

### 3.7. AI capabilities

```
POST /api/warehouse/agent/parse-on-site
     Body: { userId, text, gpsLocation?, voiceAudioUrl? }

POST /api/warehouse/agent/parse-receipt
     Body: { userId, photoUrl, currentLocationId?, activeTripId? }

POST /api/warehouse/agent/propose-writeoff
     Body: { taskId, workerId, locationId, templateType, qty }

POST /api/warehouse/agent/build-procurement-plan
     Body: { estimateId }

POST /api/warehouse/agent/web-search
     Body: { query, maxResults? }

POST /api/warehouse/agent/send-rfq
     Body: { vendorId, items, projectId? }

POST /api/warehouse/agent/semantic-search
     Body: { query }

GET  /api/warehouse/agent/sessions/:userId
POST /api/warehouse/agent/sessions/:userId/confirm    Body: { tripId }
POST /api/warehouse/agent/sessions/:userId/cancel     Body: { tripId }
```

---

## 4. Tool-calling surface (для other AI agents)

Экспорт тех же endpoints как tools для LLM в Python SDK. ~25 tools:

### Catalog
- `warehouse_item_search(query, category?, limit?)`
- `warehouse_item_get(itemId)`
- `warehouse_item_create(payload)` (admin)

### Locations
- `warehouse_location_list(type?, ownerEmployeeId?)`
- `warehouse_location_create(payload)`

### Stock
- `warehouse_stock_at_location(locationId, itemId?)`
- `warehouse_stock_for_item(itemId)`
- `warehouse_stock_available(locationId, itemId, qtyNeeded)`

### Documents
- `warehouse_document_create(payload)`
- `warehouse_document_post(docId, idempotencyKey?)`
- `warehouse_document_void(docId, reason)`
- `warehouse_document_list(filters)`
- `warehouse_document_get(docId)`

### High-level AI
- `warehouse_plan_trip(userId, text, currentLocationId?)`
- `warehouse_parse_receipt(photoUrl, userId)`
- `warehouse_propose_writeoff(taskId)`
- `warehouse_build_procurement_plan(estimateId)`
- `warehouse_web_search_item(query, maxResults?)`
- `warehouse_send_rfq(vendorId, items, projectId?)`
- `warehouse_propose_transfer(sourceLocationId, reason)`

### Reports
- `warehouse_cost_by_project(projectId, phaseCode?, from?, to?)`
- `warehouse_low_stock_report()`
- `warehouse_dead_stock_report(daysSinceLastActivity)`

Tool definitions (JSON schemas + descriptions для LLM) — в `warehouse/api/tools/warehouseTools.ts`.

---

## 5. Webhooks (outgoing events)

Subscribers registered через `POST /api/webhooks/subscriptions` (existing webhooks infra).

### Event catalog

```
warehouse.document.posted
warehouse.document.voided
warehouse.reservation.created
warehouse.reservation.expired
warehouse.transfer.completed
warehouse.anomaly.detected
warehouse.low_stock
warehouse.critical_stock
warehouse.negative_stock
warehouse.vendor_quote_received
warehouse.procurement_plan_ready
warehouse.site_inventoried              (UC1)
warehouse.receipt.parsed                (UC2)
warehouse.task_writeoff_proposed        (UC3)
warehouse.transfer_proposed             (auto_transfers)
warehouse.integrity.drift_detected
warehouse.count.completed
warehouse.adjustment.made
```

Event payload schemas — в `functions/src/shared/agentContracts/warehouseEvents.ts`.

---

## 6. RLS (Row-Level Security)

### 6.1. Фильтры по scope

```typescript
function applyRLS(query, user) {
  if (user.role === 'admin') return query;  // no filter
  
  if (user.role === 'warehouse_manager') {
    return query.where('locationType', 'in', ['warehouse', 'van']);
  }
  
  if (user.role === 'foreman') {
    return query.where('ownerEmployeeId', 'in', [...teamIds, null]);
  }
  
  if (user.role === 'worker' || user.role === 'driver') {
    // only own van + assigned sites
    return query.where('createdBy', '==', user.id);
  }
  
  throw 'FORBIDDEN';
}
```

### 6.2. Multi-tenant (Phase 8+)

Future: `companyId` filter обязателен на всех queries. В MVP пропускаем (single tenant).

---

## 7. Error codes

| Code | HTTP | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod schema failure |
| `INVALID_UOM` | 400 | UOM not in item.purchaseUOMs / allowedIssueUOMs |
| `PROJECT_ID_REQUIRED` | 400 | Issue с project_* reason без projectId |
| `UNAUTHORIZED` | 401 | No/invalid bearer |
| `FORBIDDEN_SCOPE` | 403 | Scope insufficient |
| `DOCUMENT_NOT_FOUND` | 404 | Invalid :id |
| `INSUFFICIENT_STOCK` | 409 | warehouse/quarantine negative blocked |
| `INSUFFICIENT_AVAILABLE_STOCK` | 409 | Draft создание: available < requested |
| `DOCUMENT_ALREADY_POSTED` | 409 | Idempotent: returns cached result (не error) |
| `DOCUMENT_ALREADY_VOIDED` | 409 | Повторный void |
| `DOCUMENT_NOT_IN_POSTABLE_STATE` | 409 | Post в status ≠ draft/ready_for_review |
| `DOCUMENT_NOT_EDITABLE` | 409 | PATCH в status ≠ draft |
| `CANNOT_REVERSE_REVERSAL` | 409 | Void у docType: reversal |
| `NEGATIVE_STOCK_BLOCKED` | 409 | Policy violation на warehouse |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same key, different payload |
| `UOM_CONVERSION_FAILED` | 422 | Broken purchaseUOMs config |
| `INTERNAL_ERROR` | 500 | Unexpected — requestId в логах |

---

## 8. Response format

Success: direct JSON payload (see per-endpoint).

Error:
```json
{
  "error": {
    "code": "INSUFFICIENT_AVAILABLE_STOCK",
    "message": "Not enough available stock: requested 5, available 2",
    "details": { "locationId": "...", "itemId": "...", "requested": 5, "available": 2 },
    "requestId": "req_01JFG..."
  }
}
```

---

## 9. Rate limiting

- `warehouse:read` — 100 req/min per token
- `warehouse:write` — 30 req/min per token
- `warehouse:admin` — 10 req/min per token

Rate limit headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## 10. Pagination

Cursor-based для list endpoints:
```
GET /api/warehouse/documents?limit=50&cursor=<opaque>
```

Response includes `nextCursor` (null если end).

---

## 11. Scope & non-goals

### In scope
- REST endpoints (all CRUD + AI agent)
- Tool-calling surface (25 tools)
- Webhooks catalog
- RLS rules
- Error codes

### NOT in scope
- Core posting internals → `02_posting_engine/`
- AI capability internals → `03_ai_agent/`
- Cross-agent integration flows → `improvements/01-03_sync_*/`

---

## 12. Open questions

1. **API versioning** — нужна ли `/api/v2/warehouse/*` стратегия с первого дня или ждём breaking changes?
2. **OpenAPI / Swagger** — генерировать автоматически из Zod схем или вручную?
3. **Partner tokens** — как Python SDK партнёра получает bearer token? (token exchange flow)

---

## 13. Связанные документы

- Parent: [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
- Prev: [`../03_ai_agent/SPEC.md`](../03_ai_agent/SPEC.md)
- Next: [`../05_rollout_migration/SPEC.md`](../05_rollout_migration/SPEC.md)
- Tests: [`./TESTS.md`](./TESTS.md)

---

## 14. История

- **2026-04-18** — v1.0. REST + tool-calling + webhooks + RLS + 16 error codes.
