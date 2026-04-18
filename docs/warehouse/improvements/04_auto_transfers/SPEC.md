# Improvement 04 — Auto-Transfer Agent

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** ⚪ backlog (Phase 6+)
> **Scope:** автономный агент, который **предлагает** перемещения товаров между locations когда видит дисбаланс.

---

## 1. Зачем

- Van работника пустой, но у него завтра задача → auto-suggest transfer WH→van
- Warehouse overstocked на wire, один van пуст → auto-suggest balancing
- Site завершён, остались материалы → auto-suggest transfer site→WH (cleanup)
- Worker move между проектами → auto-suggest transfer van→van

Агент **не движет товары сам.** Он **предлагает** draft transfer, человек (driver, manager) подтверждает.

---

## 2. Triggers

### 2.1. Scheduled (cron)

Daily at 6am:
1. Scan all tasks scheduled на next 7 days
2. For each worker:
   - Compute materials needed (via norms)
   - Compare к current van stock (availableQty)
   - If shortfall → propose transfer from WH
3. Check WH overstocked items (onHand > 3× avg consumption) → propose rebalance

### 2.2. Event-driven

- `tasks.task.scheduled` — task поставлена на конкретного worker'а
- `warehouse.low_stock` — van specific item falls below minStock
- `warehouse.site_inventoried` — new site inventory появилось, может нужен cleanup
- `tasks.task.completed` — если на site остался материал, propose return

---

## 3. Algorithm

```typescript
async function runAutoTransferAgent() {
  const proposals: TransferProposal[] = [];
  
  // 1. Worker shortfall detection
  for (const worker of activeWorkers) {
    const upcomingTasks = await getTasksInRange(worker.id, days: 7);
    const requiredByItem = aggregateRequirements(upcomingTasks);  // via norms
    const vanStock = await getBalances(worker.vanLocationId);
    
    for (const [itemId, required] of requiredByItem) {
      const available = vanStock.get(itemId)?.availableQty || 0;
      if (available < required) {
        const shortfall = required - available;
        proposals.push({
          type: 'shortfall_refill',
          from: 'loc_warehouse_miami',
          to: worker.vanLocationId,
          itemId,
          qty: shortfall,
          reason: `Upcoming tasks require ${required}, van has ${available}`,
          priority: computePriority(upcomingTasks),
        });
      }
    }
  }
  
  // 2. Overstock detection
  const avgConsumption = await computeItemConsumption30Days();
  const whBalances = await getBalances('loc_warehouse_miami');
  for (const [itemId, balance] of whBalances) {
    const avg30d = avgConsumption.get(itemId) || 0;
    if (balance.onHandQty > avg30d * 3) {
      // Find van with lowest stock
      const lowestVan = findLowestVanStock(itemId);
      if (lowestVan.onHand < avg30d / 4) {
        proposals.push({ type: 'rebalance_overstock', ... });
      }
    }
  }
  
  // 3. Site cleanup detection
  const completedTasks7d = await getCompletedTasksIn(7);
  for (const task of completedTasks7d) {
    const siteBalance = await getBalances(task.siteLocationId);
    for (const [itemId, balance] of siteBalance) {
      if (balance.onHandQty > 0) {
        proposals.push({
          type: 'site_cleanup',
          from: task.siteLocationId,
          to: task.workerVanId,
          ...
        });
      }
    }
  }
  
  // 4. Create draft transfers
  for (const proposal of proposals) {
    await createDraftTransfer(proposal);
    await notifyActor(proposal);  // Telegram push driver / manager
  }
}
```

---

## 4. Proposal types

| Type | From → To | Trigger |
|---|---|---|
| `shortfall_refill` | WH → van | Worker has upcoming task, van out of required item |
| `rebalance_overstock` | WH → van (least stocked) | WH has 3× avg, van has < avg/4 |
| `site_cleanup` | site → worker's van | Task completed, leftovers on site |
| `site_cleanup_to_wh` | site → WH | Site closed, leftovers over certain threshold |
| `van_van_transfer` | van A → van B | Explicit request from manager for sharing |
| `return_to_vendor` | any → vendor_hold | Items marked для return |

---

## 5. Telegram flow

Пример shortfall_refill:

```
🚚 Auto-Transfer Agent:

Привет Gena. Завтра у тебя 3 задачи с outlet'ами (Dvorkin 3шт, Sarah 2шт, Mike 4шт). Итого надо 9шт outlet_15a.

В твоём van сейчас: 2шт.
Нехватка: 7шт.

Предлагаю взять с warehouse_miami:
• Outlet 15A × 7
• Wire 12-2 × 45 ft (под 9 работ)
• Box 1-gang × 7

Подходит? [✅ Принять] [✏️ Изменить qty] [❌ Отклонить]

Если примешь — заеду в warehouse утром перед первым объектом.
```

Принимает → creating draft transfer (ready_for_review status) → warehouse_manager подтверждает → Gena забирает.

---

## 6. Priority & throttling

- **Priority formula:** `urgency (task date) × value (item $) × workflow_impact`
- **Max 5 proposals/day per worker** (не spam'ить)
- **Cooldown:** если proposal отклонён, не повторять этот же pair (item, location) 24h

---

## 7. Configuration

В `wh_config/auto_transfer_policy`:
```typescript
{
  enabled: boolean,
  triggers: {
    shortfall_refill: { enabled, lookAheadDays: 7 },
    rebalance_overstock: { enabled, thresholdMultiplier: 3 },
    site_cleanup: { enabled, minItemValueUsd: 5 },
  },
  throttle: {
    maxProposalsPerWorkerPerDay: 5,
    cooldownHours: 24,
  },
  defaultApprover: 'warehouse_manager' | 'admin',
}
```

---

## 8. Relationship с другими improvements

- Использует `wh_norms` (02) для расчёта upcoming requirements
- Создаёт draft transfer через core posting (02_posting_engine)
- Уведомляет через Telegram worker bot (existing infra)
- Может интегрироваться с GPS tracking (будущий improvement) для smart routing

---

## 9. Acceptance

- [ ] Daily cron запускается, scans tasks + stocks
- [ ] Shortfall detected → proposal created + Telegram push
- [ ] Worker accept → draft transfer готов к post warehouse_manager'ом
- [ ] Worker decline → logged, cooldown 24h
- [ ] Max 5/day работает
- [ ] Overstock rebalance: WH → van с lowest stock

---

## 10. Open questions

1. **Auto-post allowed?** — Если warehouse_manager approve'ил transfer policy, агент может постить сам без каждого confirm?
2. **Van-to-van без manager** — или всегда нужен мanager approval?
3. **GPS integration** — использовать worker's текущую location для smarter routing?

---

## 11. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 12. История
- **2026-04-18** — v1.0 spec (статус backlog, Phase 6+).
