# 50 Warehouse Use Cases

> **Parent:** [`MAIN_SPEC.md`](./MAIN_SPEC.md)
> **Role:** regression test suite — 50 детальных сценариев для coverage
> **Дата:** 2026-04-17 (v1), перенесено 2026-04-18 в новую структуру
> **Аудитория:** разработчик, имплементирующий core + improvements
> **Note:** endpoint-ссылки внутри были под старую `/api/inventory/*` схему. При реализации использовать новые `/api/warehouse/*` endpoints (см. [`core/04_external_api/SPEC.md`](./core/04_external_api/SPEC.md))

Каждый кейс описывает: actor → trigger → flow → expected outcome → edge cases → relevant endpoints/events.

---

## Категории

| # | Категория | Cases |
|---|---|---|
| 1 | Basic CRUD | UC-01 до UC-05 |
| 2 | Daily worker ops | UC-06 до UC-11 |
| 3 | Manager approvals | UC-12 до UC-16 |
| 4 | Transfer between locations | UC-17 до UC-21 |
| 5 | Purchase orders & receiving | UC-22 до UC-26 |
| 6 | Norms & auto write-off | UC-27 до UC-30 |
| 7 | Stock counts / reconciliation | UC-31 до UC-33 |
| 8 | Alerts & anomalies | UC-34 до UC-36 |
| 9 | Reports & analytics | UC-37 до UC-39 |
| 10 | AI agent interactions | UC-40 до UC-44 |
| 11 | Edge cases / errors | UC-45 до UC-50 |

---

## 1. Basic CRUD

### UC-01 — Создать склад (warehouse / машину)
**Actor:** Admin (через UI) или Manager (через API)
**Trigger:** нужно зарегистрировать новую точку хранения
**Flow:**
1. `POST /api/inventory/locations` с `{name, type='vehicle', ownerEmployeeId?, address?}`
2. Backend валидирует: уникальность name в рамках companyId
3. Запись в `inventory_locations`
4. Return `{id, ...}`

**Expected:** Location создан, доступен в `GET /api/inventory/locations`
**Edge cases:**
- Name дубликат → 409 Conflict
- ownerEmployeeId не существует → 400
- type invalid → 400
**Endpoints:** `POST /api/inventory/locations`

### UC-02 — Создать позицию в каталоге
**Actor:** Admin / Manager
**Trigger:** появился новый материал/инструмент для отслеживания
**Flow:**
1. `POST /api/inventory/catalog` с `{name, unit, category, minStock?, sku?}`
2. Backend: `stockByLocation: {}` (пусто), `totalStock: 0`
3. Return item

**Expected:** Item в каталоге, 0 остатков
**Edge cases:**
- unit не из enum → 400
- category не из enum → 400
**Endpoints:** `POST /api/inventory/catalog`

### UC-03 — Обновить цену / minStock позиции
**Actor:** Manager
**Trigger:** поставщик поднял цену или изменился threshold low-stock
**Flow:**
1. `PATCH /api/inventory/catalog/:id` с `{lastPurchasePrice, minStock}`
2. Backend проверяет: не пытается обновить `stockByLocation` напрямую (запрещено §4.1)
3. Возврат обновлённой записи

**Expected:** Новая цена применяется к будущим transactions; minStock триггерит low_stock при следующем commit
**Edge cases:**
- Попытка `PATCH { stockByLocation: ... }` → 403 Forbidden with message "use commitTransaction"
**Endpoints:** `PATCH /api/inventory/catalog/:id`

### UC-04 — Soft-delete / архивировать позицию
**Actor:** Admin
**Trigger:** позиция устарела, не покупаем больше
**Flow:**
1. `DELETE /api/inventory/catalog/:id`
2. Backend: `isArchived: true` (НЕ физическое удаление — сохраняет историю транзакций)
3. Из default `GET /api/inventory/catalog` исчезает; доступна с `?includeArchived=true`

**Expected:** Позиция скрыта из UI, транзакции сохранены для аудита
**Edge cases:**
- Delete позиции с totalStock > 0 → 400 (сначала нужно списать в 0)
**Endpoints:** `DELETE /api/inventory/catalog/:id`

### UC-05 — Список позиций с фильтрами (pagination)
**Actor:** Любой с `inventory:read`
**Trigger:** UI загружает каталог
**Flow:**
1. `GET /api/inventory/catalog?category=materials&locationId=vehicle_A&limit=50&cursor=...`
2. Backend применяет RLS (§4.5): если role=worker, фильтр по `ownerEmployeeId`
3. Если `locationId` дан — фильтр по `stockByLocation[locationId] > 0`
4. Return `{items, nextCursor}`

**Expected:** Только релевантные items возвращены; RLS работает
**Edge cases:**
- locationId не существует → пустой список (не 404)
- limit > 200 → clamp до 200
**Endpoints:** `GET /api/inventory/catalog`

---

## 2. Daily worker ops

### UC-06 — Работник проверяет остатки в своей машине
**Actor:** Worker (в Telegram боте)
**Trigger:** нужно знать сколько есть перед заездом
**Flow:**
1. Worker в боте: `/stock`
2. Бот: `GET /api/inventory/catalog?locationId=vehicle_worker123&limit=20`
3. RLS: scope по `ownerEmployeeId = worker123`
4. Бот форматирует: `📦 Твоя машина:\n• Кабель 12AWG: 320м\n• Розетки: 45шт\n• ...`

**Expected:** Worker видит только СВОЮ машину, qty актуальны
**Edge cases:**
- Машина без владельца — показать shared pool
- 0 items → "в машине ничего не числится"
**Endpoints:** `GET /api/inventory/catalog` (RLS), `GET /api/inventory/locations`

### UC-07 — Работник сканирует штрихкод
**Actor:** Worker (в Telegram)
**Trigger:** нашёл позицию на складе, хочет списать / добавить
**Flow:**
1. Worker: `/scan`
2. Бот: "отправь фото штрихкода"
3. Worker шлёт фото
4. Backend: Gemini Vision → 012345678905 → lookup `inventory_catalog` by `sku`
5. Match → бот: `Найдено: Wire 12 AWG THHN (в машине: 320м). Что делаешь? [📤 Списать] [📥 Приход] [🔄 Передать]`

**Expected:** Одно фото → распознана позиция → quick action
**Edge cases:**
- Код не распознан → "не увидел штрихкод, попробуй ещё раз"
- Код не в каталоге → "не нашёл в системе, создать? (только admin)"
- Multiple matches → показать список выбора
**Endpoints:** Gemini Vision API, `GET /api/inventory/catalog?sku=...`

### UC-08 — Работник списывает материал через бот
**Actor:** Worker
**Trigger:** использовал 50м кабеля на задаче
**Flow:**
1. Worker: `/scan` → бот: "Wire 12 AWG найден. Что делаешь? [📤 Списать]"
2. Worker жмёт [📤 Списать]
3. Бот: "Сколько использовал? (доступно 320м)"
4. Worker: `50`
5. Бот: "Списать 50м Wire 12 AWG с машины на проект? Какой проект?"
6. Worker выбирает из списка активных projects: `BMW Tampa`
7. Бот подтверждает: "Списать 50м на BMW Tampa? [✅/❌]"
8. Worker: ✅
9. `POST /api/inventory/transactions { type: 'write_off', catalogItemId, qty: 50, fromLocationId, clientId, performedBy }`
10. Backend через `InventoryService.commitTransaction`: write log + decrement stock + check minStock → maybe fire `low_stock` event

**Expected:** Стоck уменьшен на 50м; event fired если осталось < minStock
**Edge cases:**
- qty > stock → 400 "insufficient stock (available: 320м)"
- No active project → skip clientId, но event `self_checkout` to manager
- Network fail → idempotency key из chat msg id
**Endpoints:** `POST /api/inventory/transactions`
**Events:** `inventory.self_checkout`, опционально `inventory.low_stock`

### UC-09 — Работник запрашивает трансфер (нужно больше на объекте)
**Actor:** Worker (на объекте)
**Trigger:** кабеля не хватает, есть на другом складе
**Flow:**
1. Worker: `/transfer`
2. Бот: "Что передать? Сканируй штрихкод или напиши название"
3. Worker: `кабель 12awg 100м`
4. Бот: "Найдено на 'Main Warehouse' (400м). Запросить 100м?"
5. Worker: ✅
6. `POST /api/inventory/transfer-requests { fromLocationId: main_warehouse, toLocationId: worker's_vehicle, items: [{catalogItemId, qty: 100}] }`
7. Backend создаёт request status='requested', fires event `inventory.transfer_requested`
8. Manager получает Telegram push

**Expected:** Transfer request в системе, manager уведомлён
**Edge cases:**
- Позиция на нескольких локациях — бот показывает все, worker выбирает
- qty > stock на source — warning
**Endpoints:** `POST /api/inventory/transfer-requests`
**Events:** `inventory.transfer_requested`

### UC-10 — Работник подтверждает получение (handshake)
**Actor:** Worker (получатель)
**Trigger:** курьер/водитель привёз материал
**Flow:**
1. Worker: `/received` (или кнопка из прошлого сообщения)
2. Бот показывает pending transfers: "Ждёт твоего handshake: 100м Wire 12AWG от Main Warehouse"
3. Worker: ✅ Принял
4. `PATCH /api/inventory/transfer-requests/:id/receive`
5. Backend: `InventoryService.commitTransaction(transfer_in)` — stock зачислен на vehicle
6. Event `inventory.transfer_completed`

**Expected:** Atomic: transfer_out (было) + transfer_in (сейчас) с тем же `transactionGroupId`
**Edge cases:**
- Получил меньше чем отправили → "меньше, указать сколько" → fires `shortage_alert`
- Повторный handshake → 409 (idempotent)
**Endpoints:** `PATCH /api/inventory/transfer-requests/:id/receive`
**Events:** `inventory.transfer_completed`, maybe `inventory.transfer_shortage`

### UC-11 — Работник возвращает инструмент
**Actor:** Worker (в конце смены)
**Trigger:** завершил работу, возвращает электродрель
**Flow:**
1. Worker: `/scan` (штрихкод на инструменте)
2. Бот: "Drill Makita HR2470 (сейчас у тебя). Возвращаешь?"
3. Worker: ✅
4. `POST /api/inventory/transactions { type: 'tool_return', catalogItemId, fromLocationId: worker_vehicle, toLocationId: tool_rack, performedBy }`
5. Catalog item: `assignedTo: null`, stock на tool_rack +1

**Expected:** Tool обратно в shared pool
**Edge cases:**
- condition='broken' → alert manager, mark для ремонта
- Не у этого работника → error "этот инструмент у John, не у тебя"
**Endpoints:** `POST /api/inventory/transactions`

---

## 3. Manager approvals

### UC-12 — Manager одобряет transfer request
**Actor:** Manager
**Trigger:** push из UC-09
**Flow:**
1. Manager получает уведомление "Worker Y запросил 100м wire"
2. Открывает `/crm/inventory/transfers` (UI)
3. Видит request, жмёт "Approve"
4. `PATCH /api/inventory/transfer-requests/:id/approve`
5. Backend: status='approved', fires `inventory.transfer_approved`
6. Warehouse staff уведомлён

**Expected:** Request approved, кладовщик видит задачу на сборку
**Edge cases:**
- Manager-скоупный лимит per-category (UC-14) превышен → auto-deny с reason
- Manager не в scope companyId → 403
**Endpoints:** `PATCH /api/inventory/transfer-requests/:id/approve`
**Events:** `inventory.transfer_approved`

### UC-13 — Manager reject transfer (причина: на другом объекте нужнее)
**Actor:** Manager
**Trigger:** конфликт приоритетов
**Flow:**
1. Manager в UI жмёт "Reject" с reason
2. `PATCH /api/inventory/transfer-requests/:id/reject { reason: "priority BMW over Amazon" }`
3. Requesting worker получает push с причиной

**Expected:** Request rejected, worker знает почему
**Endpoints:** `PATCH /api/inventory/transfer-requests/:id/reject`

### UC-14 — Category policy auto-approve (мелкий transfer)
**Actor:** System (no human manager needed)
**Trigger:** worker запросил 20м провода (policy: wire ≤50м auto-ok)
**Flow:**
1. Transfer request created
2. Backend проверяет `inventory_category_policies` для `wire`
3. qty (20) ≤ maxQty (50) AND value ($4) ≤ maxUsdValue ($50) → auto-approve
4. `status='approved'` без human
5. Event fires как обычно

**Expected:** No-touch approval для мелочи, экономит manager time
**Edge cases:**
- Policy undefined для category → require manager (fallback safe)
- qty exactly на границе (maxQty=50, request 50) → approved inclusive
**Endpoints:** `POST /api/inventory/transfer-requests` (internally checks policy)

### UC-15 — Manager пересматривает anomaly alert
**Actor:** Manager / Owner
**Trigger:** event `alert.inventory_anomaly` (ночной cron нашёл overrun)
**Flow:**
1. Telegram push: "⚠️ Amazon проект: wire overrun 150м (план 100м, +$30)"
2. Manager открывает dashboard, видит details
3. Варианты:
   - "Нормально, согласен" → mark anomaly as `reviewed`, no action
   - "Проверить" → открыть фото из `transactions_v2` для этой задачи
   - "Списать на loss" → создать `adjustment_out` с reason

**Expected:** Прозрачность, audit trail
**Endpoints:** `PATCH /api/inventory/anomalies/:id/review`

### UC-16 — Manager правит reservation (задача требует больше чем норматив)
**Actor:** Manager
**Trigger:** bригадир сказал "для этого проекта реально нужно 200м, не 100"
**Flow:**
1. Task уже имеет reservation 100м wire
2. Manager открывает task, жмёт "Adjust reservation"
3. Меняет qty → 200
4. `PATCH /api/inventory/reservations/:id { qty: 200 }`
5. Если availableStock < 200 → warning "не хватит, запроси transfer"
6. Commit, `inventory.reservation_updated` event

**Expected:** Резервирование обновляется, план скорректирован
**Endpoints:** `PATCH /api/inventory/reservations/:id`

---

## 4. Transfer between locations

### UC-17 — Warehouse staff собирает items для transfer
**Actor:** Warehouse staff (кладовщик)
**Trigger:** request status='approved'
**Flow:**
1. Кладовщик в UI: `/crm/inventory/picking-queue`
2. Видит request: "100м Wire 12AWG → Van Y"
3. Собирает физически, жмёт "Picked"
4. `PATCH /api/inventory/transfer-requests/:id/pick`
5. status='picked'
6. Event `inventory.transfer_picked` → driver уведомлён

**Expected:** Готово к отправке
**Endpoints:** `PATCH /api/inventory/transfer-requests/:id/pick`
**Events:** `inventory.transfer_picked`

### UC-18 — Driver отправляет transfer (commit transfer_out)
**Actor:** Driver / warehouse staff
**Trigger:** picked items загружены в машину
**Flow:**
1. Driver жмёт "Dispatch" в UI (или shortcut на mobile)
2. `PATCH /api/inventory/transfer-requests/:id/dispatch`
3. **Backend atomic batch:**
   - Create `inventory_transactions_v2 { type: 'transfer_out', transactionGroupId: UUID, fromLocationId, catalogItemId, qty }`
   - Decrement `stockByLocation[fromLocationId]` via `FieldValue.increment(-qty)`
   - Update `transfer_request { status: 'in_transit', dispatchedAt }`
4. Event `inventory.transfer_in_transit`

**Expected:** Stock на source decremented; request "hanging" в transit
**Edge cases:**
- Another tx modified stock meanwhile → transaction retry (Firestore optimistic lock)
- Batch fails → rollback всех 3 writes
**Endpoints:** `PATCH /api/inventory/transfer-requests/:id/dispatch`
**Events:** `inventory.transfer_in_transit`

### UC-19 — Driver доехал до объекта
**Actor:** Driver
**Trigger:** прибыл к receiving location
**Flow:**
1. Driver в боте `/arrived [request-id]` (или UI)
2. `PATCH /api/inventory/transfer-requests/:id/delivered`
3. status='delivered' (awaiting handshake)
4. Event `inventory.transfer_delivered` → receiving worker

**Expected:** Receiving worker знает что пора забирать
**Endpoints:** `PATCH /api/inventory/transfer-requests/:id/delivered`
**Events:** `inventory.transfer_delivered`

### UC-20 — Stale transit alert
**Actor:** System (cron)
**Trigger:** транзакция `transfer_out` > 24 часов без парного `transfer_in`
**Flow:**
1. Ночной cron: `SELECT * FROM inventory_transactions_v2 WHERE type='transfer_out' AND createdAt < 24h AGO AND transactionGroupId NOT IN (SELECT transactionGroupId FROM ... WHERE type='transfer_in')`
2. Для каждого: event `alert.stale_transit`
3. Manager получает push: "Transfer 100м wire завис в транзите > 24ч"

**Expected:** Ничего не теряется в транзите
**Edge cases:**
- Stale по weekend/holiday → tolerance configurable (default 24h)
**Endpoints:** scheduled function
**Events:** `alert.stale_transit`

### UC-21 — Разрешение stale transit (рекон)
**Actor:** Manager
**Trigger:** получил stale alert
**Flow:**
1. Manager: "уточнить" → смотрит кто был driver, zvonit
2. Вариант А: "доехали давно, просто handshake не сделали" → Manager делает `PATCH .../receive` от имени worker
3. Вариант Б: "потеряли в пути" → `POST /api/inventory/transactions { type: 'loss', qty, reason: 'in transit' }` от source + close request

**Expected:** Rec есть, остатки корректны
**Endpoints:** разные, зависит от сценария

---

## 5. Purchase orders & receiving

### UC-22 — Low stock trigger добавляет в корзину закупщика
**Actor:** System (on commitTransaction) + Purchaser
**Trigger:** после write-off stock < minStock
**Flow:**
1. Commit write-off → `stock = 5, minStock = 10` → `low_stock` event
2. System добавляет в `inventory_po_drafts/:purchaserId` запись `{catalogItemId, suggestedQty: minStock×2-stock, supplier?}`
3. Purchaser открывает UI "Draft PO cart"
4. Видит 7 items от разных поставщиков (Home Depot, Lowe's, local)

**Expected:** Корзина собирается автоматически, purchaser не ловит каждый low-stock
**Endpoints:** `GET /api/inventory/po-drafts/:purchaserId`
**Events:** `inventory.low_stock`

### UC-23 — Purchaser generates Draft PO по одному supplier
**Actor:** Purchaser
**Trigger:** end of day, пора закупать
**Flow:**
1. Purchaser в UI видит корзину, группирует по supplier
2. Выбирает "Home Depot: 5 items", жмёт "Generate PO"
3. `POST /api/inventory/po-drafts/:id/generate-po`
4. Backend создаёт запись в `erp_purchase_orders` status='draft'
5. Event `inventory.po_auto_created` → Manager
6. Manager одобряет / редактирует → отправляет поставщику

**Expected:** Один нажатие → PO готов к отправке
**Endpoints:** `POST /api/inventory/po-drafts/:id/generate-po`
**Events:** `inventory.po_auto_created`

### UC-24 — Приход товара от поставщика
**Actor:** Warehouse staff
**Trigger:** груз от Home Depot прибыл
**Flow:**
1. Кладовщик: `POST /api/inventory/transactions { type: 'purchase', catalogItemId, qty, toLocationId, costPerUnit, vendorName: 'Home Depot', purchaseOrderId? }`
2. Backend через commitTransaction:
   - Write log
   - Increment stock
   - Update `avgPrice` (rolling average от last 10 purchases)
3. Если был PO → mark PO как 'received' (full или partial)

**Expected:** Stock increased, avgPrice actualised
**Edge cases:**
- Partial receipt (заказали 100м, пришло 80м) → PO status='partially_received', остаток в pending
- Price changed → recompute avgPrice
**Endpoints:** `POST /api/inventory/transactions`

### UC-25 — Сканирование invoice при receipt (future)
**Actor:** Warehouse staff
**Trigger:** получил PDF invoice
**Flow:**
1. UI: "Upload invoice"
2. Gemini Vision парсит: items + qtys + prices
3. Matches to catalog items by sku/name (fuzzy)
4. Показывает preview: "Найдено 5 items, 1 unmatched"
5. Staff корректирует → confirm
6. Создаются `purchase` transactions

**Expected:** 5-мин receipt processing вместо ручного ввода
**Endpoints:** Gemini Vision + bulk `POST /api/inventory/transactions`

### UC-26 — Vendor performance report
**Actor:** Owner / Manager
**Trigger:** анализ поставщиков конец месяца
**Flow:**
1. `GET /api/inventory/reports/vendor-performance?from=...&to=...`
2. Backend aggregates: per-vendor (total spend, items, avg delivery time, returns count)
3. Report: "Home Depot: $3,400 spent, 12 receipts, 0 returns. Local Supply Co: $800, 3 receipts, 1 return."

**Expected:** Data-driven vendor selection
**Endpoints:** `GET /api/inventory/reports/vendor-performance`

---

## 6. Norms & auto write-off

### UC-27 — Создание норматива расхода
**Actor:** Admin / Manager
**Trigger:** добавляем новый тип задач "Укладка плитки 1 м²"
**Flow:**
1. UI "Normы" → Create
2. taskTemplate = "tile_installation_1m2"
3. items: [{catalogItemId: tile_30x30, qty: 1}, {catalogItemId: adhesive, qty: 0.66}]
4. `POST /api/inventory/norms`
5. При создании задачи с этим template — auto-reserve

**Expected:** Template available для future tasks
**Endpoints:** `POST /api/inventory/norms`

### UC-28 — Auto write-off после завершения задачи
**Actor:** System + Worker (confirm)
**Trigger:** worker делает `/stop` для задачи, у task есть норматив
**Flow:**
1. Task completed event
2. Agent вычисляет: norm × taskSize (e.g., 4.5 м²) → draft write-off
3. Бот worker'у: "Готов списать: плитка 4.5 м², клей 3 кг. [✅ Всё точно] [✏️ Корректировать]"
4. Worker: ✅
5. Draft → commit: `commitTransaction` с type='write_off', taskId linked
6. Event `inventory.draft_writeoff_pending` → `inventory.self_checkout` после confirm

**Expected:** 5 секунд вместо 2 минут ручного ввода
**Edge cases:**
- Worker игнорирует prompt 24ч → event `inventory.draft_writeoff_expired` → manager notified
- Worker корректирует qty (fact != plan) → new draft, confirm, commit with actual
**Endpoints:** `POST /api/inventory/write-off-by-norm`
**Events:** `inventory.draft_writeoff_pending`, `inventory.self_checkout`

### UC-29 — Norm update (cleanup шаблона)
**Actor:** Admin
**Trigger:** посчитали что клея реально уходит 0.75 кг/м², не 0.66
**Flow:**
1. `PATCH /api/inventory/norms/:id` с новыми qtys
2. Будущие задачи используют новый норматив
3. Прошлые задачи (facts в транзакциях) не меняются — история иммутабельна

**Expected:** Live update без touching history
**Endpoints:** `PATCH /api/inventory/norms/:id`

### UC-30 — Batch write-off по end-of-day (pack station)
**Actor:** Pack station bot + Worker
**Trigger:** в конце дня рабочий получает "готов закрыть день" предложение
**Flow:**
1. Cron: за день 5 задач у worker завершено, норматив есть, нет ручного списания
2. Bot в 17:00: "Списать по нормам всех 5 задач? (3 плитки + 2 розетки)"
3. Worker: ✅ / или редактирует каждую
4. Batch commit

**Expected:** EOD reconciliation, нет забытых списаний
**Endpoints:** scheduled function
**Events:** `inventory.self_checkout` (batch)

---

## 7. Stock counts / reconciliation

### UC-31 — Старт cycle count (физическая инвентаризация)
**Actor:** Admin / Manager
**Trigger:** ежемесячная инвентаризация
**Flow:**
1. UI: "Start cycle count for Van Y"
2. `POST /api/inventory/cycle-counts { locationId, assignedTo }`
3. Snapshot: текущий `stockByLocation[locationId]` заморожен
4. Worker получает mobile task

**Expected:** Count session создан, snapshot для сравнения
**Endpoints:** `POST /api/inventory/cycle-counts`

### UC-32 — Проведение physical count в боте
**Actor:** Worker (counter)
**Trigger:** начался cycle count
**Flow:**
1. Worker получает список items в боте
2. Для каждого: `/scan` → "Сейчас в машине: ___ ед."
3. Worker вводит factual qty
4. Если fact != snapshot → diff сохраняется
5. По завершению: `PATCH /api/inventory/cycle-counts/:id/submit`

**Expected:** Все items сосчитаны, diffs собраны
**Endpoints:** `PATCH /api/inventory/cycle-counts/:id/submit`

### UC-33 — Resolve recount diffs (adjustment)
**Actor:** Manager
**Trigger:** cycle count submitted с diffs
**Flow:**
1. Manager review: "на 5 items расхождение"
2. Per-item: accept adjustment с reason
3. `POST /api/inventory/transactions { type: 'adjustment_in'/'adjustment_out', qty: diff, reason: 'cycle count 2026-04' }`
4. Stock корректируется, audit trail preserved

**Expected:** Бухгалтерия восстановлена, worker не обвинён напрасно
**Edge cases:**
- Diff > 10% → требует 2-факторной approve (manager + owner)
**Endpoints:** `POST /api/inventory/transactions`

---

## 8. Alerts & anomalies

### UC-34 — Critical stock alert
**Actor:** System + Owner
**Trigger:** stock падает ниже `minStock × 0.25`
**Flow:**
1. commitTransaction детектит `stock < minStock * 0.25`
2. Event `inventory.critical_stock` (not low_stock — более серьёзное)
3. Owner + Manager + Purchaser получают Telegram push
4. Preview: "⚠️ КРИТИЧНО: Wire 12 AWG — 3м (норма 50м)"

**Expected:** Никто не проморгает
**Endpoints:** (автоматически при commit)
**Events:** `inventory.critical_stock`

### UC-35 — Anomaly detection (plan vs fact)
**Actor:** System (cron)
**Trigger:** ежедневный 6am cron
**Flow:**
1. Для каждой завершённой за сутки задачи:
2. plannedQty = norm × taskSize
3. actualQty = sum(transactions WHERE taskId = task.id AND type='write_off')
4. overrun = actualQty - plannedQty
5. overrunValue = overrun × avgPrice
6. Если `overrun/plannedQty > 0.25 AND overrunValue > $50` → event `alert.inventory_anomaly`

**Expected:** Крупные расхождения поднимаются, мелкий шум игнорируется
**Endpoints:** scheduled function (runAnomalyDetection)
**Events:** `alert.inventory_anomaly`

### UC-36 — Reservation conflict
**Actor:** System
**Trigger:** 2 task пытаются reserve тот же stock (availableStock < 0)
**Flow:**
1. Task A reserves 50м из 100м wire → availableStock = 50
2. Task B reserves 60м — 50м < 60 — conflict
3. Reservation B статус='pending_resolution'
4. Event `inventory.reservation_conflict` → Manager
5. Manager: (a) approve split, (b) reject B, (c) создать transfer для дополнительного stock

**Expected:** Нет молчаливого перерасхода
**Endpoints:** (автоматически при reserve)
**Events:** `inventory.reservation_conflict`

---

## 9. Reports & analytics

### UC-37 — Project P&L (materials cost)
**Actor:** Manager / Owner
**Trigger:** финансовый анализ проекта
**Flow:**
1. `GET /api/inventory/reports/project-cost?clientId=amazon`
2. Backend: SUM(write_off qty × avgPrice) WHERE clientId=amazon
3. Report breakdown: category → items → qty → cost

**Expected:** Точная цифра сколько материалов ушло на проект
**Endpoints:** `GET /api/inventory/reports/project-cost`

### UC-38 — Worker consumption report (fraud check)
**Actor:** Owner
**Trigger:** подозрение "один работник списывает слишком много"
**Flow:**
1. `GET /api/inventory/reports/worker-consumption?from=...&to=...`
2. Backend: aggregate write_off transactions by `performedBy`
3. Relative: % от total company consumption per worker
4. Flagged: workers с z-score > 2

**Expected:** Outliers видны
**Endpoints:** `GET /api/inventory/reports/worker-consumption`

### UC-39 — Dead stock report
**Actor:** Admin
**Trigger:** ежеквартальный clean-up
**Flow:**
1. `GET /api/inventory/reports/dead-stock?days=90`
2. Backend: items без transactions последние 90+ дней
3. Для каждого: currentStock, lastMoveDate, $tied-up
4. Admin принимает решения: списать / распродать / вернуть поставщику

**Expected:** Capital tied up в dead stock прозрачен
**Endpoints:** `GET /api/inventory/reports/dead-stock`

---

## 10. AI agent interactions

### UC-40 — Agent проактивно предлагает transfer
**Actor:** AI agent (на стороне partner через SDK)
**Trigger:** partner's bot обнаружил task без материалов на нужной локации
**Flow:**
1. Agent: `agent.inventory.catalog.list(filters={name: "wire", locationId: "vehicle_worker_y"})` → stock=0
2. Agent: `agent.inventory.catalog.list(filters={name: "wire", minStock: 100})` → found 200м на "Main Warehouse"
3. Agent создаёт transfer_request draft
4. Бот → worker: "Предлагаю transfer 100м wire из Main Warehouse. Согласен? [✅/❌]"
5. Worker: ✅ → agent `agent.inventory.transfers.request(...)` — human-confirmed action

**Expected:** Agent proposes, human confirms (Copilot pattern §4.1 V2)
**Endpoints:** SDK methods

### UC-41 — Agent генерирует Weekly digest для Owner
**Actor:** AI agent
**Trigger:** cron каждый Monday morning
**Flow:**
1. Agent запрашивает через SDK:
   - Anomalies за неделю (`alert.inventory_anomaly`)
   - Low stock items (`inventory.low_stock` count)
   - Dead stock
   - Top 5 workers по consumption
2. Gemini суммаризирует в 5-пунктный digest
3. Telegram push Owner: "📊 Weekly Inventory Digest: 3 аномалии на $120, 7 low-stock для PO, Алексей +45% above plan"

**Expected:** Owner в курсе без копания в dashboards
**Endpoints:** SDK list methods

### UC-42 — Agent помогает закупщику формировать PO
**Actor:** AI agent + Purchaser
**Trigger:** покупатель открывает корзину
**Flow:**
1. Agent анализирует корзину
2. Предлагает: "Из 7 items — 5 обычно берёшь в Home Depot, 2 в Lowe's. Разбить на 2 PO?"
3. Покупатель: ✅
4. Agent создаёт 2 Draft PO
5. Agent сравнивает с last 3 purchase prices: "Heads-up: wire price вырос на 12% vs last month"

**Expected:** Purchaser efficient, price awareness
**Endpoints:** SDK `inventory.po_drafts.*`

### UC-43 — Agent helps onboard new worker
**Actor:** AI agent + новый worker
**Trigger:** worker впервые заезжает на склад после регистрации
**Flow:**
1. Agent через бота: "Добро пожаловать! Давай я помогу собрать твою машину"
2. Quick inventory guide: "Обычно у vehicle: wire 100м, розетки 50шт, инструменты — набор X"
3. Worker сканирует items, qty
4. Agent commit transfer с Main Warehouse → Van

**Expected:** Новичок setup'ся за 10 минут
**Endpoints:** SDK `inventory.transfers.*`

### UC-44 — Agent анализирует фото с объекта
**Actor:** AI agent
**Trigger:** worker шлёт фото выполненной работы + caption "уложил плитку 4.5 м²"
**Flow:**
1. Gemini Vision: анализирует фото, counts tiles, верифицирует caption
2. Если match (4.5 м² ≈ 50 плиток 30x30) — agent confirms norm write-off
3. Если mismatch — agent задаёт уточняющий вопрос

**Expected:** Бесконтактная верификация норматива
**Endpoints:** Gemini Vision + SDK

---

## 11. Edge cases / errors

### UC-45 — Concurrent writes (race condition)
**Scenario:** 2 worker одновременно списывают 100м из 150м доступных
**Flow:**
1. Worker A: `commitTransaction(write_off, 100)` → stock 150 → 50
2. Worker B через 200ms: `commitTransaction(write_off, 100)` → stock 50, qty=100 → fails
3. Firestore transactional lock: B retries → видит stock=50 → rejects с "insufficient stock (available: 50)"

**Expected:** Atomicity сохраняется, никто не уходит в минус
**Test:** concurrency test в Phase 0 acceptance

### UC-46 — Network fail в середине transfer
**Scenario:** driver запустил `/dispatch`, потерял связь до confirm
**Flow:**
1. `PATCH /api/inventory/transfer-requests/:id/dispatch` — backend создал transfer_out
2. Клиент не получил response из-за network
3. Client retry → backend detects idempotency (`transactionGroupId` уже есть) → no double-write
4. Return success (idempotent)

**Expected:** Нет дубликатов, нет потерь
**Test:** idempotency test

### UC-47 — Offline scenario (driver)
**Scenario:** driver между складов, нет связи
**Flow:**
1. PWA/mobile кеширует actions локально (IndexedDB)
2. Queue: `["dispatch request X at 10:00", "arrived at location Y at 11:30"]`
3. Когда связь вернулась — auto-flush queue
4. Backend применяет в правильном порядке по timestamp

**Expected:** Offline-first, sync на resume
**Note:** Offline support — Phase 3 (out of V3 core)

### UC-48 — Delete item c transactions
**Scenario:** Admin пытается удалить item который имеет 500 транзакций за год
**Flow:**
1. `DELETE /api/inventory/catalog/:id`
2. Backend: если transactions references exist → НЕ физически удаляет
3. Soft-delete: `isArchived: true`
4. Транзакции сохранены для аудита, но item hidden

**Expected:** Аудит не ломается, UI очищается

### UC-49 — Migration rollback
**Scenario:** Phase 0 миграция пошла не так, обнаружили на проде
**Flow:**
1. Admin: `POST /api/inventory/rollback-migration { untilTimestamp: '...' }` (admin-only)
2. Backend: удаляет все записи с `migratedAt > timestamp`
3. Restore old collections (`warehouses`, `inventory_items`) из migration-backup
4. Если frontend уже показывает new collections — возвращает feature flag `USE_V3_COLLECTIONS=false`

**Expected:** Graceful rollback за 10 минут
**Required before Phase 0 deploy:** migration-backup collection

### UC-50 — Multi-tenant leak test (security)
**Scenario:** Worker от Company A пытается получить transfers Company B
**Flow:**
1. Worker A's token → `GET /api/inventory/transfer-requests?companyId=B`
2. RLS middleware: `req.effectiveCompanyId === 'A'` но query требует 'B' → 403
3. Без companyId параметра — `req.effectiveCompanyId` implicit filter
4. Result: 0 documents от Company B

**Expected:** Zero leakage между tenants
**Test:** `rlsCrossTenant.test.ts` extended with inventory cases (4 ролей × 5 endpoints = 20 тестов)

---

## Summary Matrix

| Категория | Cases | Critical (нельзя пропустить в MVP) |
|---|---|---|
| Basic CRUD | 5 | UC-01, UC-02, UC-05 |
| Daily worker | 6 | UC-06, UC-08 |
| Manager approvals | 5 | UC-12, UC-14 |
| Transfers | 5 | UC-17, UC-18, UC-19, UC-20 |
| PO & receiving | 5 | UC-22, UC-24 |
| Norms | 4 | UC-27, UC-28 |
| Stock counts | 3 | (Phase 3) |
| Alerts | 3 | UC-34 |
| Reports | 3 | UC-37 |
| AI agents | 5 | UC-40 |
| Edge cases | 6 | UC-45, UC-46, UC-48, UC-49, UC-50 |

**MVP (Phase 0 + 1) covers:** Critical column.
**Phase 2:** остальные из CRUD, manager, transfers, alerts, agents.
**Phase 3:** cycle counts + некоторые reports + offline.

---

## Cross-References

- **Main spec:** [`WAREHOUSE_SPEC_V3.md`](./WAREHOUSE_SPEC_V3.md)
- **V2 (archive):** [`WAREHOUSE_SPEC_V2.md`](./WAREHOUSE_SPEC_V2.md)
- **Python SDK:** [`PYTHON_SDK_SPEC.md`](./PYTHON_SDK_SPEC.md) §Phase 2
- **Existing code:** `functions/src/agent/routes/inventory.ts`, `src/pages/inventory/InventoryPage.tsx`, `src/types/inventory.types.ts`
- **RLS pattern:** commit `ceb8464`
