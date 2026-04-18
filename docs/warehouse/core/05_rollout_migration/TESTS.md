# Core 05 — Rollout & Migration — Test Plan

> **Parent spec:** [`SPEC.md`](./SPEC.md)

---

## 1. Drop script tests

- ✓ dryRun: возвращает report + counts, 0 writes
- ✓ Real run: удаляет все docs в legacy collections, не трогает wh_*
- ✓ Idempotent: повторный запуск — 0 docs to delete
- ✓ Large collection (500+ docs): batching works без timeout

---

## 2. Bootstrap tests

- ✓ Creates 1 warehouse, 3 vans, 1 quarantine (5 locations total)
- ✓ Seeds 8-10 categories
- ✓ Seeds 50 items с unique SKUs
- ✓ Seeds 20 norms, все ссылаются на существующие items
- ✓ Seeds 3-5 vendors
- ✓ Idempotent: повторный запуск не создаёт дубликатов (проверяет existence)

---

## 3. Cutover dry-run (staging)

Перед production cutover — полный прогон на staging:
- ✓ Export → Drop → Bootstrap на staging Firestore
- ✓ Все новые endpoints отвечают 200 на smoke tests
- ✓ AI capabilities работают на seeded data
- ✓ Legacy endpoints → 410 Gone
- ✓ UI загружает новые страницы

---

## 4. Rollback tests

### Backup restore
- ✓ `firebase firestore:import` restores legacy collections
- ✓ После restore — legacy endpoints снова работают

### Functions rollback
- ✓ Previous functions version можно deploy back в 1 команду

---

## 5. Migration runner tests

- ✓ `_runner.ts` tracks в `wh_migrations_applied`
- ✓ Повторный run — skips уже применённые
- ✓ Partial failure → next run продолжает с failed migration

---

## 6. Post-cutover monitoring tests

- ✓ Metrics endpoint `/api/warehouse/health` returns 200 с балансом
- ✓ `warehouse_error_rate` alert fires при > 5%
- ✓ `warehouse_balance_drift_detected_total` alert при > 0

---

## 7. Manual cutover checklist

Для Дениса перед production cutover:
- [ ] Backup сделан (show gsutil ls output)
- [ ] Pre-drop counts recorded
- [ ] Foreign key scan done
- [ ] Confirmation given
- [ ] Maintenance window announced в Telegram
- [ ] First post-cutover document создан успешно в первые 15 минут
- [ ] Monitoring 24h без incidents

---

## 8. История

- **2026-04-18** — v1.0.
