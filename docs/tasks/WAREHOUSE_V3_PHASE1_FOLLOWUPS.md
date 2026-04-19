# ТЗ — Warehouse V3 Phase 1 follow-ups

## Metadata

- **PM:** Denis
- **Автор:** Claude Code Opus 4.7 (1M context)
- **Дата:** 2026-04-18
- **Priority:** P1 (V3 без этого Phase 0 технически закрыт, но в UI/боте не виден)
- **Parent spec:** [`WAREHOUSE_SPEC_V3.md`](./WAREHOUSE_SPEC_V3.md)
- **Shipped predecessors:** PR [#28](https://github.com/garkorcom/profit-step/pull/28), merge commit `54c73f4`
- **Estimated effort:** S (~6-8 часов)
- **Status:** TODO

## Context

2026-04-18 shipped Phase 0 из WAREHOUSE_SPEC_V3:

- `InventoryService` unified write path + 29 unit тестов (функции `commitTransaction`, `recalculateStock`)
- 3 V3 эндпоинта — `POST /api/inventory/v3/transactions`, `POST /v3/recalculate/:catalogItemId`, `GET /v3/barcode/:code`
- `ownerEmployeeId` поле на warehouses (nullable, persisted в POST/PATCH/GET)
- Python SDK `agent.inventory.*` с типизированными helpers + 10 pytest
- Migration Simple → V3 (executed на проде, 1 warehouse + 1 item)
- Firestore composite indexes для `inventory_catalog` + `inventory_transactions_v2`

Phase 0 Acceptance (§10 родительского спека) закрыт, миграция отработала, UI `/inventory` ожил.

**Что осталось из Phase 1 (§10.Phase 1 родительского спека):** RLS scoping, UI picker владельца, barcode scan в боте, cross-tenant тесты. Плюс мелкий cleanup.

---

## Проблема 1 — RLS scoping по `ownerEmployeeId`

### Что сделано

В `CreateWarehouseSchema` / `UpdateWarehouseSchema` добавлено поле `ownerEmployeeId: string | null`. POST пишет его, PATCH обновляет, GET возвращает. Документы в `warehouses` и `inventory_locations` получили поле (для новых записей — null, для миграции — mapped 1:1).

### Что осталось

**Queries в роутах поле игнорируют.** Роут `GET /api/inventory/warehouses` по-прежнему фильтрует только по `createdBy` для worker/driver (это было сделано ещё до V3). Spec §4.5 требует:

```typescript
// worker/driver — свои склады OR shared pool (ownerEmployeeId == null)
if (role === 'worker' || role === 'driver') {
  q = q.where('ownerEmployeeId', 'in', [myId, null]);
}
// foreman — team + shared pool
else if (role === 'foreman') {
  const teamIds = req.effectiveTeamMemberUids || [];
  q = q.where('ownerEmployeeId', 'in', [...teamIds, myId, null]);
}
// manager/admin — всё
```

### Acceptance

- [ ] `GET /api/inventory/warehouses` с role=worker возвращает только `ownerEmployeeId IN [myId, null]`
- [ ] `GET /api/inventory/warehouses` с role=foreman возвращает `ownerEmployeeId IN [teamIds, myId, null]`
- [ ] Firestore `in` cap на 30 — если team > 29, fallback к «показать только свои» (как сейчас делает `rlsCrossTenant.test.ts` для work_sessions)
- [ ] Тот же паттерн применить к `GET /api/inventory/items` (через связанный warehouseId)
- [ ] Тот же паттерн для `GET /api/inventory/transactions` (по `warehouseId` → `ownerEmployeeId`)
- [ ] В `rlsCrossTenant.test.ts` дополнить 3 роли × 3 роута = 9 новых `it(...)` кейсов, включая edge-case: team > 29 → fallback
- [ ] Все 67 текущих Jest-тестов продолжают проходить

### Файлы

- `functions/src/agent/routes/inventory.ts` — добавить `where('ownerEmployeeId', 'in', ...)` в warehouses/items/transactions list endpoints
- `functions/test/rlsCrossTenant.test.ts` — расширить inventory-секцию (в ней сейчас 1 тест, станет ~10)

### Зависимости

- Composite index `inventory_locations (ownerEmployeeId, createdAt)` — добавить в `firestore.indexes.json` + deploy
- Composite index `inventory_catalog (ownerEmployeeId, name)` — аналогично (для списка items scoped по owner'у)

### Effort

2 часа.

---

## Проблема 2 — UI picker владельца локации

### Что сделано

Ничего. Поле в API есть, но админ его не может задать через UI — диалог создания локации в `InventoryPage.tsx` его не предлагает.

### Что осталось

Добавить `Autocomplete` (employee picker) в диалог создания/редактирования локации:
- `/inventory` (standalone, `src/pages/inventory/InventoryPage.tsx`) — главный
- `/crm/inventory` (CRM view, `src/pages/crm/InventoryPage.tsx`) — тот же паттерн
- Опционально: колонка в таблице складов с аватаркой/именем владельца

### Acceptance

- [ ] В диалоге «Добавить локацию» есть поле «Владелец (сотрудник)» с Autocomplete по активным employees
- [ ] Пусто = shared pool; выбранный employee = этот worker owner-ом
- [ ] При редактировании существующей локации можно поменять владельца или снять (обратно в shared pool)
- [ ] Change отображается в списке складов — бейдж или subtitle с именем владельца
- [ ] Vite build чистый, UI не сломалась для существующих локаций без владельца

### Файлы

- `src/pages/inventory/InventoryPage.tsx`
- `src/pages/crm/InventoryPage.tsx`
- (опционально) `src/features/inventory/inventoryService.ts` — helper для update location owner

### Зависимости

- Employee picker компонент — возможно уже есть как `<EmployeeSelector>` где-то в `src/components/`. Если нет — написать минимальный.

### Effort

2-3 часа.

---

## Проблема 3 — `/scan` в worker bot

### Что сделано

`GET /api/inventory/v3/barcode/:code` готов и боевой на проде (smoke-тест прошёл, V3 source возвращается после миграции).

### Что осталось

**Две подзадачи:**

1. **Bot handler.** Зарегистрировать `/scan` команду в `onWorkerBotMessage.ts` (или в новом модуле `functions/src/triggers/telegram/handlers/inventoryBarcode.ts`), которая:
   - Принимает фото штрихкода
   - Отправляет фото в Gemini Vision с промптом «найди штрихкод, верни только числовой код»
   - Делает `GET /api/inventory/v3/barcode/:code` через internal fetch (или напрямую через `InventoryService`)
   - Показывает inline keyboard: `[📤 Списать] [📥 Приход] [🔄 Передать]`
   - При tap — переходит в соответствующий flow (в draft-and-confirm паттерн из spec §8.2)

2. **Fallback UI.** Если Gemini не распознал — попросить юзера ввести код текстом.

### Acceptance

- [ ] Worker отправляет боту `/scan` + фото → бот отвечает с item data или «не нашёл»
- [ ] Если штрихкод не распознан → бот пишет «отправь код текстом» → принимает текстовый ввод
- [ ] После tap «Списать» — запрашивает qty → вызывает `POST /v3/transactions` с типом `write_off`
- [ ] Unit test handler'а с моком Gemini (похожий на `mediaHandlerSkip.test.ts`)
- [ ] **Важно:** ВСЕ правки в `onWorkerBotMessage.ts` делать в отдельном PR (CLAUDE.md §2.2 — high-risk файл), с emulator smoke перед merge

### Файлы

- `functions/src/triggers/telegram/handlers/inventoryBarcode.ts` (NEW)
- `functions/src/triggers/telegram/onWorkerBotMessage.ts` (MODIFIED — добавить диспатч в handler)
- `functions/test/inventoryBarcodeHandler.test.ts` (NEW)

### Зависимости

- Gemini Vision SDK — уже используется в проекте (`@google/generative-ai`)
- Утилита для скачивания Telegram фото — уже есть в `functions/src/triggers/telegram/telegramUtils.ts`

### Effort

3-4 часа.

---

## Проблема 4 — SDK Phase 1 completions

### Что сделано

Python SDK `agent.inventory.*` имеет full read/write coverage (catalog, locations, transactions, record_purchase, write_off, transfer, adjust, recalculate, barcode endpoint через commit helper). 10 pytest-ов mock-based.

### Что осталось

1. **Barcode lookup helper** в SDK — `agent.inventory.lookup_barcode(code) -> CatalogItem | None`, обёртка над `GET /api/inventory/v3/barcode/:code`. Короткий add в `domains/inventory.py`.
2. **Cross-tenant RLS тест** в SDK — создать worker-токен, пробежаться `.catalog_list()` / `.locations_list()` / `.transactions_list()` и убедиться что возвращаются только owned + shared. Это integration test (не mock), запускается опционально против staging.

### Acceptance

- [ ] `agent.inventory.lookup_barcode("...")` возвращает `CatalogItem | None`
- [ ] pytest для lookup_barcode — 2 кейса (found/not-found)
- [ ] `tests/integration/test_inventory_rls.py` с `@pytest.mark.integration` — пропускается без env `PROFIT_STEP_WORKER_TOKEN`
- [ ] `pytest -m "not integration"` всё ещё 40/40 (нет регрессий)

### Effort

1 час.

---

## Проблема 5 — Cleanup смоук-записи в V3

### Что сделано

Во время smoke-тестирования PR #28 я создал через API `warehouses/POST` и `inventory_items/POST` одну тестовую запись, которая через миграцию `--commit` переехала в `inventory_locations` (`busBteOtgjUCORbBAun2`, name="V3 smoke test warehouse", isActive=false) и `inventory_catalog` (name="V3 smoke wire 12awg", stock=250 метра, isArchived=false но привязан к inactive location).

### Что осталось

Удалить (или archive) две V3 записи + парные в legacy коллекциях:

- `inventory_locations/busBteOtgjUCORbBAun2`
- `inventory_catalog` — запись с `name == "V3 smoke wire 12awg"`
- `warehouses/busBteOtgjUCORbBAun2` (legacy, уже archived)
- `inventory_items` — запись с `name == "V3 smoke wire 12awg"` (legacy)
- `inventory_transactions_v2` — нет записей (0 в migration)

Написать одноразовый скрипт `scripts/cleanup-warehouse-v3-smoke.ts` или просто сделать через Firestore console.

### Acceptance

- [ ] `GET /api/inventory/warehouses` вернул `count: 0`
- [ ] `GET /api/inventory/v3/barcode/V3SMOKE-1776566911923` вернул 404
- [ ] Админ-UI `/inventory` показал пустой экран с CTA «Добавить товар»

### Effort

10 минут (ручками через Firestore console) или 30 минут (скриптом).

---

## Общий Acceptance (Phase 1 закрыт когда)

- [ ] Все 4 роли (admin/manager/foreman/worker) видят только разрешённое в `/api/inventory/*` (подтверждено `rlsCrossTenant.test.ts`)
- [ ] В админ-UI можно назначить машину сотруднику (persisted в `ownerEmployeeId`)
- [ ] Worker в боте может отправить `/scan` + фото и получить item data + quick-actions
- [ ] SDK `agent.inventory.lookup_barcode()` работает
- [ ] V3 коллекции не содержат smoke-мусора
- [ ] PR merged в main, deployed (`firebase deploy --only functions:agentApi,hosting`)
- [ ] Спустя 48ч на проде — 0 инцидентов в `inventory.*` webhook events + `firebase functions:log`

---

## Рекомендуемый порядок PR

1. **PR-1 (RLS):** backend RLS + test coverage + 2 новых index в `firestore.indexes.json`. ~2ч.
2. **PR-2 (Cleanup + UI picker):** UI picker владельца + одновременно удалить smoke-записи. ~2-3ч.
3. **PR-3 (Bot /scan):** отдельным PR из-за CLAUDE.md §2.2 — handler + emulator smoke + unit test. ~3-4ч.
4. **PR-4 (SDK polish):** lookup_barcode helper + integration test stub. ~1ч.

Общий эффорт: 8-10ч, 4 независимых PR, можно параллелить.

---

## Out of scope (это Phase 2, отдельный спек)

Не делать в рамках этого follow-up'а:

- Transfer request workflow с handshake (§4.2, §6.1 родительского спека)
- Reservations system (§4.1, §9.1)
- Plan-vs-Fact analytics + anomaly-detection cron (§9.3)
- Category-based policies + admin UI (§4.4)
- 6 новых webhook events (§4.3)
- Draft & Confirm в Telegram (§8.2)
- Physical inventory / cycle counts (Phase 3)
- Vendor management / Draft PO (Phase 3)

Phase 2 стартовать после закрытия этого follow-up'а + реальной работы на V3 несколько недель (чтобы понять где болит).

---

## References

- Parent spec: [`WAREHOUSE_SPEC_V3.md`](./WAREHOUSE_SPEC_V3.md)
- Use cases: [`WAREHOUSE_USE_CASES.md`](./WAREHOUSE_USE_CASES.md)
- Phase 0 PR: [#28](https://github.com/garkorcom/profit-step/pull/28) (merged as `54c73f4`)
- Phase 0 implementation log: `~/projects/pipeline/2026-04-18/nikita-warehouse-v3-log.md`
- RLS reference commit: `ceb8464` (dashboard + finance + activity + feedback)
- Worker bot risk policy: CLAUDE.md §2.2
