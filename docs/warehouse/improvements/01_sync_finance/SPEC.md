# Improvement 01 — Sync с Finance Agent

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 4)
> **Scope:** Warehouse → Finance integration. Material cost events, anomalies, valuation sync.

---

## 1. Зачем

Финансовый агент должен в реальном времени знать:
- Сколько потрачено на материалы (purchase → expense)
- На какой project ушёл cost (для margin analysis)
- Когда cost > forecast (anomaly → owner alert)
- Общая стоимость запасов (для balance sheet)

Warehouse — **source of truth** для material cost. Finance — для общей бухгалтерии.

---

## 2. Direction

**Warehouse → Finance** (primarily). Finance пишет в warehouse только для запросов (read-only API).

---

## 3. Events from Warehouse to Finance

Публикуются через `wh_events` → webhook → Finance subscriber.

### 3.1. `warehouse.document.posted` (main event)

**Triggers:** любой post document (receipt/issue/transfer/adjustment).

**Payload:**
```json
{
  "eventType": "warehouse.document.posted",
  "docType": "receipt",
  "documentId": "doc_...",
  "eventDate": "2026-04-18",
  "totals": { "subtotal": 132.00, "tax": 10.50, "total": 142.50 },
  "lines": [
    { "itemId": "...", "baseQty": 250, "unitCostAtPosting": 0.36, "totalCost": 90.00, "projectId": "...", "phaseCode": "rough_in", "costCategory": "materials" }
  ],
  "sourceLocationId": null,
  "destinationLocationId": "loc_van_denis",
  "vendorId": "vendor_home_depot",
  "source": "ai",
  "occurredAt": "2026-04-18T14:17:00Z"
}
```

**Finance action:**
- `receipt` → create expense record (category: materials), associate с projectId если есть
- `issue` с `reason: project_*` → update project COGS
- `transfer` → no action (money doesn't move)
- `adjustment` с reason `damage_*` / `loss_theft` → create expense + flag

### 3.2. `warehouse.anomaly.detected`

**Trigger:** task completion с overrun > 25% AND $ variance > $50.

**Payload:**
```json
{
  "taskId": "task_...",
  "projectId": "proj_dvorkin",
  "plannedCost": 17.00,
  "actualCost": 24.50,
  "overrunPercent": 44.1,
  "overrunValue": 7.50,
  "byItem": [
    { "itemId": "item_wire_12_2_nmb", "plannedQty": 15, "actualQty": 22, "costDiff": 2.52 }
  ]
}
```

**Finance action:** добавляет в anomaly dashboard, сверяется с task/project estimate.

### 3.3. `warehouse.reservation.created`

**Trigger:** draft issue/transfer с projectId (UC4 procurement).

**Payload:**
```json
{
  "documentId": "doc_...",
  "projectId": "proj_dvorkin",
  "reservedValue": 580.00,  // sum qty × avgCost
  "reservationExpiresAt": "2026-04-20T14:00Z"
}
```

**Finance action:** update project forecast (committed cost, not actual).

---

## 4. Finance → Warehouse (read-only API)

Finance может вызывать:

### `GET /api/warehouse/ledger/cost-summary?projectId=X&phaseCode=Y&groupBy=phaseCode`

Возвращает aggregated cost по project/phase.

### `GET /api/warehouse/balances?valuation=true`

Возвращает total inventory value (sum(onHandQty × averageCost) across all locations).

### `GET /api/warehouse/items/top-consumers?from&to`

Items с highest consumption за period.

---

## 5. Cost categories mapping

Warehouse `costCategory` → Finance account:

| Warehouse | Finance account |
|---|---|
| `materials` | Direct Materials Expense |
| `equipment` | Tools & Equipment |
| `consumables` | Consumables Expense |
| (no category) | Uncategorized Materials |

Mapping конфигурируется в Finance, не hardcoded в Warehouse.

---

## 6. Contract shape (shared file)

`functions/src/shared/agentContracts/warehouseToFinance.ts`:

```typescript
import { z } from 'zod';

export const WarehouseDocPostedSchema = z.object({
  eventType: z.literal('warehouse.document.posted'),
  docType: z.enum(['receipt', 'issue', 'transfer', 'count', 'adjustment', 'reversal']),
  documentId: z.string(),
  eventDate: z.string(),
  totals: z.object({ subtotal: z.number(), tax: z.number().optional(), total: z.number() }).optional(),
  lines: z.array(z.object({
    itemId: z.string(),
    baseQty: z.number(),
    unitCostAtPosting: z.number(),
    totalCost: z.number(),
    projectId: z.string().optional(),
    phaseCode: z.string().optional(),
    costCategory: z.string().optional(),
  })),
  sourceLocationId: z.string().nullable(),
  destinationLocationId: z.string().nullable(),
  vendorId: z.string().optional(),
  source: z.enum(['ui', 'api', 'ai', 'import']),
  occurredAt: z.string(),
});

export type WarehouseDocPostedEvent = z.infer<typeof WarehouseDocPostedSchema>;

// + other event schemas
```

Версионирование payload: `schemaVersion` field. Breaking changes = version bump + migration на стороне Finance.

---

## 7. Acceptance criteria

- [ ] `warehouse.document.posted` публикуется на каждый post
- [ ] Finance Subscriber получает + создаёт expense запись с правильной категорией
- [ ] Project cost sync: sum cost по projectId в Finance === sum в Warehouse
- [ ] Anomaly events доставлены до Денису
- [ ] Finance може pull `/cost-summary` — совпадает с balance sheet
- [ ] Contract schema test: payload от Warehouse → Zod validates на Finance side

---

## 8. Open questions

1. **Tax handling** — warehouse tracks tax в doc totals, но Finance может по-другому считать (accrual vs cash). Coordinated?
2. **Currency** — USD only пока. Future: multi-currency?
3. **Cost allocation для non-project issues** — если issue без projectId (internal_shop_use) — куда cost? (overhead bucket?)

---

## 9. CHANGELOG

См. [`CHANGELOG.md`](./CHANGELOG.md).

---

## 10. История

- **2026-04-18** — v1.0 spec.
