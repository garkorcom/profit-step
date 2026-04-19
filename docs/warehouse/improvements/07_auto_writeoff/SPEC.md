# Improvement 07 — Auto-writeoff (UC3)

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 4)
> **Scope:** task start → agent предлагает списать материалы по норме. На task complete — reconciliation.
> **Зависит от:** [`02_sync_tasks/`](../02_sync_tasks/) (contract with Tasks agent)

---

## 1. Flow (детальный)

### 1.1. Task start
```
1. Worker: /start task_dvorkin_install_3_outlets (в Telegram bot)
2. Task agent публикует `tasks.task.started`
3. Warehouse AI hook:
   a. Lookup norm по templateType='install_outlet', qty=3
   b. Compute required:
      - outlet: 3, wire: 15 ft, box: 3, wirenut: 9
   c. Check van balance (worker's van via ownerEmployeeId)
   d. Create draft issue (source=van, reason=project_installation, projectId=proj_dvorkin, phaseCode=rough_in)
4. Bot sends worker:
   "▶️ Задача начата: Install 3 outlets at Dvorkin
   
    По норме спишу с van Денис:
    • Outlet 15A × 3
    • Wire 12-2 × 15 ft
    • Box 1-gang × 3
    • Wire nut × 9
    Примерно $17 (по current avg cost)
    
    Attribute: proj_dvorkin, phaseCode=rough_in
    
    [✅ Списать по норме]
    [✏️ Изменить qty]
    [⏱️ Списать в конце задачи]"
```

### 1.2. Confirm

Option A: "✅ Списать по норме" → posts draft → ledger entries с projectId+phaseCode → event → Finance updates COGS.

Option B: "✏️ Изменить qty" → UI с sliders/inputs → обновляет draft lines → then post.

Option C: "⏱️ Списать в конце задачи" → draft остаётся, ждём task complete.

### 1.3. Task complete reconciliation

```
1. Worker: /done task_xxx
2. Task agent публикует `tasks.task.completed`
3. Warehouse AI hook:
   a. Find related draft issue (via relatedTaskId)
   b. If status=draft (option C была выбрана):
      → prompt "Подtвердить списание по норме сейчас?"
   c. If status=posted:
      → ask "Реальное потребление совпало с нормой?"
      → [✅ Да, всё точно] [✏️ Поправить qty]
   d. If edit → create adjustment document с variance
4. If overrun > 25% AND variance > $50:
   → publish `warehouse.anomaly.detected`
```

---

## 2. Norm lookup

```typescript
async function lookupNorm(templateType: string): Promise<WhNorm | null> {
  const snap = await db.collection('wh_norms')
    .where('taskType', '==', templateType)
    .where('isActive', '==', true)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].data();
}
```

Если norm не найдена → prompt "Нет норматива для install_outlet. Задать вручную?" (link на admin UI).

---

## 3. Qty computation

```typescript
for each normItem:
  required = normItem.qtyPerUnit × task.qty
  
  // Check van stock
  balance = getBalance(worker.vanLocationId, normItem.itemId)
  available = balance.availableQty
  
  if (available >= required):
    draftLine: { itemId, uom: baseUOM, qty: required }
  else:
    partial = available
    shortfall = required - available
    draftLine: { itemId, uom: baseUOM, qty: partial, note: `Short ${shortfall}` }
    // + trigger auto-transfer proposal (см. improvement 04)
```

---

## 4. Anomaly detection

```typescript
async function detectAnomaly(taskId, planned, actual) {
  const plannedCost = sumCost(planned);   // qty × avgCost
  const actualCost = sumCost(actual);
  const variance = actualCost - plannedCost;
  const overrunPercent = (variance / plannedCost) × 100;
  
  if (overrunPercent > 25 && variance > 50) {
    publishEvent('warehouse.anomaly.detected', {
      taskId, plannedCost, actualCost, variance, overrunPercent,
      byItem: breakdown(planned, actual),
    });
  }
}
```

Threshold configurable в `wh_config`.

---

## 5. Data model additions

В `wh_documents`:
- `relatedTaskId?: string` — backref к task

В `wh_events`:
- `warehouse.task_writeoff_proposed`
- `warehouse.task_writeoff_completed`
- `warehouse.task_materials_insufficient`

---

## 6. Acceptance

- [ ] Task start event → draft issue за < 3 сек
- [ ] Draft issue имеет правильные: source van, projectId, phaseCode, все lines по норме
- [ ] Unit cost snapshot — current avg cost
- [ ] Confirm → post → ledger entries
- [ ] Task complete с actual != planned → adjustment создаётся
- [ ] Overrun > 25% + $50 → anomaly event
- [ ] No norm → graceful fallback, no draft

## 7. Edge cases

- Task без templateType → no UC3 (manual writeoff)
- Norm 0 items → skip, warning
- Van empty — shortfall detected → auto-transfer proposal triggered
- Multiple parallel tasks → separate drafts
- Task cancelled → draft voided

## 8. Open questions

1. **Auto-post без confirm** — для trusted workers разрешить "auto-confirm" opt-in?
2. **Phase selection** — template implies phase или asking worker каждый раз?

## 9. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 10. История
- **2026-04-18** — v1.0.
