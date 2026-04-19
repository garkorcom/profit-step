# Improvement 08 — Estimate Procurement (UC4)

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 5)
> **Scope:** estimate → процедурный план закупок: internal allocation → Draft PO → RFQ → web search.
> **Зависит от:** [`09_web_sourcing/`](../09_web_sourcing/), [`10_vendor_email/`](../10_vendor_email/), [`03_sync_estimate/`](../03_sync_estimate/)

---

## 1. Flow

### Trigger
Event `estimate.published` → Warehouse AI calls `buildProcurementPlan(estimateId)`.

### Algorithm

```typescript
async function buildProcurementPlan(estimateId) {
  const estimate = await getEstimate(estimateId);
  
  const buckets = {
    internalAllocation: [],   // есть в warehouse/vans, резервируем
    buyFromVendor: [],         // знаем vendor, создаём PO
    needsQuote: [],            // special order, email RFQ
    needsWebSearch: [],        // нет в catalog, ищем в интернете
    unmatched: [],             // не нашли ни catalog ни web
  };
  
  for (const line of estimate.lines) {
    // 1. Match к catalog
    const matches = fuzzyMatchItem(line.itemHint, catalog);
    const topMatch = matches[0];
    
    if (topMatch?.confidence > 0.85) {
      // Item known
      const totalStock = await getTotalAvailable(topMatch.itemId);
      
      if (totalStock >= line.qty) {
        // Aллоcируем internal
        buckets.internalAllocation.push({ line, itemId: topMatch.itemId, qty: line.qty });
      } else {
        const shortfall = line.qty - totalStock;
        if (totalStock > 0) {
          buckets.internalAllocation.push({ line, itemId: topMatch.itemId, qty: totalStock });
        }
        // Remaining — buy
        const bestVendor = findBestVendor(topMatch.itemId);
        if (bestVendor) {
          buckets.buyFromVendor.push({ line, itemId: topMatch.itemId, qty: shortfall, vendorId: bestVendor.id });
        } else {
          buckets.needsQuote.push({ line, itemId: topMatch.itemId, qty: shortfall });
        }
      }
    } else {
      // Item unknown — need search
      buckets.needsWebSearch.push({ line });
    }
  }
  
  // 2. Create reservations для internal allocation
  const draftIssue = await createDraftTransferFromWHtoSite({
    fromLocationId: 'loc_warehouse_miami',
    toLocationId: estimate.siteLocationId || null,
    lines: buckets.internalAllocation.map(b => ({ itemId: b.itemId, qty: b.qty, uom: 'base' })),
    projectId: estimate.projectId,
    source: 'ai',
    reservationExpiresAt: now + 7d,
  });
  
  // 3. Create Draft PO для known vendors
  const groupedByVendor = groupBy(buckets.buyFromVendor, 'vendorId');
  const draftPOs = [];
  for (const [vendorId, items] of groupedByVendor) {
    draftPOs.push(await createDraftPO(vendorId, items, estimate.projectId));
  }
  
  // 4. Send RFQ emails для quote-needed items
  for (const item of buckets.needsQuote) {
    await scheduleRFQ(item, estimate.projectId);  // see improvement 10
  }
  
  // 5. Kick off web search для unmatched
  for (const line of buckets.needsWebSearch) {
    await scheduleWebSearch(line, estimate.projectId);  // see improvement 09
  }
  
  // 6. Publish event
  publishEvent('warehouse.procurement_plan_ready', {
    estimateId,
    summary: summarize(buckets),
    draftIssueId: draftIssue.id,
    draftPOIds: draftPOs.map(po => po.id),
  });
  
  return { buckets, draftIssue, draftPOs };
}
```

---

## 2. Output to user

Warehouse manager получает (Telegram + Web UI):

```
📦 План закупок для proj_dvorkin ($2,840 материалов):

✅ ЕСТЬ (аллоцировано из склада):
  • Outlet 15A × 40 — all 40 in warehouse_miami
  • Wire 12-2 × 300 ft (250 warehouse + 50 van)
  • Wire nuts × 120

🛒 КУПИТЬ В HOME DEPOT (1 заезд, $640):
  • GFCI Outlet 15A × 10 @ $14.50
  • Recessed LED 6" × 4 @ $32
  • Junction box × 8 @ $4.50
  • ... (7 more)
  [📤 Отправить список]  [📧 Email]

📧 SPECIAL ORDER (email vendor):
  • Lutron Diva dimmer white × 4
  Vendor: Mike's Electrical Supply
  [📨 Send RFQ]

🔍 НЕ НАЙДЕНО — ищу:
  • "Декоративный LED профиль 3м warm white"
  [...] (web search running)

[✅ Создать reservations + Draft PO] [✏️ Edit] [❌ Cancel]
```

User клики:
- "Создать" → reservations committed, PO ready для manual approval + send
- "Edit" → UI для правок
- "Cancel" → все drafts voided

---

## 3. Draft PO format

`wh_documents` типа receipt со статусом `draft`:
- `toLocationId: loc_warehouse_miami` (или direct-to-van если preferable)
- `vendorId`
- `source: 'ai'`
- Lines с planned qty + unitCost (from vendor catalog или avg cost)

Admin manually:
- Review, adjust если нужно
- Click "Send PO email" → sends email к vendor
- После fulfillment (receipt photo) — post (UC2 connects)

---

## 4. Pricing strategy

- For vendor с API (HD Pro, if available) — real-time price
- Иначе — cache 7d price от web search или last purchase
- Show "price last updated X days ago" warning

---

## 5. Acceptance

- [ ] Estimate 50 lines → plan за < 30 сек
- [ ] Correct bucket assignment (всё classified в одну из 5 категорий)
- [ ] Reservations created for internal
- [ ] Draft POs grouped by vendor (1 PO per vendor, not per line)
- [ ] RFQ emails queued for needsQuote
- [ ] Web search queued for unmatched
- [ ] Event `procurement_plan_ready` published
- [ ] UI отображает план красиво

## 6. Edge cases

- Estimate updated после plan → incremental re-plan (только изменения)
- All items in internal stock → no external procurement
- Nothing matches catalog → all goes to web search
- Partial vendor fulfillment (HD has 8 but need 10) → split: 8 from HD + 2 RFQ

## 7. Open questions

1. **Reservation TTL** — 7 дней для estimate? Или до project start?
2. **Price source priority** — vendor API > last_purchase > web_search? В таком ли порядке?
3. **User override buckets** — "я хочу это из van, не из warehouse" — нужен UI?

## 8. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 9. История
- **2026-04-18** — v1.0.
