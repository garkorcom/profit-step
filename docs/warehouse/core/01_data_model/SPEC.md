# Core 01 — Data Model

> **Parent:** [`MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Tests:** [`TESTS.md`](./TESTS.md)
> **Scope:** Firestore collections, schemas, indexes, invariants. **Без** AI logic, API, бизнес-правил posting — только shape данных.

---

## 1. Наименование + prefix

Все collections — с префиксом `wh_` (warehouse):

| Collection | Назначение | Subcollection? |
|---|---|---|
| `wh_items` | Catalog позиций | no |
| `wh_categories` | Дерево категорий | no |
| `wh_locations` | Склады / van / site / quarantine | no |
| `wh_documents` | Receipt/Issue/Transfer/Count/Adjustment/Reversal | lines — subcollection |
| `wh_documents/{docId}/lines` | Строки документа | subcollection |
| `wh_ledger` | Immutable journal движений | no |
| `wh_balances` | Materialized projection (locationId+itemId → qty) | no |
| `wh_count_sessions` | Сессии инвентаризации | lines — subcollection |
| `wh_count_sessions/{id}/lines` | Строки подсчёта | subcollection |
| `wh_norms` | Нормативы расхода для UC3 | no |
| `wh_vendors` | Поставщики | no |
| `wh_events` | Доменные события (кто/что, для других агентов) | no |
| `wh_audit_log` | Технический лог вызовов API | no |
| `wh_idempotency_keys` | Кэш идемпотентности (24h TTL) | no |
| `warehouse_ai_sessions` | AI-agent state | no |
| `warehouse_ai_events` | AI-agent audit | no |

---

## 2. Общие поля всех entities

Каждая запись содержит как минимум:

```typescript
interface EntityBase {
  id: string;                       // Firestore docId
  schemaVersion: number;            // 1 на старте, bumps при migrations
  createdAt: Timestamp;             // server timestamp
  updatedAt: Timestamp;             // server timestamp
  createdBy: string;                // userId
  createdByType: 'human' | 'ai_agent' | 'system';
  createdByAgentId?: string;        // для ai_agent: "warehouse_ai" | "estimate_ai" | ...
}
```

`schemaVersion` — страховка на будущее, позволяет migration без guesswork.

---

## 3. `wh_items` — catalog

```typescript
interface WhItem extends EntityBase {
  sku: string;                      // unique (enforced)
  name: string;
  category: string;                 // references wh_categories.id
  
  // UOM
  baseUOM: string;                  // 'ft', 'each', 'lb', 'roll', ...
  purchaseUOMs: Array<{
    uom: string;
    factor: number;                 // convert to baseUOM
    isDefault: boolean;
  }>;
  allowedIssueUOMs: string[];       // обычно [baseUOM], иногда fractional
  
  // Pricing
  lastPurchasePrice: number;        // в baseUOM
  averageCost: number;              // rolling, в baseUOM
  defaultPurchasePrice?: number;    // catalog price если lastPurchasePrice=0
  
  // Stock thresholds
  minStock?: number;                // в baseUOM, для low-stock alerts
  reorderPoint?: number;
  
  // Policy flags
  allowNegativeStock?: boolean;     // override locationType default
  isTrackable: boolean;             // для tools — кто держит
  
  // Lifecycle
  isActive: boolean;                // soft delete: false = не использовать в новых doc
  archivedAt?: Timestamp;
  archivedBy?: string;
  archiveReason?: string;
  
  // Optional serial tracking (Phase 8+)
  requiresSerialNumber?: boolean;
}
```

### Example

```json
{
  "id": "item_wire_12_2_nmb",
  "schemaVersion": 1,
  "sku": "WIRE-12-2-NMB",
  "name": "Wire 12-2 NM-B THHN",
  "category": "cat_electrical_cable",
  "baseUOM": "ft",
  "purchaseUOMs": [
    { "uom": "roll_250ft", "factor": 250, "isDefault": true },
    { "uom": "roll_500ft", "factor": 500, "isDefault": false },
    { "uom": "ft", "factor": 1, "isDefault": false }
  ],
  "allowedIssueUOMs": ["ft"],
  "lastPurchasePrice": 0.36,
  "averageCost": 0.34,
  "minStock": 100,
  "isTrackable": false,
  "isActive": true,
  "createdAt": "2026-04-18T12:00:00Z",
  "createdBy": "user_denis",
  "createdByType": "human"
}
```

### Indexes

- `sku` — unique (enforced via `wh_items_sku_index` flat collection с doc id = sku)
- `category, isActive, name` — для list с фильтром
- `isActive, updatedAt` — для sync

### Правила именования

- `id` — `item_<slug>` (slug from SKU, lowercase, underscores)
- `sku` — uppercase + dashes (e.g. `WIRE-12-2-NMB`)

---

## 4. `wh_categories`

```typescript
interface WhCategory extends EntityBase {
  name: string;                     // "Electrical cable"
  slug: string;                     // "electrical_cable"
  parentId?: string;                // для иерархии
  displayOrder: number;
  isActive: boolean;
}
```

### Indexes

- `parentId, displayOrder` — для tree rendering
- `isActive, name` — list

---

## 5. `wh_locations`

```typescript
interface WhLocation extends EntityBase {
  name: string;                     // "Main Warehouse Miami", "Van Денис", "Site Dvorkin"
  locationType: 'warehouse' | 'van' | 'site' | 'quarantine';
  
  // Для van
  ownerEmployeeId?: string;
  licensePlate?: string;
  
  // Для site
  relatedClientId?: string;
  relatedProjectId?: string;
  address?: string;
  
  // Policy
  negativeStockOverride?: 'blocked' | 'allowed' | 'allowed_with_alert';
  twoPhaseTransferEnabled: boolean; // default false
  
  // Lifecycle
  isActive: boolean;
  archivedAt?: Timestamp;
}
```

### Example

```json
{
  "id": "loc_van_denis",
  "schemaVersion": 1,
  "name": "Van Денис",
  "locationType": "van",
  "ownerEmployeeId": "emp_denis",
  "licensePlate": "MIA-1234",
  "twoPhaseTransferEnabled": false,
  "isActive": true,
  "createdByType": "system"
}
```

### Indexes

- `locationType, isActive, name`
- `ownerEmployeeId, isActive`
- `relatedClientId, relatedProjectId`

### Правила именования

- `loc_warehouse_<name>` для warehouse
- `loc_van_<employee>` для van
- `loc_site_<client>_<date>` для site (site создаются dynamically через UC1)
- `loc_quarantine_<location>` для quarantine

---

## 6. `wh_documents`

```typescript
interface WhDocument extends EntityBase {
  docNumber: string;                // "RCP-2026-00123"
  docType: 'receipt' | 'issue' | 'transfer' | 'count' | 'adjustment' | 'reversal';
  status: 'draft' | 'ready_for_review' | 'posted' | 'voided' | 'expired';
  
  eventDate: Timestamp;             // бизнес-дата операции
  
  // Location refs (optional, зависит от docType)
  sourceLocationId?: string;        // issue, transfer
  destinationLocationId?: string;   // receipt, transfer
  locationId?: string;              // count, adjustment (single location)
  
  // Business context
  reason?: string;                  // issue reasons: project_installation, damage_*, etc.
  projectId?: string;
  phaseCode?: 'rough_in' | 'trim' | 'service' | 'service_call' | 'change_order' | 'warranty';
  costCategory?: 'materials' | 'equipment' | 'consumables';
  
  // Vendor (receipt)
  vendorId?: string;
  vendorReceiptNumber?: string;     // store receipt number
  
  // Transfer-specific
  transferStatus?: 'shipped' | 'received';  // для future two-phase
  
  // Reversal-specific
  reversalOf?: string;              // documentId оригинала
  
  // Posting result (filled at post time)
  postedAt?: Timestamp;
  postedBy?: string;
  ledgerEntryIds?: string[];
  
  // Void
  voidedAt?: Timestamp;
  voidedBy?: string;
  voidReason?: string;
  
  // AI context
  reservationExpiresAt?: Timestamp; // AI drafts: createdAt + 48h
  aiSessionId?: string;
  
  // Idempotency
  idempotencyKey?: string;
  
  // Metadata
  note?: string;
  attachmentUrls?: string[];        // receipt photo, etc.
  source: 'ui' | 'api' | 'ai' | 'import';
  totals?: {
    subtotal: number;
    tax?: number;
    total: number;
    currency: string;               // default 'USD'
  };
}
```

### Subcollection `wh_documents/{docId}/lines`

```typescript
interface WhDocumentLine {
  id: string;                       // lineId
  lineNumber: number;               // 1, 2, 3... для ordering
  
  itemId: string;
  uom: string;                      // что передал клиент
  qty: number;                      // в переданной uom
  baseQty?: number;                 // filled at posting, после UOM conversion
  
  // Pricing
  unitCost?: number;                // для receipt
  baseUnitCost?: number;            // pg pgconvert to baseUOM
  totalCost?: number;               // qty × unitCost
  
  // Count-specific
  systemQty?: number;               // что было в системе на момент подсчёта
  countedQty?: number;              // что насчитано
  variance?: number;                // countedQty - systemQty
  
  // Project attribution (override document level)
  projectId?: string;
  phaseCode?: string;
  costCategory?: string;
  
  // Metadata
  note?: string;
  
  // Parse metadata (для AI-created docs)
  rawText?: string;                 // оригинальная строка из чека
  matchConfidence?: number;         // 0-1 для fuzzy match
}
```

### Почему subcollection

- Строк может быть 50+ на большой receipt — inline array раздувает parent doc
- Проще удалять draft (subcollection deletion через batch)
- Locality: line queries idёт по субколлекции без full parent read
- Independent indexing (по itemId, projectId на уровне line)

### Indexes

`wh_documents`:
- `docType, status, eventDate DESC`
- `status, createdByType, createdAt DESC` — для AI drafts monitoring
- `source, createdAt DESC`
- `projectId, phaseCode, eventDate DESC` — для project reports
- `sourceLocationId, eventDate DESC`
- `destinationLocationId, eventDate DESC`
- `status, reservationExpiresAt` — для TTL job
- `idempotencyKey` (collection group, если нужно global)

`wh_documents/.../lines`:
- `itemId` — lines by item across documents

### Правила именования docNumber

- `RCP-YYYY-NNNNN` — receipt
- `ISS-YYYY-NNNNN` — issue
- `TRF-YYYY-NNNNN` — transfer
- `CNT-YYYY-NNNNN` — count session (document типа count)
- `ADJ-YYYY-NNNNN` — adjustment
- `REV-YYYY-NNNNN` — reversal

Sequence generator — отдельный counter doc в `wh_counters/{docType}` с атомарным increment через transaction.

---

## 7. `wh_ledger` — immutable journal

```typescript
interface WhLedgerEntry {
  id: string;                       // ledgerEntryId
  schemaVersion: number;
  
  // Refs
  documentId: string;
  lineId: string;
  
  // What moved
  itemId: string;
  locationId: string;
  deltaQty: number;                 // signed! -5 для списания, +10 для прихода
  direction: 'in' | 'out';          // convenience, всегда coherent с sign(deltaQty)
  
  // Cost snapshot (КРИТИЧНО для COGS)
  unitCostAtPosting: number;        // в baseUOM, обязательно для receipt, optional для issue
  
  // Project allocation
  projectId?: string;
  phaseCode?: string;
  costCategory?: string;
  
  // Reversal
  reversalOf?: string;              // ledgerEntryId оригинала
  
  // Dates
  eventDate: Timestamp;             // бизнес
  postedAt: Timestamp;              // техническая
  
  // Actor
  postedBy: string;
}
```

### Immutability

- **Write**: только через `postDocument()` transaction
- **Update/Delete**: запрещены security rules — admin SDK only
- **Reversal**: создаёт НОВЫЙ ledger entry с `reversalOf` ref, оригинал остаётся

### Indexes

- `itemId, locationId, eventDate DESC` — основной query (ledger by item+location)
- `documentId` — все entries документа
- `projectId, phaseCode, eventDate` — reports
- `locationId, eventDate DESC`
- `postedBy, eventDate DESC`
- `reversalOf` (sparse)

### Security rules

```javascript
match /wh_ledger/{id} {
  allow read: if isAuthenticated() && hasScope('warehouse:read');
  allow write: if false;  // only admin SDK через postDocument transaction
}
```

---

## 8. `wh_balances` — materialized projection

```typescript
interface WhBalance {
  id: string;                       // compound key: `${locationId}__${itemId}`
  schemaVersion: number;
  
  locationId: string;
  itemId: string;
  
  onHandQty: number;                // в baseUOM
  reservedQty: number;              // sum qty из draft docs с projectId
  availableQty: number;             // onHandQty - reservedQty (computed, denormalized)
  
  // Last activity
  lastLedgerEntryId?: string;
  lastEventDate?: Timestamp;
  updatedAt: Timestamp;
  
  // Flags
  needsReconciliation?: boolean;    // set когда negative on van/site
}
```

### Compound key — почему

ID = `${locationId}__{itemId}` даёт:
- O(1) lookup через `db.collection('wh_balances').doc(key).get()`
- Нет необходимости в composite index
- Deterministic key — легко тестировать

Альтернатива autoId + composite index (locationId, itemId) медленнее и усложняет code.

### Update rules

- Изменяется только в `postDocument()` transaction, атомарно с ledger entries
- `availableQty` пересчитывается вместе с другими полями (не computed query time)
- Background integrity check (§ 13) сравнивает `sum(ledger.deltaQty)` vs `onHandQty`

### Indexes

- `locationId, itemId` (redundant с compound key, но нужен для `where` queries)
- `itemId, availableQty` — для item views
- `locationId, availableQty` — for location views
- `needsReconciliation, locationId` — для inventory count planning

---

## 9. `wh_count_sessions`

```typescript
interface WhCountSession extends EntityBase {
  sessionNumber: string;            // "CNT-2026-00042"
  status: 'counting' | 'review' | 'posted' | 'voided';
  
  locationId: string;
  startedAt: Timestamp;
  completedAt?: Timestamp;
  
  // Результат post
  generatedAdjustmentDocIds?: string[];
  
  note?: string;
}
```

### Subcollection `wh_count_sessions/{id}/lines`

```typescript
interface WhCountLine {
  id: string;
  itemId: string;
  systemQty: number;                // snapshot на startedAt
  countedQty: number;
  variance: number;                 // countedQty - systemQty
  note?: string;
  countedBy: string;                // employee who physically counted
  countedAt: Timestamp;
}
```

---

## 10. `wh_norms`

```typescript
interface WhNorm extends EntityBase {
  taskType: string;                 // "install_outlet" — matches GTDTask.templateType
  name: string;                     // "Стандартная установка розетки"
  description?: string;
  
  items: Array<{
    itemId: string;
    qtyPerUnit: number;             // units of item per 1 unit of taskType
    note?: string;
  }>;
  
  estimatedLaborHours?: number;
  
  isActive: boolean;
}
```

### Example

```json
{
  "id": "norm_install_outlet",
  "taskType": "install_outlet",
  "name": "Standard outlet installation",
  "items": [
    { "itemId": "item_outlet_15a", "qtyPerUnit": 1 },
    { "itemId": "item_wire_12_2_nmb", "qtyPerUnit": 5 },
    { "itemId": "item_box_1gang", "qtyPerUnit": 1 },
    { "itemId": "item_wirenut_yellow", "qtyPerUnit": 3 }
  ],
  "estimatedLaborHours": 0.5,
  "isActive": true
}
```

### Indexes

- `taskType, isActive` — lookup в UC3

---

## 11. `wh_vendors`

```typescript
interface WhVendor extends EntityBase {
  name: string;                     // "Home Depot Pro", "Mike's Electrical Supply"
  vendorType: 'big_box' | 'local_supply' | 'subcontractor_proxy' | 'online';
  
  // Contact (для RFQ email)
  contactEmail?: string;
  contactPhone?: string;
  contactName?: string;
  
  // Payment terms
  defaultPaymentTerms?: string;     // "Net 30", "COD"
  preferredForCategories?: string[]; // ['cat_electrical_*']
  
  // API integration (Phase 5+)
  apiEndpoint?: string;
  apiCredentialsKey?: string;       // ref на Secret Manager
  
  isActive: boolean;
}
```

---

## 12. `wh_events` vs `wh_audit_log`

### `wh_events` — доменные события для других агентов

```typescript
interface WhEvent {
  id: string;
  schemaVersion: number;
  
  eventType: string;                // "warehouse.document.posted"
  entityType: string;               // "document" | "reservation" | "balance"
  entityId: string;
  
  payload: Record<string, unknown>; // event-specific data
  
  occurredAt: Timestamp;
  publishedAt?: Timestamp;          // когда webhook отправлен
  subscribers?: string[];           // кто подписан
  deliveryStatus?: Record<string, 'pending' | 'delivered' | 'failed'>;
}
```

### `wh_audit_log` — технический лог

```typescript
interface WhAuditLog {
  id: string;
  schemaVersion: number;
  
  actionType: string;               // "document.created", "document.posted", "balance.recalculate"
  endpoint?: string;                // "/api/warehouse/documents/:id/post"
  
  actor: {
    userId: string;
    actorType: 'human' | 'ai_agent' | 'system';
    agentId?: string;
    ip?: string;
    userAgent?: string;
  };
  
  target: {
    entityType: string;
    entityId: string;
  };
  
  before?: Record<string, unknown>; // snapshot до
  after?: Record<string, unknown>;  // snapshot после
  
  requestId?: string;
  occurredAt: Timestamp;
}
```

**Разница:** `wh_events` — что случилось в бизнес-смысле (publish для других агентов). `wh_audit_log` — технический лог кто что вызвал (для security / debugging / compliance). Не смешивать.

---

## 13. `wh_idempotency_keys`

```typescript
interface WhIdempotencyKey {
  id: string;                       // sha256(endpoint + body + userId + key) или client-supplied key
  key: string;                      // original client key
  endpoint: string;
  userId: string;
  payloadHash: string;              // для detection of conflict
  
  result: {
    statusCode: number;
    body: Record<string, unknown>;
  };
  
  createdAt: Timestamp;
  expiresAt: Timestamp;              // TTL 24h
}
```

### TTL

Firestore TTL policy на `expiresAt` — автоматическое удаление. Настраивается в Firebase Console.

---

## 14. Query patterns (cheat sheet)

| Нужно получить | Query |
|---|---|
| Balance на конкретной location/item | `doc('${locationId}__${itemId}').get()` |
| All balances на location | `where('locationId', '==', X).orderBy('availableQty', 'desc')` |
| All balances для item | `where('itemId', '==', Y).orderBy('availableQty', 'desc')` |
| Ledger по item+date range | `where('itemId', '==', Y).where('eventDate', '>=', from).where('eventDate', '<=', to)` |
| Ledger по проекту | `where('projectId', '==', P).orderBy('eventDate', 'desc')` |
| Cost by project+phase | aggregate через `sum(deltaQty * unitCostAtPosting)` (Firestore aggregation query или scheduled) |
| Drafts AI с expired TTL | `where('status', '==', 'draft').where('reservationExpiresAt', '<', now)` |
| Documents by user | `where('createdBy', '==', userId).orderBy('createdAt', 'desc')` |

---

## 15. Data integrity invariants

Всегда должны выполняться:

```
I1: sum(wh_ledger.deltaQty where itemId=X, locationId=Y) == wh_balances[Y__X].onHandQty
I2: wh_balances[_].availableQty == wh_balances[_].onHandQty - wh_balances[_].reservedQty
I3: sum(wh_balances[_].reservedQty per itemId, locationId) == sum(draft_docs.lines.qty for that itemId, locationId with projectId)
I4: wh_ledger entry existence → wh_documents[documentId] exists AND status = 'posted' (or reversal of posted)
I5: wh_ledger.direction == (deltaQty > 0 ? 'in' : 'out')
I6: immutable ledger: wh_ledger writes только через postDocument transaction
```

### Background integrity job

Scheduled function `verifyWarehouseIntegrity` (daily 2am):
1. Для random 100 (locationId, itemId) пар — проверить I1
2. Для всех balances — проверить I2
3. При нарушении → event `warehouse.integrity.drift_detected` + admin alert

Детали — в [`02_posting_engine/SPEC.md`](../02_posting_engine/SPEC.md).

---

## 16. Reset + seed strategy

### Dev/staging reset

```typescript
// scripts/warehouse-reset.ts
async function fullReset(db, projectId, dryRun = true) {
  const collections = [
    'wh_items', 'wh_categories', 'wh_locations', 'wh_documents',
    'wh_ledger', 'wh_balances', 'wh_count_sessions', 'wh_norms',
    'wh_vendors', 'wh_events', 'wh_audit_log', 'wh_idempotency_keys',
  ];
  // Export to gs://backup/ before delete
  // Delete collections + subcollections recursively
  // Run seed
}
```

### Seed data (Phase 0)

- 1 warehouse: `loc_warehouse_miami`
- 3 vans (ownerEmployeeId: `emp_denis`, `emp_gena`, `emp_masha`)
- 1 quarantine: `loc_quarantine_main`
- 8-10 categories (electrical, plumbing, hvac, tools, consumables)
- 50 typical items (wire, outlets, switches, GFCI, fans, teflon tape, ...)
- 20 norms (install_outlet, replace_switch, install_gfci, install_fan, fix_leak, ...)

Seed scripts — в `functions/src/warehouse/database/seed/`.

---

## 17. Firestore-специфика

### Transaction limits

- 500 writes per transaction
- Receipt с 50 lines = 50 ledger + 50 balance updates = 100 writes — OK
- Transfer с 100 lines = 100 source balance + 100 dest balance + 200 ledger = 400 writes — близко, нужно ограничение
- **Правило:** max 100 lines per document. Для больших — разбивать на несколько документов

### Subcollection для lines

- Lines — subcollection (не inline array) потому что:
  - Parent doc не раздувается при 50+ lines
  - Scaled writes (batch delete draft lines)
  - Locality queries (line by itemId across docs)

### Compound keys для balances

- `wh_balances` doc ID = `${locationId}__${itemId}` — O(1) lookup без index
- Separator `__` (двойное подчёркивание) избегает collision с valid IDs

### Security rules summary

```javascript
match /wh_ledger/{id} {
  allow read: if hasScope('warehouse:read');
  allow write: if false;  // admin SDK only
}

match /wh_balances/{id} {
  allow read: if hasScope('warehouse:read');
  allow write: if false;  // admin SDK only
}

match /wh_documents/{id} {
  allow read: if hasScope('warehouse:read') && canAccessDocument(id);
  allow create: if hasScope('warehouse:write');
  allow update: if canEditDraft(id);     // только draft, не posted
  allow delete: if false;                  // void через reversal
  
  match /lines/{lineId} {
    allow read: if hasScope('warehouse:read') && canAccessDocument(id);
    allow write: if hasScope('warehouse:write') && canEditDraft(id);
  }
}

match /wh_items/{id} {
  allow read: if hasScope('warehouse:read');
  allow create, update: if hasScope('warehouse:admin') || (hasScope('warehouse:write') && isCreatingNew());
  allow delete: if false;  // soft-delete only
}
```

---

## 18. Scope & non-goals

### In scope этого документа

- Schemas всех collections
- Indexes (требования, не SQL)
- Compound keys
- Security rules высокого уровня
- Invariants
- Seed strategy

### НЕ в scope

- AI-agent логика → [`03_ai_agent/SPEC.md`](../03_ai_agent/SPEC.md)
- Posting algorithm detail → [`02_posting_engine/SPEC.md`](../02_posting_engine/SPEC.md)
- REST API surface → [`04_external_api/SPEC.md`](../04_external_api/SPEC.md)
- Migration cutover → [`05_rollout_migration/SPEC.md`](../05_rollout_migration/SPEC.md)
- Business rules (negative stock detail, reservation TTL, UOM conversion) → `02_posting_engine/SPEC.md`

---

## 19. Open questions

1. **Decimal precision** — 4 знака после запятой для qty / unitCost? (wire ft — целые, weight — до 3 знаков). Зафиксировать в Zod schema.
2. **docNumber sequence** — atomic counter через Firestore transaction достаточен, или нужен distributed ID generator?
3. **Soft delete retention** — archived items хранить forever или архивировать после 2 лет без ledger activity?
4. **Collection group queries** — нужны ли на subcollection `lines` (e.g. "все lines с itemId=X across documents")? Влияет на indexing.
5. **Firestore TTL** — support на `expiresAt` есть? (Yes, но настраивается в Firebase Console, не в code)

---

## 20. Связанные документы

- Parent: [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
- Sibling: [`../02_posting_engine/SPEC.md`](../02_posting_engine/SPEC.md) — как эти schemas используются в posting
- Sibling: [`../03_ai_agent/SPEC.md`](../03_ai_agent/SPEC.md) — как AI reads/writes drafts
- Sibling: [`../04_external_api/SPEC.md`](../04_external_api/SPEC.md) — API contracts
- Tests: [`./TESTS.md`](./TESTS.md)

---

## 21. История

- **2026-04-18** — v1.0. Schemas для 13 collections. Subcollection approach для document lines. Compound key для balances. Separate events vs audit_log. Schema versioning + soft delete + agent attribution.
