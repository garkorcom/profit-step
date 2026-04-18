# Improvement 03 — Sync с Estimate Agent

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 5)
> **Scope:** Estimate ↔ Warehouse. Estimate published → procurement plan; vendor quotes → estimate enrichment.

---

## 1. Зачем

Estimate agent сгенерировал смету на kitchen remodel. Warehouse agent должен:
1. Auto-trigger UC4 procurement plan
2. Аллоцировать доступные материалы
3. Подсчитать real cost по current stock + quotes
4. Вернуть Estimate agent: "вот актуальная material cost для recalc estimate"

---

## 2. Direction

Bidirectional:
- **Estimate → Warehouse:** `estimate.published`, `estimate.updated`
- **Warehouse → Estimate:** `vendor_quote_received`, `procurement_plan_ready`, `materials_price_updated`

---

## 3. Events Estimate → Warehouse

### 3.1. `estimate.published`

**Payload:**
```json
{
  "estimateId": "est_...",
  "projectId": "proj_dvorkin",
  "clientId": "client_dvorkin",
  "lines": [
    { "itemHint": "Outlet 15A Duplex", "qty": 40, "unit": "each", "unitCost": 2.80 },
    { "itemHint": "Wire 12-2 NM-B", "qty": 300, "unit": "ft", "unitCost": 0.36 },
    ...
  ],
  "totalMaterialsCost": 2840.00,
  "publishedAt": "..."
}
```

**Warehouse action:**
1. Вызвать `buildProcurementPlan(estimateId)` (UC4)
2. Match line items к catalog (fuzzy)
3. Check stock / create reservations / build shopping cart / start web search for unmatched
4. Публикует `warehouse.procurement_plan_ready` когда готов

### 3.2. `estimate.line_added` / `estimate.line_updated` / `estimate.line_removed`

**Warehouse action:** incremental update к existing procurement plan.

---

## 4. Events Warehouse → Estimate

### 4.1. `warehouse.procurement_plan_ready`

**Payload:**
```json
{
  "estimateId": "...",
  "projectId": "...",
  "summary": {
    "itemsAllocatedInternal": 12,
    "itemsToBuyExternal": 8,
    "itemsNeedingQuote": 3,
    "itemsNotFound": 2,
    "plannedTotalCost": 2850.00,
    "varianceFromEstimate": 10.00
  },
  "details": { /* full plan */ }
}
```

**Estimate action:** may update estimate totals based on real cost.

### 4.2. `warehouse.vendor_quote_received`

**Trigger:** RFQ email получил ответ от vendor (см. [`10_vendor_email/`](../10_vendor_email/)).

**Payload:**
```json
{
  "vendorId": "vendor_mike",
  "quoteId": "...",
  "projectId": "...",
  "items": [
    { "itemHint": "Lutron Diva Dimmer", "qty": 4, "unitCost": 18.50, "leadTimeDays": 3 }
  ]
}
```

**Estimate action:** update estimate line с реальной ценой, recalc total.

### 4.3. `warehouse.materials_price_updated`

**Trigger:** receipt с new price меняет lastPurchasePrice значимо (>10% difference).

**Estimate action:** notify active estimates что их material cost assumption устарел.

---

## 5. API Estimate → Warehouse (sync)

### `POST /api/warehouse/agent/quick-price-lookup`

Body: `{ itemHint: "Outlet 15A", qty: 40 }`.

Response: `{ itemId, currentAvgCost, availableQty, bestVendorQuote?, estimatedLeadTime }`.

Used by Estimate когда собирает smета — quick sanity check without full procurement plan.

### `POST /api/warehouse/agent/reserve-for-estimate`

Body: `{ estimateId, lines }`.

Response: draft issue/transfer documents с reservations.

---

## 6. Contract

`functions/src/shared/agentContracts/warehouseToEstimate.ts` — Zod schemas для всех events + API payloads.

---

## 7. Acceptance

- [ ] Estimate 50 lines → procurement plan готов за < 30 сек
- [ ] Reservations created, `warehouse.procurement_plan_ready` published
- [ ] Vendor quote → Estimate line updated
- [ ] Quick price lookup < 1 сек per item
- [ ] Material price change > 10% → notification to active estimates

## 8. Edge cases

- Estimate с unmatched lines (item не в catalog) → web search kicks in (UC4 sub)
- Estimate updated после plan built → incremental re-plan
- Partial availability — аllocate что есть, остальное в shopping cart

## 9. Open questions

1. **Two-way sync** — если Warehouse получил vendor quote $18 for Lutron, но Estimate имеет $20, кто prevails?
2. **Estimate versioning** — если estimate revised, procurement plan voids/updates?

## 10. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 11. История
- **2026-04-18** — v1.0.
