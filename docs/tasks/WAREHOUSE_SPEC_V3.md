# ТЗ: Склад V3 — Authoritative Warehouse & Inventory System

> **Статус:** ACTIVE SPEC (executable roadmap)
> **Автор:** Denis + Claude Code
> **Дата:** 2026-04-17
> **Supersedes:** [`WAREHOUSE_SPEC_V2.md`](./WAREHOUSE_SPEC_V2.md) (V2 становится архив/reference, V3 — authoritative)
> **Use cases:** см. [`WAREHOUSE_USE_CASES.md`](./WAREHOUSE_USE_CASES.md) — 50 конкретных сценариев

---

## 0. TL;DR

Объединить две параллельные inventory-системы в одну. Добавить multi-tenant scoped access. Выкатить Telegram-first worker UX с barcode scan. Phase-based roll-out: P0 (unify) → P1 (quick wins) → P2 (advanced) → P3 (future).

**Effort:** P0 ≈ 15-20ч, P1 ≈ 15-20ч, P2 ≈ 40-60ч, P3 ≈ 20-40ч.
**Приоритет:** запускать только при наличии одного из 3 бизнес-сигналов (см. §2.3).

---

## 1. Business Context

### 1.1. Почему вообще inventory в profit-step

- Подрядные стройбизнесы (цель SaaS) **отслеживают материалы** между закупкой и объектом
- Профит-степ уже делает time-tracking, payroll, reconciliation — inventory **логичное расширение** для полного job-costing
- **Моат:** Telegram-first + AI copilot — ни у кого из конкурентов (ServiceTitan, JobTread, Buildertrend) этого нет

### 1.2. Где сидят альтернативы

| Продукт | Цена/мес | Где сильны | Где слабы |
|---|---|---|---|
| ServiceTitan | $300-500/user | Barcode, PO, cycle counting, vendor mgmt | Enterprise цена, нет Russian, нет AI copilot |
| JobTread | $149-899 | Project-material linking, job costing | Нет mobile bot, нет AI |
| Buildertrend | $99-399 | Client portal, vendor catalog | Нет AI copilot |
| SortlyPro | $29-179 | **Лучший barcode scan UX** | Не construction-specific, нет payroll integration |
| Zoho Inventory | $39-299 | Multi-warehouse, serial/batch | Generic, не стройка |

### 1.3. Конкурентные преимущества profit-step (защищаем)

1. **AI-agent copilot** — "агент предлагает, человек подтверждает" (§6.1). Уникально.
2. **Telegram-first worker interface** — рабочие уже в боте каждый день, новое UI не нужно.
3. **Нормативы + auto write-off** — рабочий закончил задачу, бот сам предлагает списать материалы.
4. **Интеграция с payroll + costs** — один источник правды для цифр на проекте.

---

## 2. Current State Audit

### 2.1. Что работает (код в main branch)

**API** (`functions/src/agent/routes/inventory.ts`, 1102 строки, 16 endpoints):

```
POST   /api/inventory/warehouses
GET    /api/inventory/warehouses
GET    /api/inventory/warehouses/:id
PATCH  /api/inventory/warehouses/:id
DELETE /api/inventory/warehouses/:id
POST   /api/inventory/items
GET    /api/inventory/items
PATCH  /api/inventory/items/:id
DELETE /api/inventory/items/:id
POST   /api/inventory/transactions
POST   /api/inventory/transactions/task
GET    /api/inventory/transactions
POST   /api/inventory/norms
GET    /api/inventory/norms
GET    /api/inventory/norms/:id
POST   /api/inventory/write-off-by-norm
```

**UI** (`src/pages/inventory/InventoryPage.tsx`, 612 строк):
- Каталог + склады + приход/списание + добавление позиций

**Types** (`src/types/inventory.types.ts`):
- 9 transaction types (purchase, write_off, transfer, loss, adjustment_in/out, return_in, tool_issue, tool_return)
- 4 categories (materials, tools, consumables, equipment)
- 7 единиц измерения
- Stock via `stockByLocation: Record<locationId, qty>`

### 2.2. Критичные проблемы (§3 Spec V2 детально)

| # | Проблема | Impact |
|---|---|---|
| P1 | **Две параллельные системы, не синхронизированы**: Simple API (`warehouses` + `inventory_items` + `inventory_transactions`) и Advanced UI (`inventory_catalog` + `inventory_transactions_v2` + `inventory_locations`) | Списал через API → в UI не увидишь. Блокирует любые новые фичи. |
| P2 | **Нет scoped queries** — любой токен с `inventory:read` видит все склады | Multi-tenant нарушен. Бригадир видит чужие машины. |
| P3 | **Warehouse не привязан к employee** (`ownerEmployeeId` отсутствует) | Бригадир не знает какая машина "его" |
| P4 | **Python SDK не покрывает inventory** (Phase 1 SDK — 8 доменов, inventory не из них) | Партнёры не могут использовать warehouse API через SDK |
| P5 | **Webhook events скудны** — только `inventory.low_stock` и `inventory.transaction` | Нет transfer_*, draft_*, anomaly, stale_transit |
| P6 | **Нет barcode scan** | Ключевая фича индустрии, у нас отсутствует |
| P7 | **Нет PO workflow в inventory** (в ERP есть отдельно) | Закупщик не может "собрать корзину по vendors" |

### 2.3. Бизнес-сигналы к запуску

**Не брать в работу пока не появится хотя бы один из:**

1. **Реальный центральный склад** (арендуешь warehouse ≥500 sqft). Сейчас работа site-direct — нет централизации.
2. **Жалоба от бригадира** вида "не знаю сколько у меня в машине провода 12AWG"
3. **Запрос от партнёра** через SDK на `inventory` domain (партнёру нужно читать/писать складские данные)

Без сигналов ROI отрицательный (см. §11.3 в V2 и разговор 2026-04-17).

---

## 3. Goals & Non-Goals

### 3.1. Goals

- **G1. Единая система** — 1 write path через `InventoryService.commitTransaction()`. Никаких прямых мутаций остатков.
- **G2. Multi-tenant scoped access** — `ownerEmployeeId` на warehouse + RLS фильтры в route handlers.
- **G3. Python SDK coverage** — domain `inventory` в SDK Phase 2.
- **G4. Telegram-first worker UX** — списание / трансфер / выдача через бота с draft-and-confirm.
- **G5. Barcode scan через бота** — фото штрихкода → ZXing/Gemini Vision → caption items.
- **G6. Plan-vs-Fact analytics** — остатки проекта vs фактический расход с alerts.
- **G7. PO integration** — закупщик собирает low-stock в корзину → Draft PO → approve.

### 3.2. Non-Goals (V3 НЕ делает)

- **N1.** Полноценный ERP (raw materials planning, BOM)
- **N2.** Мультивалютные склады
- **N3.** Serial numbers per item (только batches)
- **N4.** Warehouse management system для третьих лиц (free-standing WMS)
- **N5.** Integration с Shopify / Amazon FBA
- **N6.** Automatic reorder (только Draft PO, человек одобряет)

---

## 4. Architecture

### 4.1. Source of Truth & Materialized State

**Write Path (source of truth):**
- `inventory_transactions_v2` — immutable журнал всех движений
- `inventory_reservations` — план будущего расхода (NEW)

**Read Path (materialized):**
- `inventory_catalog.stockByLocation` — кэш для быстрого отображения
- `inventory_catalog.totalStock` + `availableStock` — производные значения

**Правила:**
1. Весь софт пишет ТОЛЬКО через `InventoryService.commitTransaction()`
2. Прямой `PATCH /catalog/:id { stock: 100 }` — **запрещён**
3. При подозрении на рассинхрон — `POST /api/inventory/recalculate` (admin-only)

### 4.2. Atomic Transfer Protocol

Transfer = единый процесс, не два разрозненных вызова.

```
{
  transactionGroupId: UUID,           // связка out + in
  transferRequestId: string | null,   // ref на transfer_request
}
```

**Поток:**
1. Кладовщик даёт "Отправить" → atomic batch: `transfer_out` (списано с A) + status `in_transit`
2. Получатель жмёт "Принял" → `transfer_in` (зачислено на B) с тем же `transactionGroupId`
3. Stale alert: `transfer_out` без парного `transfer_in` > 24ч → `alert.stale_transit`

### 4.3. Event Dictionary (frozen)

15 событий, все агенты/webhook'и используют ТОЛЬКО эти ключи:

| Event | Trigger | Target role |
|---|---|---|
| `inventory.low_stock` | stock < minStock | Manager, Purchaser |
| `inventory.critical_stock` | stock < minStock × 0.25 | Owner, Manager |
| `inventory.transfer_requested` | Worker создал request | Manager |
| `inventory.transfer_approved` | Manager approved | Warehouse staff |
| `inventory.transfer_picked` | Warehouse staff собрал | Requesting worker |
| `inventory.transfer_in_transit` | Отправлено | Receiving worker |
| `inventory.transfer_delivered` | Driver arrived | Receiving worker |
| `inventory.transfer_completed` | Handshake от получателя | Manager |
| `inventory.self_checkout` | Worker списал сам | Manager (FYI) |
| `inventory.draft_writeoff_pending` | Agent создал draft | Worker (confirm) |
| `inventory.draft_writeoff_expired` | 24ч без ответа | Manager |
| `inventory.po_auto_created` | Supplier cart → Draft PO | Manager, Purchaser |
| `inventory.reservation_conflict` | 2 tasks на тот же stock | Manager |
| `alert.inventory_anomaly` | Fact > Plan × multiplier AND $ > threshold | Owner |
| `alert.stale_transit` | transfer_out без transfer_in > 24ч | Manager |

### 4.4. Category-Based Policies

Глобальные лимиты "$150 на всё" плохо работают — кабель за $20 и ноутбук за $2000 требуют разного workflow.

Per-category политика (collection `inventory_category_policies`):

```typescript
interface CategoryPolicy {
  categoryId: string;  // wire, tools, fasteners, smart_devices, etc.
  autoApproveTransfer: {
    maxQty: number;
    maxUsdValue: number;
  };
  autoWriteOffByNorm: boolean;  // pack station может списывать сам
  requiresSerialNumber: boolean;
}
```

### 4.5. Multi-tenant (RLS)

Каждый запрос фильтруется по `companyId` + role + (где применимо) `ownerEmployeeId`.

```typescript
// Worker role → видит только свои склады + общие
if (role === 'worker' || role === 'driver') {
  query = query.where('ownerEmployeeId', 'in', [myId, null]);
}
// Foreman → team + общие
else if (role === 'foreman') {
  query = query.where('ownerEmployeeId', 'in', [...teamIds, null]);
}
// Manager/admin → всё
```

Паттерн из ceb8464 (dashboard RLS) — копируем в inventory routes.

---

## 5. Data Model

### 5.1. Core collections (unified)

```
inventory_catalog           // каталог позиций (Stock-Keeping Units)
  ├─ stockByLocation       // cache: { locationId: qty }
  ├─ totalStock            // sum(stockByLocation)
  ├─ minStock              // threshold для low_stock event
  ├─ category              // materials / tools / consumables / equipment
  └─ unit                  // шт / кг / л / м / м² / упак / рул

inventory_locations         // склады / машины / объекты
  ├─ type                  // warehouse / vehicle / site / pack_station
  ├─ ownerEmployeeId?      // для RLS scoping
  └─ address / coords

inventory_transactions_v2   // journal (immutable)
  ├─ type                  // 9 типов (purchase, write_off, etc.)
  ├─ transactionGroupId?   // для transfers
  ├─ clientId?             // привязка к проекту
  ├─ taskId?               // привязка к задаче
  ├─ performedBy           // employee ID
  └─ createdAt             // timestamp

inventory_reservations      // план будущего расхода (NEW V3)
  ├─ taskId
  ├─ catalogItemId
  ├─ qtyReserved
  └─ expiresAt             // авто-отпустить через N дней

inventory_norms             // нормативы расхода
  ├─ taskTemplate          // "Укладка плитки 1 м²"
  └─ items                 // [{catalogItemId, qtyPer1Unit}]

inventory_transfer_requests // request workflow
  ├─ fromLocationId
  ├─ toLocationId
  ├─ items                 // [{catalogItemId, qty}]
  ├─ status                // requested / approved / picked / in_transit / completed
  └─ transactionGroupId

inventory_category_policies // per-category auto-approve thresholds
inventory_po_drafts         // корзина закупщика → Draft PO
```

### 5.2. Migration плана

Существующие collections (Simple API) merge в Advanced:

| Source | Target | Script |
|---|---|---|
| `warehouses` | `inventory_locations` (type: warehouse) | `scripts/migrate-inventory-simple-to-v3.ts` |
| `inventory_items` | `inventory_catalog` | same script |
| `inventory_transactions` | `inventory_transactions_v2` | same script |

**Migration проверки:**
- Dry-run mode (не пишет, только логи)
- Idempotent (можно перезапускать)
- Rollback (помечает записи `migratedAt`, можно откатить по timestamp)

---

## 6. API Contract

### 6.1. Новые эндпоинты (V3 additions)

```
# Transfers
POST   /api/inventory/transfer-requests           # create
GET    /api/inventory/transfer-requests           # list (scoped)
PATCH  /api/inventory/transfer-requests/:id/approve
PATCH  /api/inventory/transfer-requests/:id/pick
PATCH  /api/inventory/transfer-requests/:id/dispatch
PATCH  /api/inventory/transfer-requests/:id/receive   # handshake

# Reservations
POST   /api/inventory/reservations
DELETE /api/inventory/reservations/:id

# Recalculate (admin-only)
POST   /api/inventory/recalculate

# Draft PO (purchaser cart)
POST   /api/inventory/po-drafts                   # add to cart
GET    /api/inventory/po-drafts/:purchaserId      # my cart
POST   /api/inventory/po-drafts/:id/generate-po   # create Draft PO

# Category policies
GET    /api/inventory/category-policies
PATCH  /api/inventory/category-policies/:id       # admin-only

# Physical inventory (cycle counting)
POST   /api/inventory/cycle-count                 # start count
PATCH  /api/inventory/cycle-count/:id/submit      # submit results
```

### 6.2. Модифицированные эндпоинты

- Все `GET /api/inventory/*` добавляют RLS фильтры
- `POST /api/inventory/transactions` идёт через `InventoryService.commitTransaction()` (не напрямую)
- `PATCH /api/inventory/items/:id` — запрещает менять `stockByLocation` напрямую

### 6.3. Deprecations

Simple API (после миграции P0):
- `POST /api/inventory/transactions` — keep, но internally routes to v2
- `warehouses` collection — deprecated, данные переехали в `inventory_locations`
- `inventory_items` — deprecated, данные переехали в `inventory_catalog`

---

## 7. Python SDK Integration (Phase 2)

Из `docs/tasks/PYTHON_SDK_SPEC.md` Phase 2 — добавить `InventoryDomain`:

```python
agent.inventory.catalog.list(category="tools", limit=50)
agent.inventory.catalog.create(name="Wire 12 AWG", unit="м", category="materials")
agent.inventory.locations.list()  # RLS-scoped
agent.inventory.transactions.list(from_date="2026-04-01", type="purchase")
agent.inventory.transactions.record_purchase(catalog_item_id="...", qty=100, location_id="...")
agent.inventory.transfers.request(from_location_id="...", to_location_id="...", items=[...])
agent.inventory.transfers.approve(request_id="...")
agent.inventory.norms.write_off(task_id="...", dry_run=True)  # Draft
agent.inventory.norms.write_off(task_id="...", confirm=True)  # Commit
```

Models: `CatalogItem`, `Location`, `Transaction`, `TransferRequest`, `Reservation`, `Norm`.

Effort: 6-8 часов (соответствует SDK Phase 2).

---

## 8. Telegram Worker UX

### 8.1. Commands (new)

```
/stock                    → остатки моей машины (scoped)
/stock wire               → поиск "wire" в моей машине
/scan                     → отправь фото штрихкода
/transfer                 → создать transfer request
/received [groupId]       → подтвердить получение (handshake)
```

### 8.2. Draft & Confirm Pattern

После `/stop` задачи, если у задачи есть норматив:

```
Бот: "Задача 'Укладка плитки 4.5 м²' завершена.
      Готов списать по норме:
        • Плитка 30×30: 4.5 м² (остаток станет 12 м²)
        • Клей плиточный: 3 кг (остаток станет 5 кг)
      
      [✅ Всё точно] [✏️ Корректировать] [❌ Отмена]"

Работник жмёт "Корректировать":

Бот: "Сколько реально ушло плитки? (было 4.5)"
Работник: "5"
Бот: "Сколько клея? (было 3)"
Работник: "2.5"
Бот: "Подтвердить: плитка 5 м², клей 2.5 кг? [✅/❌]"
Работник: "✅"
→ commitTransaction(write_off, ...)
→ event `inventory.self_checkout`
```

### 8.3. Barcode Scan

```
Работник: [фото штрихкода]
Бот: "Нашёл: Wire 12 AWG THHN (остаток в машине: 320м)
      Что делаешь?
      [📤 Списать] [📥 Приход] [🔄 Передать]"
```

Распознавание: Gemini Vision (multimodal) с prompt "найди штрихкод, верни только числовой код". Fallback: ZXing WASM в браузере.

---

## 9. Plan-vs-Fact Analytics

### 9.1. Reservation at task-create

При создании задачи с нормативом:
- Резервируем qty из нормы → `inventory_reservations`
- Уменьшаем `availableStock` (= totalStock − reservations)
- Если availableStock < qty → warning "не хватит"

### 9.2. Fact tracking at task-complete

На `/stop`:
- Draft write-off с qty по норме (из §8.2)
- Работник корректирует если не совпало
- Фактические qty записываются в `inventory_transactions_v2`

### 9.3. Anomaly detection

Ежедневный cron:
```typescript
for each task completed yesterday {
  const planned = norm.totalQtyPlanned * taskSize
  const actual = sum(transactions where taskId = task.id)
  const overrun = actual - planned
  const overrunValue = overrun * avgPrice
  
  if (overrun / planned > 0.25 && overrunValue > 50) {
    publishEvent('alert.inventory_anomaly', { taskId, planned, actual, overrunValue })
  }
}
```

### 9.4. Reports

- **Project P&L** — materials cost по проекту (sum of write_off with clientId)
- **Worker consumption** — кто больше всех списывает (fraud check)
- **Dead stock** — items без transactions > 90 дней
- **Top variances** — task types с наибольшим overrun

---

## 10. Implementation Phases

### Phase 0 — Unification (MUST, блокирует все остальное)

**Scope:**
- Data migration Simple → Advanced (script + dry-run + rollback)
- `InventoryService.commitTransaction()` как единый write path
- Deprecate direct writes (grep + refactor)
- Unit tests для commitTransaction (concurrency, atomicity)

**Deliverables:**
- `scripts/migrate-inventory-simple-to-v3.ts` idempotent
- `functions/src/agent/services/InventoryService.ts`
- Updated `functions/src/agent/routes/inventory.ts` (все endpoints через service)
- Migration runbook в `docs/runbooks/inventory-migration.md`
- 20+ unit tests

**Acceptance:**
- [ ] Migration script на стейджинге: `warehouses` + `inventory_items` → `inventory_locations` + `inventory_catalog` без data loss
- [ ] Все 16 существующих endpoints работают после unification
- [ ] Нет прямых мутаций stock (grep `stockByLocation\[.*\]\s*=`)
- [ ] `npx jest test/inventoryService` passes
- [ ] Prod migration выполнена (с мониторингом 48ч)

**Effort:** 15-20 часов
**Dependencies:** нет

---

### Phase 1 — Quick Wins (business-visible)

**Scope:**
- Scoped queries (RLS) на warehouses + items + transactions
- `ownerEmployeeId` поле на locations (migration + UI)
- Barcode scan в Telegram worker bot
- Python SDK inventory domain

**Deliverables:**
- RLS фильтры в 5 inventory routes (pattern из ceb8464)
- UI: выбор "Чья машина?" при создании location
- `functions/src/triggers/telegram/handlers/inventoryBarcode.ts`
- `sdk/python/profit_step_agent/domains/inventory.py` + models + tests

**Acceptance:**
- [ ] Worker с token-per-employee видит только свои склады в `/api/inventory/warehouses`
- [ ] Foreman видит склады своей team
- [ ] `rlsCrossTenant.test.ts` расширен inventory тестами (3 routes × 3 ролей)
- [ ] В боте `/scan` + фото → находит item → предлагает 3 действия
- [ ] SDK: `agent.inventory.*` работает, 15+ pytest
- [ ] SDK опубликован v0.2.0-beta

**Effort:** 15-20 часов
**Dependencies:** Phase 0

---

### Phase 2 — Advanced (требует investment, откладываемый)

**Scope:**
- Transfer request workflow (full handshake)
- Reservations system
- Plan-vs-Fact analytics
- Draft & Confirm через Telegram (§8.2)
- Anomaly detection cron
- Category-based policies

**Deliverables:**
- 8 новых endpoints (transfers, reservations, recalculate, policies)
- 6 новых webhook events
- Scheduled function `runAnomalyDetection` (ежедневно 6am)
- Admin UI для category policies
- Telegram draft-confirm flows

**Acceptance:**
- [ ] End-to-end transfer test: worker A requests → manager approves → warehouse picks → driver dispatches → worker B handshakes. Все 5 events fired.
- [ ] Reservation conflict: 2 tasks на тот же stock → 2-й получает `reservation_conflict` event
- [ ] Anomaly detection: запуск на seed data с известным overrun → event `alert.inventory_anomaly` публикуется
- [ ] Draft-confirm в боте: задача с нормой → бот предлагает list → worker корректирует → commit
- [ ] Category policy: transfer 200м wire (над maxQty=100) → требует manager approve

**Effort:** 40-60 часов
**Dependencies:** Phase 1

---

### Phase 3 — Future (по запросу)

**Scope:**
- Physical inventory (cycle counts)
- Vendor management + Draft PO workflow
- Batch/serial number tracking
- Dead stock reports
- Multi-currency (если расширяемся)

**Deliverables per item:** отдельный sub-phase при бизнес-запросе.

**Effort:** 20-40 часов total (разбито по items).
**Dependencies:** Phase 2.

---

## 11. Acceptance Criteria (global)

Project считается "Inventory V3 launched" когда:

- [ ] Phase 0 в main, миграция на проде выполнена, мониторинг 48ч без инцидентов
- [ ] Phase 1 в main, один реальный бригадир использовал barcode scan (метрика в logs)
- [ ] SDK v0.2.0 на PyPI с inventory domain, 1 partner integration использует его
- [ ] Admin доволен UX (плюс: "удобнее чем раньше", минус: 0 новых багов в inventory)
- [ ] Нет инцидентов с расхождением остатков (нет вызовов `/recalculate` на проде)

---

## 12. Testing Strategy

### 12.1. Unit tests (per phase)

- **Phase 0:** `InventoryService.commitTransaction` — concurrency (2 parallel writes), atomicity (write fails mid-batch → rollback), idempotency (same tx twice → one write)
- **Phase 1:** RLS (пакет из rlsCrossTenant.test.ts), barcode handler (mock Gemini), SDK domain methods
- **Phase 2:** Transfer state machine, reservation conflict, anomaly detection, draft-confirm flow

### 12.2. Integration tests

- Firebase emulator: catalog → transaction → stock update → webhook fires
- End-to-end transfer workflow (5 state transitions)
- Migration dry-run vs actual vs rollback

### 12.3. Load test

- 1000 concurrent `commitTransaction` calls → data integrity preserved
- 10,000 catalog items → list/search P95 < 500ms

---

## 13. References & Predecessors

- **V2 spec:** [`WAREHOUSE_SPEC_V2.md`](./WAREHOUSE_SPEC_V2.md) — architectural source (846 строк, SPEC FREEZE v4)
- **V1 / warehouse task 2026-04-08:** `task-warehouse.md`, `nikita-warehouse-api-log.md`
- **Multi-agent spec:** MULTI_AGENT_SPEC.md — per-employee tokens / scopes
- **Use cases:** [`WAREHOUSE_USE_CASES.md`](./WAREHOUSE_USE_CASES.md) — 50 сценариев
- **SDK spec:** [`PYTHON_SDK_SPEC.md`](./PYTHON_SDK_SPEC.md) — inventory domain в Phase 2
- **RLS reference:** commit `ceb8464` — pattern для scoped queries
- **CLAUDE.md §2.1:** idempotency правила для триггеров (касается if/when добавляем inventory-триггер)

---

## 14. Implementation Notes

### 14.1. Как брать в работу

1. Убедиться что есть хотя бы один из 3 бизнес-сигналов (§2.3)
2. Прочитать §4 + §5 (архитектура и data model)
3. Начать с Phase 0 — не перепрыгивать, иначе две системы дуальностью продолжат дрейфовать
4. Writing out migration runbook ПЕРЕД кодом (`docs/runbooks/inventory-migration.md`)
5. PR per phase (P0/P1/P2/P3) в отдельных PR'ах — не мерджить все вместе

### 14.2. Deploy strategy

- Phase 0 требует deploy functions (CLAUDE.md §5)
- Миграция — запускается через admin-only script после functions deploy
- Мониторинг 48ч по `inventory.*` webhook events + firebase functions:log

### 14.3. Rollback plan

Per phase:
- **P0:** keep old collections parallel 2 weeks, `/recalculate` endpoint. Если аномалии — rollback migration script.
- **P1:** RLS можно снять через feature flag `INVENTORY_RLS_ENABLED`. SDK v0.1 остаётся (v0.2 опционально).
- **P2:** transfer workflow — feature flag `INVENTORY_TRANSFERS_ENABLED`. Reservations — отдельный flag.

---

## 15. Open Questions (для обсуждения с Денисом перед запуском)

1. **Кто owner** машины `Денис's Van` — сам Денис как employee-admin? Или это "без owner" (shared pool)?
2. **Pack Station concept** — нужен отдельный type of location где бот может писать без human approve (§6.1 V2)?
3. **Barcode policy** — какой формат штрихкодов поддерживаем (UPC/EAN/QR)? Или всё что Gemini распознает?
4. **Vendor integration** — есть ли список "наших поставщиков" (Home Depot, Lowe's, local)? Нужен ли на Phase 3?
5. **Fraud threshold** — какой % overrun считается "аномалией"? Start с 25% и $50 (§9.3) — регулируется per-category?
6. **Tool tracking** — треким ли `isTrackable: true` items по сессиям (кто взял, когда вернул)? Отдельный sub-flow?
