# Core 05 — Rollout & Migration

> **Parent:** [`MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Tests:** [`TESTS.md`](./TESTS.md)
> **Scope:** clean-slate drop, bootstrap, seed data, phase-by-phase deploy, rollback plan.

---

## 1. Стратегия — clean slate

Существующие inventory данные — тестовые (нет реальных бизнес-операций). **Дропаем полностью**, строим заново по новой schema. Без миграции, без dual-write.

**Legacy collections для дропа:**
- `warehouses`
- `inventory_items`
- `inventory_catalog`
- `inventory_transactions`
- `inventory_transactions_v2`
- `inventory_locations`
- `inventory_reservations`

**Legacy code (deprecate):**
- `functions/src/agent/routes/inventory.ts` → 410 Gone после cutover
- `src/pages/inventory/` → archive в `src/pages/_archived/inventory/`
- 2 недели держим старые endpoints для backward-compat, потом удаляем

---

## 2. Pre-drop safety checklist

**Phase 0 начало — перед дропом:**

1. ✅ **Confirmation от Дениса** (explicit "дропаем, всё ок")
2. ✅ **Backup** — `firebase firestore:export gs://profit-step-backups/pre-warehouse-rewrite-20260418/`
3. ✅ **Count текущих данных:**
   ```
   warehouses: ___ docs
   inventory_items: ___ docs
   inventory_catalog: ___ docs
   inventory_transactions: ___ docs
   ```
4. ✅ **Foreign key check** — scan non-inventory collections (tasks, costs, clients, estimates) на поля `itemId`, `warehouseId`, `inventoryId`:
   ```
   tasks with itemId references: ___
   costs with inventoryRef: ___
   estimates with inventoryMaterial: ___
   ```
5. ✅ **Side effect check** — scan functions on-update triggers для legacy collections. Удалить или disable.
6. ✅ **UI flags** — `src/pages/inventory/` помечена "⚠️ MIGRATION IN PROGRESS" на период drop → bootstrap
7. ✅ **CI disabled** на main branch на время cutover

---

## 3. Drop script

`functions/src/warehouse/database/migrations/001-drop-legacy.ts`:

```typescript
const LEGACY_COLLECTIONS = [
  'warehouses',
  'inventory_items',
  'inventory_catalog',
  'inventory_transactions',
  'inventory_transactions_v2',
  'inventory_locations',
  'inventory_reservations',
];

export async function dropLegacy(db, options: { dryRun: boolean }): Promise<Report> {
  const report = { deleted: {}, errors: [] };
  
  for (const coll of LEGACY_COLLECTIONS) {
    const snap = await db.collection(coll).get();
    report.deleted[coll] = snap.size;
    
    if (!options.dryRun) {
      // Batch delete (500 per batch)
      const batches = chunk(snap.docs, 500);
      for (const batch of batches) {
        const writeBatch = db.batch();
        for (const doc of batch) writeBatch.delete(doc.ref);
        await writeBatch.commit();
      }
    }
  }
  
  return report;
}
```

**Запуск:**
```
npx ts-node functions/scripts/warehouse-reset.ts --phase drop --dry-run
# review report
npx ts-node functions/scripts/warehouse-reset.ts --phase drop
```

---

## 4. Bootstrap (post-drop)

`functions/src/warehouse/database/migrations/002-bootstrap.ts`:

```typescript
export async function bootstrap(db): Promise<void> {
  // 1. Create main warehouse
  await db.collection('wh_locations').doc('loc_warehouse_miami').set({
    name: 'Main Warehouse (Miami)',
    locationType: 'warehouse',
    address: '<адрес>',
    isActive: true,
    twoPhaseTransferEnabled: false,
    schemaVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'system',
    createdByType: 'system',
  });
  
  // 2. Van locations (для каждого employee)
  const employees = ['emp_denis', 'emp_gena', 'emp_masha'];  // from config
  for (const empId of employees) {
    await db.collection('wh_locations').doc(`loc_van_${empId}`).set({
      name: `Van ${empId}`,
      locationType: 'van',
      ownerEmployeeId: empId,
      isActive: true,
      twoPhaseTransferEnabled: false,
      schemaVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'system',
      createdByType: 'system',
    });
  }
  
  // 3. Quarantine location
  await db.collection('wh_locations').doc('loc_quarantine_main').set({ ... });
  
  // 4. Seed categories (8-10)
  await seedCategories(db);
  
  // 5. Seed items (50 typical construction items)
  await seedItems(db);
  
  // 6. Seed norms (20 task templates)
  await seedNorms(db);
  
  // 7. Seed vendors (3-5: Home Depot, Lowe's, Ferguson, Sherwin Williams)
  await seedVendors(db);
}
```

### Seed files

`functions/src/warehouse/database/seed/`:

- `categories.seed.ts` — 8-10 categories
- `items.seed.ts` — 50 items с SKU + baseUOM + purchaseUOMs + pricing
- `norms.seed.ts` — 20 norms для типовых tasks
- `vendors.seed.ts` — 3-5 vendors с contacts

**Example items.seed.ts:**
```typescript
export const SEED_ITEMS: Omit<WhItem, 'id' | 'createdAt' | 'updatedAt'>[] = [
  { sku: 'WIRE-12-2-NMB', name: 'Wire 12-2 NM-B THHN', category: 'cat_electrical_cable', baseUOM: 'ft', purchaseUOMs: [...], lastPurchasePrice: 0.36, averageCost: 0.36, isActive: true, isTrackable: false, schemaVersion: 1 },
  { sku: 'OUTLET-15A-WHT', name: 'Outlet 15A Duplex White', category: 'cat_electrical_device', baseUOM: 'each', purchaseUOMs: [{ uom: 'each', factor: 1, isDefault: true }], lastPurchasePrice: 2.49, averageCost: 2.49, isActive: true, ... },
  // ... 48 more
];
```

### Seed norms (20 штук)

```
install_outlet, replace_outlet, install_switch, replace_switch,
install_gfci, install_light_fixture, replace_light_fixture,
install_fan, run_cable, install_junction_box,
install_faucet, replace_faucet, fix_leak, install_toilet,
install_dimmer, install_shower_head,
patch_drywall, paint_wall, hang_tv, install_shelf
```

---

## 5. Phase-by-phase rollout

### Phase 0 — Clean slate (1 неделя)

**Scope:** drop + bootstrap + structure ready.

**Deliverables:**
- Drop script run in production
- Bootstrap run (warehouse + vans + items + norms)
- `functions/src/warehouse/` folder structure created (agent/core/database/api/improvements/)
- `docs/warehouse/` structure финальная
- Legacy routes → 410 Gone
- Legacy UI → _archived folder

**Acceptance:** см. [`MAIN_TEST_PLAN.md`](../../MAIN_TEST_PLAN.md#phase-0-clean-slate--bootstrap)

**Rollback:** re-import backup, revert code.

---

### Phase 1 — Core engine (2 недели)

**Scope:** posting engine + data model + API + 60 tests.

**Deploy:**
```
npm --prefix functions run build && firebase deploy --only functions:agentApi
```

**Rollback:** Cloud Functions rollback previous version.

---

### Phase 2-7 — Feature rollout

Каждая фаза в отдельной feature branch → PR → staging → dogfood → merge → production deploy.

**Feature flags:** `WAREHOUSE_BETA_USERS` в Firestore config:
```
config/warehouse_beta:
  enabledUserIds: ['user_denis', 'emp_gena']
```

Новые UC доступны только beta users первые 1-2 недели, потом rollout для всех.

---

## 6. Cutover procedure (transition from legacy)

```
Day 0 (вечер, non-peak):
  T-2h   Pre-drop checklist complete
  T-1h   Announce maintenance window in Telegram
  T-0    Deploy new code to production (new endpoints live, old endpoints still respond)
  T+5m   Run drop-legacy script (dry-run first, then real)
  T+15m  Run bootstrap script
  T+30m  Smoke test new endpoints via curl
  T+1h   Legacy endpoints → 410 Gone (deploy code switch)
  T+2h   Monitor Firebase logs for errors
  T+24h  Monitor real usage (Денис uses normally)
  T+48h  Close maintenance
```

**Rollback window:** 48 часов. После — forward-fix only.

---

## 7. Monitoring post-cutover

### Metrics to watch (24-48h)

- `warehouse_document_posted_total` — должно быть > 0 в течение 6 часов (если Денис активен)
- `warehouse_error_rate` — должно быть < 2%
- `warehouse_balance_drift_detected_total` — должно быть 0
- Firebase Functions errors on `agentApi`

### Alerts

- Drift detected → immediate page
- Error rate > 5% за 5 минут → page
- `functions:log` grep `INTERNAL_ERROR` → Telegram

---

## 8. Rollback runbook

### Scenario A: Drop script corrupted данные

```bash
# Restore from backup
gsutil -m cp -r gs://profit-step-backups/pre-warehouse-rewrite-20260418/ ./restore/
firebase firestore:import gs://profit-step-backups/pre-warehouse-rewrite-20260418/
# Revert code deploy
firebase functions:rollback agentApi
```

### Scenario B: Bootstrap seed wrong data

```bash
# Clear new wh_* collections
npx ts-node functions/scripts/warehouse-reset.ts --phase bootstrap-rollback
# Re-run bootstrap с fixes
npx ts-node functions/scripts/warehouse-reset.ts --phase bootstrap
```

### Scenario C: Production posting bug

- Revert to previous functions version
- Investigate via `wh_audit_log` + Cloud Logging
- Fix forward, re-deploy

---

## 9. Migration scripts structure

```
functions/src/warehouse/database/migrations/
├── 001-drop-legacy.ts        # delete legacy collections
├── 002-bootstrap.ts          # create locations + seed items/norms
├── 003-add-index-X.ts        # future: composite indexes
├── 004-schemaVersion-2.ts    # future: schemaVersion migrations
└── _runner.ts                # migration runner (idempotent via migrations_applied collection)
```

`_runner.ts` tracks в `wh_migrations_applied` что уже выполнено — prevents re-running.

---

## 10. Scope & non-goals

### In scope
- Clean-slate drop
- Bootstrap seed
- Phase rollout plan
- Cutover procedure
- Rollback scenarios

### NOT in scope
- Data migration from legacy (НЕТ — дропаем)
- Business logic → `02_posting_engine/`
- Feature-by-feature acceptance → each `improvements/*/SPEC.md`

---

## 11. Open questions

1. **Maintenance window** — non-peak для construction в Miami (вечер subdominant или утро?). Скоординировать с Денисом.
2. **Backup retention** — 90 дней стандарт Firebase? Сдвинуть на 12 месяцев для safety?
3. **Feature flag infrastructure** — Firestore config или Growthbook / LaunchDarkly?

---

## 12. Связанные документы

- Parent: [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
- Prev: [`../04_external_api/SPEC.md`](../04_external_api/SPEC.md)
- Test plan: [`./TESTS.md`](./TESTS.md)
- Phase gates: [`../../MAIN_TEST_PLAN.md`](../../MAIN_TEST_PLAN.md)

---

## 13. История

- **2026-04-18** — v1.0. Clean-slate стратегия + bootstrap + 6-фазный rollout + rollback scenarios.
