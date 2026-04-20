# ТЗ: Склад V2 — Agent-as-Copilot Unified Warehouse & Inventory System

> **Статус:** SPEC FREEZE v4 (Final)
> **Автор:** Денис + Claude Code
> **Дата:** 2026-04-12 (v4 — Architect Review + Spec Freeze)
> **Предшественники:** task-inventory.md, task-inventory-norms.md, nikita-warehouse-api-log.md, MULTI_AGENT_SPEC.md
> **Контекст:** Мульти-агентная инфра (10 phases) shipped — у каждого сотрудника свой AI-агент с персональным токеном, scopes, webhook, Telegram bridge, FCM push.

---

## 0. Главный принцип

### 🧭 Агент — это Co-pilot (штурман), а не Autopilot

Агент **предлагает**, человек **подтверждает**. Если агент начнёт делать всё за спиной человека, склад разъедется с реальностью за неделю.

**Правило:** Любая мутация склада, которая меняет остатки, проходит через подтверждение человека (кнопка в Telegram/PWA). Единственное исключение — write-off по нормативу через бота (Pack Station), где человек уже явно инициировал действие.

---

## 1. Проблема

### 1.1. Две параллельные системы

| | Simple (API) | Advanced (Frontend) |
|---|---|---|
| **Модель** | warehouse → items → transactions | catalog → transactions → locations → reservations |
| **Коллекции** | `warehouses`, `inventory_items`, `inventory_transactions` | `inventory_catalog`, `inventory_transactions_v2`, `inventory_locations` |
| **UI** | Нет своего UI, только API | `/crm/inventory` — полный UI с real-time |
| **Кто использует** | Agent API + Telegram бот (нормы Pack Station) | Веб-интерфейс |
| **Синхронизация** | ❌ Никакой | ❌ Никакой |

### 1.2. Агенты не знают «свой» склад

С мульти-агентной инфрой каждый сотрудник имеет AI-агента. Но текущий inventory API:
- **Нет scoped queries** — любой `inventory:read` видит ВСЕ склады (чужие машины, чужие объекты)
- **Нет привязки warehouse → employee** — бригадир не знает какая машина «его»
- **Нет inventory domain в Python SDK** — агенты не могут работать со складом программно
- **Webhook events бедные** — только `inventory.transaction` и `inventory.low_stock`

### 1.3. Реальность стройки vs идеальная архитектура

Физический мир **не идеален**:
- План *никогда* не равен факту (ошибся с резом, обходил трубу, сломал розетку)
- Машины ломаются, люди пересаживаются, материалы теряются в транзите
- Рабочие в 7 утра заезжают на склад сами — некогда ждать approval
- Закупщик не заказывает по одному мотку изоленты — нужна корзина

**Если архитектура не учитывает это — склад разъедется с реальностью за неделю.**

---

## 2. Цель V2: Agent-as-Copilot Warehouse

**Одна система данных. Каждый агент видит/делает только своё. Агент предлагает — человек решает.**

### 2.1. Ключевые user stories

| # | Роль | Что делает АГЕНТ | Что делает ЧЕЛОВЕК | Scopes |
|---|---|---|---|---|
| 1 | **Бригадир** | Готовит Proposed Issue (draft-списание) при завершении задачи. Показывает остатки своей машины. Запрашивает transfer при дефиците. | Подтверждает/корректирует фактический расход кнопкой. Чекинится в машину. | `inventory:write`, `inventory:transfer` |
| 2 | **Менеджер** | Мониторит остатки проектов. Получает transfer requests. Формирует plan vs fact. | Approve/reject transfers. Разрешает конфликты резервирования. | `inventory:read`, `inventory:write`, `inventory:approve` |
| 3 | **Закупщик** | Копит low-stock позиции в «корзину» по поставщикам. В 16:00 формирует один сводный Draft PO. | Просматривает корзину, корректирует, жмёт "Approve & Send". | `inventory:read`, `inventory:cost:purchase`, `erp:write` |
| 4 | **Владелец** | Видит капитализацию складов, weekly anomaly digest (cost-based formula). | Принимает решения по аномалиям. | `admin`, `inventory:cost:valuation` |
| 5 | **Кладовщик** | Сканирует barcode при выдаче. Подтверждает отправку в транзит. | Физически собирает и выдаёт. Жмёт "Отправлено". | `inventory:write` |

### 2.2. Принцип "Draft & Confirm" (Proposed Issue)

Любое auto-действие агента проходит по паттерну:

```
Событие (task.completed, low_stock, ...)
  ↓
Агент готовит ЧЕРНОВИК действия (draft write-off, draft PO, draft transfer)
  Черновик = транзакция со статусом 'draft' (НЕ committed)
  ↓
Агент показывает человеку в Telegram/PWA:
  "Подготовил X. Подтверждаешь?"
  [✅ Да, всё точно] / [✏️ Изменить]
  ↓
Человек подтверждает → статус 'committed' → Write Path выполняет транзакцию
Человек корректирует → агент обновляет draft → повторяет вопрос
```

**Никаких молчаливых мутаций склада.**

---

## 3. Архитектурные контракты (SPEC FREEZE)

### 3.1. Source of Truth & Materialized State

Запрещаем рассинхрон на уровне БД. Строгая модель:

- **Source of Truth (Write Path):** Только иммутабельные журналы `inventory_transactions_v2` (исторический факт) и `inventory_reservations` (будущий план). Это единственный источник правды о движениях и остатках.

- **Materialized State (Read Path):** Поля `stockByLocation`, `totalStock` и `availableStock` в коллекции `inventory_catalog` — это **исключительно кэшированные проекции**. Они вычисляются из транзакций.

- **Unified Write Path:** Ни один клиент, интерфейс или агент **не имеет права напрямую мутировать остатки**. Запрет на `PATCH /catalog/{id} { stock: 100 }`. Все движения проходят через единый слой `InventoryService.commitTransaction()`:

```typescript
class InventoryService {
  /**
   * Единственная точка входа для мутации остатков.
   * Никакой другой код не имеет права менять stock напрямую.
   */
  static async commitTransaction(tx: InventoryTransactionInput): Promise<string> {
    return db.runTransaction(async (t) => {
      // 1. Validate: check stock >= qty for outbound
      // 2. Write immutable log → inventory_transactions_v2
      // 3. Atomic increment → catalog.stockByLocation[locationId]
      //    via FieldValue.increment(-qty) or increment(+qty)
      // 4. Recalculate totalStock = sum(stockByLocation)
      // 5. Check minStock threshold → publish event if needed
      // ALL in one Firestore batch = atomicity guarantee
    });
  }
}
```

**Резервный механизм:** `POST /api/inventory/recalculate` — полный пересчёт остатков из журнала транзакций. Запускается при подозрении на рассинхрон. Admin-only.

### 3.2. Атомарность трансферов (Transfer Orchestration)

Трансфер — **единый оркестрируемый процесс**, не два разрозненных вызова.

Обязательные поля в `inventory_transactions_v2`:
```typescript
{
  transactionGroupId: string,    // UUID — связка transfer_out + transfer_in
  transferRequestId: string | null,  // ссылка на inventory_transfer_requests
}
```

**Логика:**
1. Кладовщик выдал → **атомарный Batch**: транзакция `transfer_out` со склада А + status `in_transit` на transfer request. Товар виртуально "в пути" (списан с А, не зачислен на Б).
2. Получатель жмёт "Принял" (Handshake) → транзакция `transfer_in` с тем же `transactionGroupId` + status `completed`.
3. **Stale transit alert:** Если есть `transfer_out` без парного `transfer_in` > 24 часов → `alert.stale_transit` event → Manager.
4. **Idempotency и rollback** работают по `transactionGroupId` — можно найти все части трансфера.

### 3.3. Frozen Event Dictionary

Строгий нейминг событий. Все агенты и webhooks используют ТОЛЬКО эти ключи:

| Event Key (immutable) | Trigger | Target |
|---|---|---|
| `inventory.low_stock` | stock < minStock after commit | Manager, Purchaser |
| `inventory.critical_stock` | stock < minStock × 0.25 | Owner, Manager, Purchaser |
| `inventory.transfer_requested` | Worker creates transfer request | Manager |
| `inventory.transfer_approved` | Manager/auto approves | Warehouse staff |
| `inventory.transfer_picked` | Warehouse staff picked items | Requesting worker |
| `inventory.transfer_in_transit` | Shipment dispatched | Receiving worker |
| `inventory.transfer_delivered` | Driver arrived | Receiving worker |
| `inventory.transfer_completed` | Receiver confirmed (handshake) | Manager (audit) |
| `inventory.self_checkout` | Worker took items directly | Manager (post-factum FYI) |
| `inventory.draft_writeoff_pending` | Agent created draft | Worker (confirm prompt) |
| `inventory.draft_writeoff_expired` | 24h no response | Manager |
| `inventory.po_auto_created` | Supplier cart → Draft PO | Manager, Purchaser |
| `inventory.reservation_conflict` | 2 tasks claim same stock | Manager |
| `alert.inventory_anomaly` | Fact > Plan×multiplier AND overrun > $threshold | Owner |
| `alert.stale_transit` | transfer_out without transfer_in > 24h | Manager |

**Контракт:** Добавление нового event key требует обновления этой таблицы И OpenAPI spec. Агенты не должны подписываться на несуществующие ключи.

### 3.4. Category-Based Policies (вместо глобальных лимитов)

Глобальные пороги ("$150 на всё") заменяются конфигурацией **по категориям материалов**:

```typescript
// Коллекция: inventory_category_policies/{categoryId}
interface CategoryPolicy {
  categoryId: string;        // e.g. 'wire', 'tools', 'fasteners', 'smart_devices'
  displayName: string;
  
  autoApproveTransfer: {
    maxQty: number;          // макс штук/метров для auto-approve
    maxUsdValue: number;     // макс $ стоимость для auto-approve
  };
  
  anomalyDetection: {
    multiplier: number;      // e.g. 1.3 (Fact > Plan × 1.3)
    minUsdVariance: number;  // e.g. $50 (минимальный $ перерасход для алерта)
  };
}
```

**Правило трансфера:**
```
IF (qty <= policy.autoApproveTransfer.maxQty)
  AND (estimatedCost <= policy.autoApproveTransfer.maxUsdValue)
  AND (urgency != 'critical')
THEN auto_approve
ELSE → FCM push to Manager
```

**Правило аномалии:**
```
IF (actualCost >= plannedCost × policy.anomalyDetection.multiplier)
  AND (actualCost - plannedCost >= policy.anomalyDetection.minUsdVariance)
THEN inventory.anomaly_detected event
```

**Примеры дефолтных политик:**

| Category | Auto-Approve Transfer | Anomaly Threshold |
|---|---|---|
| `fasteners` (саморезы, стяжки) | 1000 pcs / $50 | ×2.0, > $100 |
| `wire` (кабель) | 500 ft / $200 | ×1.3, > $50 |
| `tools` (инструмент) | 5 pcs / $150 | ×1.2, > $30 |
| `smart_devices` (реле, диммеры) | 10 pcs / $100 | ×1.1, > $20 |
| `panels` (щитки) | 2 pcs / $300 | ×1.2, > $100 |

---

## 4. Что уже работает (не ломать)

### 4.1. Backend API (18 endpoints, production)

| # | Endpoint | Скоупы | Статус |
|---|---|---|---|
| 1-5 | Warehouses CRUD + archive | `inventory:read/write` | ✅ prod |
| 6-9 | Items CRUD + list | `inventory:read/write` | ✅ prod |
| 10-12 | Transactions (in/out/transfer) + task bulk + list | `inventory:write` | ✅ prod |
| 13-16 | Norms CRUD + write-off-by-norm | `inventory:read/write` | ✅ prod |
| 17 | Search (Fuse.js) | `inventory:read` | ✅ prod |
| 18 | Dashboard + alerts | `inventory:read` | ✅ prod |

**Не трогать:** логику write-off-by-norm (11 Pack Stations = 88 транзакций в проде).

### 4.2. Мульти-агентная инфра (shipped)

| Компонент | Статус | Как использует inventory |
|---|---|---|
| Per-employee tokens | ✅ | `inventory:read`, `inventory:write` scopes |
| RBAC scope enforcement | ✅ | `requireScope('inventory:write')` на мутациях |
| Event queue | ✅ | `publishInventoryEvent()` → agent_events |
| Webhooks | ✅ | `inventory.*` pattern matching |
| Telegram bridge | ✅ | `notifyViaTelegram()` на inventory events |
| FCM push | ✅ | Push на PWA при inventory events |
| Python SDK | ⚠️ | **Нет inventory domain** — нужно добавить |

---

## 5. Data Model (Spec Freeze)

### 5.1. Коллекции

```
inventory_catalog/{id}                ← единый каталог материалов
  ├── name: string
  ├── sku: string                      ← каноничный внутренний ключ (e.g. 'WIRE-12AWG')
  ├── barcodes: string[]               ← массив aliases (UPC, EAN-13, internal QR)
  ├── category: string                 ← ключ из inventory_category_policies
  ├── unit: string
  ├── stockByLocation: { [locationId]: number }    ← MATERIALIZED (read-only projection)
  ├── totalStock: number               ← MATERIALIZED = sum(stockByLocation)
  ├── availableStock: number           ← MATERIALIZED = totalStock - reserved
  ├── avgPrice: number                 ← видно только с inventory:cost:purchase
  ├── minStock: number                 ← порог для alert
  ├── photoUrl: string | null
  └── suppliers: string[]

inventory_locations/{id}              ← warehouse / vehicle / jobsite
  ├── name, type: 'physical' | 'vehicle' | 'jobsite'
  ├── address, licensePlate (vehicle)
  ├── clientId, projectId
  ├── active: boolean
  ├── selfCheckoutEnabled: boolean     ← только для физических складов
  ├── assignedTo: string[]             ← STATIC: для физических складов
  ├── checkedInBy: string | null       ← DYNAMIC: для машин (обнуляется в полночь)
  ├── checkedInAt: Timestamp | null
  └── responsibleManagerId: string

inventory_transactions_v2/{id}        ← IMMUTABLE журнал (Source of Truth)
  ├── catalogItemId, locationId
  ├── type: 'purchase' | 'write_off' | 'transfer_out' | 'transfer_in'
  │         | 'adjustment' | 'return' | 'reservation_issue' | 'reservation_return'
  │         | 'self_checkout'
  ├── quantity, unitPrice              ← unitPrice видно только с inventory:cost:purchase
  ├── quantityBefore, quantityAfter
  ├── relatedTaskId, relatedNormId
  ├── transactionGroupId: string       ← UUID для связки transfer_out/in пары
  ├── transferRequestId: string | null ← ссылка на transfer request
  ├── requestedByAgentTokenId
  ├── confirmedByEmployeeId            ← кто подтвердил (Draft & Confirm)
  ├── toLocationId (для transfer)
  └── performedBy, source: 'api' | 'bot' | 'agent' | 'trigger' | 'self_checkout'

inventory_norms/{id}                  ← нормативы (без изменений)

inventory_reservations/{id}
  ├── catalogItemId, locationId
  ├── quantity, status: 'planned' | 'reserved' | 'issued' | 'returned' | 'cancelled'
  ├── taskId, projectId
  ├── requestedByEmployeeId
  └── approvedByEmployeeId

inventory_transfer_requests/{id}
  ├── fromLocationId, toLocationId
  ├── items: [{ catalogItemId, quantity }]
  ├── status: 'pending' | 'approved' | 'picking' | 'in_transit' | 'delivered' | 'completed' | 'rejected'
  ├── transactionGroupId: string       ← связка с парой транзакций
  ├── requestedByEmployeeId
  ├── approvedByEmployeeId
  ├── pickedByEmployeeId
  ├── receivedByEmployeeId             ← handshake
  ├── reason, urgency
  └── estimatedCost: number            ← для Category Policy auto-approve

inventory_supplier_cart/{supplierId}
  ├── supplierId, supplierName
  ├── items: [{ catalogItemId, name, quantity, estimatedUnitPrice, triggeredByEventId }]
  ├── estimatedTotal: number
  ├── autoSubmitAt: Timestamp          ← 16:00 или при сумме по policy
  ├── status: 'collecting' | 'ready' | 'submitted' | 'ordered'
  └── lastUpdatedAt

inventory_draft_writeoffs/{id}        ← Proposed Issue черновики
  ├── taskId, locationId
  ├── items: [{ catalogItemId, plannedQty, actualQty (null = pending) }]
  ├── status: 'pending_confirmation' | 'confirmed' | 'expired'
  ├── proposedByAgentTokenId
  ├── confirmedByEmployeeId
  ├── telegramMessageId
  └── expiresAt: Timestamp             ← 24h

inventory_category_policies/{categoryId}   ← Category-Based Policies
  ├── categoryId, displayName
  ├── autoApproveTransfer: { maxQty, maxUsdValue }
  └── anomalyDetection: { multiplier, minUsdVariance }
```

### 5.2. Привязка локаций: Static + Dynamic Check-in

**Физические склады** — жёсткая привязка (`assignedTo[]`).

**Машины (vehicle)** — динамический чекин:

```
Утро. Вася → QR на торпеде Van-012 ИЛИ боту: "Я на Van-012"
  → POST /api/inventory/locations/:id/check-in
  → checkedInBy = vasya_uid, checkedInAt = now()
  → Предыдущий checkedInBy сбрасывается
  → Midnight cron: обнуляет все checkedInBy
```

### 5.3. Миграция данных

```
1. inventory_items → inventory_catalog
   - barcode (string) → barcodes: [barcode]  (обернуть в массив)
   - Добавить sku: сгенерировать из name + category (WIRE-12AWG)
   - stockByLocation: { [warehouseId]: quantity }
   - totalStock, availableStock: вычислить

2. warehouses → inventory_locations
   - type = licensePlate ? 'vehicle' : 'physical'
   - assignedTo: из employee profiles
   - checkedInBy: null

3. inventory_transactions → inventory_transactions_v2
   - source: 'api'
   - transactionGroupId: generate UUID per existing transfer pair
   - confirmedByEmployeeId: performedBy

4. Создать дефолтные inventory_category_policies для 5 категорий

5. Старые коллекции read-only 60 дней → proxy-адаптеры
```

---

## 6. API Endpoints

### 6.1. Catalog & Locations (v2)

| Endpoint | Метод | Описание | Scope |
|---|---|---|---|
| `GET /api/inventory/catalog` | GET | Каталог (scoped; без cost scope — цены hidden) | `inventory:read` |
| `GET /api/inventory/catalog/:id` | GET | Детали + transaction history | `inventory:read` |
| `POST /api/inventory/catalog` | POST | Создать материал | `inventory:admin` |
| `PATCH /api/inventory/catalog/:id` | PATCH | Обновить (NOT stock!) | `inventory:admin` |
| `GET /api/inventory/locations` | GET | Локации (scoped) | `inventory:read` |
| `GET /api/inventory/my-locations` | GET | Мои (shortcut) | `inventory:read` |
| `POST /api/inventory/locations/:id/check-in` | POST | Чекин в машину | `inventory:write` |
| `POST /api/inventory/locations/:id/check-out` | POST | Выход из машины | `inventory:write` |
| `GET /api/inventory/stock-report` | GET | Сводка (scoped) | `inventory:read` |
| `POST /api/inventory/recalculate` | POST | Пересчёт из журнала | `inventory:admin` |

### 6.2. Transactions (через Unified Write Path)

| Endpoint | Метод | Описание | Scope |
|---|---|---|---|
| `POST /api/inventory/transactions` | POST | Commit transaction (all types) | `inventory:write` |
| `POST /api/inventory/transactions/task` | POST | Bulk issue for task | `inventory:write` |
| `POST /api/inventory/transactions/self-checkout` | POST | Grab & Go (post-factum alert) | `inventory:write` |
| `GET /api/inventory/transactions` | GET | History (scoped, paginated) | `inventory:read` |

### 6.3. Draft Write-Offs (Proposed Issue)

| Endpoint | Метод | Описание | Scope |
|---|---|---|---|
| `POST /api/inventory/draft-writeoffs` | POST | Create draft (agent) | `inventory:write` |
| `GET /api/inventory/draft-writeoffs` | GET | My pending drafts | `inventory:read` |
| `PATCH /api/inventory/draft-writeoffs/:id/confirm` | PATCH | Confirm (with optional actualQty) | `inventory:write` |
| `DELETE /api/inventory/draft-writeoffs/:id` | DELETE | Reject draft | `inventory:write` |

### 6.4. Transfer Requests

| Endpoint | Метод | Описание | Scope |
|---|---|---|---|
| `POST /api/inventory/transfer-requests` | POST | Create request | `inventory:transfer` |
| `GET /api/inventory/transfer-requests` | GET | List (scoped) | `inventory:read` |
| `POST /api/inventory/transfer-requests/:id/approve` | POST | Approve | `inventory:approve` |
| `POST /api/inventory/transfer-requests/:id/reject` | POST | Reject | `inventory:approve` |
| `POST /api/inventory/transfer-requests/:id/pick` | POST | Mark as picked | `inventory:write` |
| `POST /api/inventory/transfer-requests/:id/ship` | POST | Mark in transit | `inventory:write` |
| `POST /api/inventory/transfer-requests/:id/deliver` | POST | Mark delivered | `inventory:write` |
| `POST /api/inventory/transfer-requests/:id/confirm-receipt` | POST | Handshake: "Принял" | `inventory:write` |

### 6.5. Supplier Cart & Category Policies

| Endpoint | Метод | Описание | Scope |
|---|---|---|---|
| `GET /api/inventory/supplier-carts` | GET | All active carts | `inventory:read`, `erp:read` |
| `GET /api/inventory/supplier-carts/:supplierId` | GET | One cart | `inventory:read` |
| `POST /api/inventory/supplier-carts/:supplierId/submit` | POST | Cart → Draft PO | `erp:write` |
| `GET /api/inventory/category-policies` | GET | All policies | `inventory:read` |
| `PATCH /api/inventory/category-policies/:id` | PATCH | Update policy | `inventory:admin` |

### 6.6. Proxy-Adapters (backward compat, 60 days)

Старые endpoints (warehouses, items) принимают старый payload, конвертируют в V2-схему под капотом, отдают старый формат ответа. Боты Pack Station продолжают работать.

---

## 7. Workflows

### 7.1. Task Complete → Proposed Issue → Confirm

```
task.completed event → Worker agent webhook
  ↓
Agent reads task.plannedMaterials
  ↓
POST /api/inventory/draft-writeoffs
  items: [{ catalogItemId: wire, plannedQty: 50 }, ...]
  status: 'pending_confirmation', expiresAt: +24h
  ↓
Telegram to Vasya:
  🤖 "Задача #456 завершена. Списание по плану:
   • Кабель 12 AWG — 50м
   • Розетки — 4шт
   [✅ Подтвердить] [✏️ Скорректировать]"
  ↓
[✅] → PATCH /draft-writeoffs/:id/confirm
  → InventoryService.commitTransaction() for each item
  → Materialized stock updated atomically
  ↓
[✏️] → Bot: "Введи факт: кабель, розетки"
  → "60, 4" → confirm with actualQty overrides
  ↓
No response 24h → status: 'expired'
  → inventory.draft_writeoff_expired → Manager alert
```

### 7.2. Atomic Transfer with Handshake

```
Worker agent: deficit detected
  → POST /api/inventory/transfer-requests
    { from: main, to: van_012, items: [...], estimatedCost: $120 }
  ↓
Category Policy check: wire $120 < maxUsdValue $200
  → AUTO-APPROVE (Manager gets FYI notification)
  ↓
Warehouse staff: "Собрать: Wire 150ft"
  → POST /transfer-requests/:id/pick → status: 'picking'
  ↓
Staff done → POST /transfer-requests/:id/ship
  → ATOMIC BATCH:
    1. inventory_transactions_v2 += transfer_out (transactionGroupId: UUID-abc)
    2. catalog.stockByLocation[main] -= 150
    3. transfer_request.status = 'in_transit'
  → inventory.transfer_in_transit event → Worker
  ↓
Driver arrives → POST /transfer-requests/:id/deliver
  → inventory.transfer_delivered → Worker: "Подтвердите"
  ↓
Worker: POST /transfer-requests/:id/confirm-receipt
  → ATOMIC BATCH:
    1. inventory_transactions_v2 += transfer_in (transactionGroupId: UUID-abc)
    2. catalog.stockByLocation[van_012] += 150
    3. transfer_request.status = 'completed'
  ↓
24h stale check (cron): out without in → alert.stale_transit → Manager
```

### 7.3. Self-Checkout (Grab & Go)

```
Vasya at warehouse 7am → scan barcode → select qty
  → POST /api/inventory/transactions/self-checkout
    { locationId: main, catalogItemId: wire, qty: 200 }
  → InventoryService.commitTransaction() IMMEDIATELY
  → inventory.self_checkout event → Manager (FYI, no approval)
```

### 7.4. Supplier Cart Accumulation

```
inventory.low_stock (tape, Home Depot)     → cart += tape
inventory.low_stock (wire, Home Depot)     → cart += wire
inventory.low_stock (boxes, Grainger)      → separate cart
...throughout the day...
  ↓
Trigger: 16:00 OR estimatedTotal > policy threshold
  ↓
Purchaser agent: "🛒 Home Depot: 8 items, ~$520. Approve?"
  ↓
Purchaser reviews, adjusts quantities
  → POST /supplier-carts/home-depot/submit → Draft PO
  ↓
Manager: [Approve & Send] → PO ordered
```

---

## 8. Scopes (гранулярные, FROZEN)

| Scope | Описание | Кому |
|---|---|---|
| `inventory:read` | Каталог, остатки в штуках (scoped по локациям) | Все |
| `inventory:write` | Транзакции, draft write-off, self-checkout | Worker + Manager |
| `inventory:transfer` | Создавать transfer requests | Worker + Manager |
| `inventory:approve` | Approve transfers, approve PO drafts | Manager only |
| `inventory:admin` | Manage locations, recalculate, norms, catalog CRUD, policies | Admin/Owner |
| `inventory:cost:purchase` | Видеть **закупочные цены** за единицу (для формирования PO) | Purchaser ONLY |
| `inventory:cost:valuation` | Видеть **капитализацию складов** в дашборде (общая стоимость) | Owner/Investor ONLY |

**Контракт:**
- `inventory:write` implies `inventory:transfer`
- `admin` implies all
- Рабочие **НИКОГДА** не видят цены (ни purchase, ни valuation)
- Два уровня cost-видимости: закупщик видит unit prices, владелец видит total valuation

---

## 9. Visibility Matrix

| Фича | Owner | Manager | Worker | Purchaser | Client Portal |
|---|---|---|---|---|---|
| Все локации | ✅ all | ✅ responsible | ⚠️ assigned/checkedIn | ✅ all (read) | ❌ |
| Остатки (штуки) | ✅ | ✅ project-scoped | ⚠️ my location | ✅ | ❌ |
| Закупочные цены | ❌ (видит valuation) | ❌ | ❌ **НИКОГДА** | ✅ `cost:purchase` | ❌ |
| Капитализация складов | ✅ `cost:valuation` | ❌ | ❌ | ❌ | ❌ |
| Draft write-off | ✅ | ✅ (expired alerts) | ✅ confirm own | ❌ | ❌ |
| Self-checkout | ✅ | ✅ post-factum | ✅ do | ❌ | ❌ |
| Transfer request | ✅ | ✅ approve | ✅ create + handshake | ❌ | ❌ |
| Supplier cart | ✅ | ❌ | ❌ | ✅ manage | ❌ |
| Plan vs Fact | ✅ | ✅ | ❌ | ❌ | ❌ |
| Anomaly digest | ✅ | ✅ | ❌ | ❌ | ❌ |
| Category policies | ✅ edit | ✅ view | ❌ | ✅ view | ❌ |

---

## 10. Agent Event Subscriptions

| Role | webhookEvents | Why |
|---|---|---|
| **Worker** | `['task.assigned', 'task.completed', 'inventory.transfer_delivered', 'inventory.draft_writeoff_pending']` | Confirm drafts, receipt handshake |
| **Manager** | `['inventory.*', 'erp.po_*', 'task.completed', 'alert.*']` | Full visibility + approvals |
| **Purchaser** | `['inventory.low_stock', 'inventory.critical_stock']` | Supplier cart accumulation |
| **Owner** | `['alert.inventory_anomaly', 'alert.budget_warning', 'inventory.critical_stock', 'alert.stale_transit']` | High-level oversight |
| **Кладовщик** | `['inventory.transfer_approved']` | Start picking |

---

## 11. Безопасность

- **Unified Write Path** — никто не мутирует stock напрямую, только через `InventoryService.commitTransaction()`
- **Materialized views** — stockByLocation / totalStock / availableStock = read-only projections
- **`inventory:cost:purchase` / `cost:valuation` изоляция** — рабочие НИКОГДА не видят деньги
- **Token audit** — `requestedByAgentTokenId` + `confirmedByEmployeeId` на каждой транзакции
- **Draft & Confirm** — никаких молчаливых мутаций
- **Auto-suggestions default OFF** — opt-in per token, включать по одному сотруднику
- **Category-Based Policies** — пороги per-category, не глобальные
- **PO: ВСЕГДА ручной approve** — AI не тратит деньги без клика
- **Atomic transfers** — `transactionGroupId` связывает out/in пару
- **Stale transit alert** — 24h без handshake → alert
- **Self-checkout post-factum** — менеджер видит все
- **Rate limits** — 5 inventory mutations/min per agent
- **Daily limits** — 50 confirmed write-offs/day, 10 PO/day per agent
- **Midnight cron** — reset vehicle checkins
- **Token revocation** → pending drafts expire, pending transfers cancel
- **Межагентная связь ТОЛЬКО через Event Queue** — никакого P2P. Events = Audit Trail. 100% replay-тестирование. Безопасный revoke при увольнении.

---

## 12. Development Roadmap (4 Epics)

### Epic 1: Foundation & Proxy (~30h)

Схема каталога, транзакций и категорий. Unified Write Path. Proxy-адаптеры.

- [ ] Data model: `inventory_catalog`, `inventory_locations`, `inventory_transactions_v2`, `inventory_category_policies`
- [ ] `InventoryService.commitTransaction()` — единая точка мутации с Firestore Batch
- [ ] `POST /api/inventory/recalculate` — full rebuild from transaction log
- [ ] Migration script: items → catalog, warehouses → locations, transactions → v2
- [ ] Proxy-адаптеры для старых endpoints (60-day deprecation timer)
- [ ] `barcodes: string[]` + `sku` canonical key
- [ ] Default category policies for 5 categories
- [ ] 0 regression на Pack Station write-off-by-norm
- [ ] Unit tests for InventoryService (atomicity, concurrent writes, insufficient stock)

### Epic 2: Context & Access (~20h)

Привязка assignedTo, dynamic check-in, scoped queries, granular scopes.

- [ ] `assignedTo[]` (static) + `checkedInBy` (dynamic) на locations
- [ ] `POST /locations/:id/check-in` + `check-out`
- [ ] Midnight cron: reset all `checkedInBy`
- [ ] Scoped query builder: worker sees assigned+checkedIn, manager sees responsible, admin sees all
- [ ] `GET /my-locations` shortcut
- [ ] Granular scopes: `inventory:transfer`, `inventory:approve`, `inventory:admin`, `inventory:cost:purchase`, `inventory:cost:valuation`
- [ ] Price hiding: responses без cost scope strip `avgPrice`, `unitPrice`, `estimatedCost`
- [ ] `selfCheckoutEnabled` flag on locations
- [ ] Integration tests for scope isolation (worker can't see other's vehicles)

### Epic 3: Core Workflows (~28h)

Atomic transfers, Draft & Confirm, self-checkout, supplier cart.

- [ ] Transfer request CRUD with full status pipeline (pending → ... → completed)
- [ ] `transactionGroupId` linking transfer_out/in pairs
- [ ] Atomic Batch: ship = transfer_out + status update in one batch
- [ ] Atomic Batch: confirm-receipt = transfer_in + status completed
- [ ] Stale transit cron: out without in > 24h → `alert.stale_transit`
- [ ] Draft write-off CRUD + Telegram inline buttons [✅] [✏️]
- [ ] actualQty override flow
- [ ] 24h expiry cron + `inventory.draft_writeoff_expired` event
- [ ] Self-checkout endpoint + `inventory.self_checkout` event (post-factum)
- [ ] Supplier cart: accumulate from low_stock events
- [ ] Cart trigger: 16:00 cron OR estimatedTotal threshold
- [ ] Cart → Draft PO submission
- [ ] All 15 frozen events wired to publishEvent()

### Epic 4: Agent Policies & SDK (~24h)

Category policies engine, Python SDK inventory domain, auto-suggestions.

- [ ] Category policy evaluation engine (transfer approve + anomaly detection)
- [ ] `autoSuggestions` config on agent_tokens (ALL default OFF)
- [ ] Suggest write-off on task.completed (create draft, not execute)
- [ ] Suggest transfer on task.assigned with deficit
- [ ] Weekly anomaly digest (batched, not per-event)
- [ ] Python SDK `InventoryDomain` (25+ methods)
- [ ] Pydantic models for all entities
- [ ] CLI: `psa inventory check-in`, `scan`, `confirm-writeoff`, `approve-transfer`
- [ ] 20+ SDK unit tests
- [ ] OpenAPI spec update for all new endpoints

---

## 13. Firestore Indexes

```json
[
  {
    "collectionGroup": "inventory_catalog",
    "fields": [
      { "fieldPath": "category", "order": "ASCENDING" },
      { "fieldPath": "totalStock", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_locations",
    "fields": [
      { "fieldPath": "assignedTo", "arrayConfig": "CONTAINS" },
      { "fieldPath": "active", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_locations",
    "fields": [
      { "fieldPath": "checkedInBy", "order": "ASCENDING" },
      { "fieldPath": "active", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_locations",
    "fields": [
      { "fieldPath": "responsibleManagerId", "order": "ASCENDING" },
      { "fieldPath": "active", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_transactions_v2",
    "fields": [
      { "fieldPath": "catalogItemId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_transactions_v2",
    "fields": [
      { "fieldPath": "locationId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_transactions_v2",
    "fields": [
      { "fieldPath": "transactionGroupId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_transfer_requests",
    "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_reservations",
    "fields": [
      { "fieldPath": "projectId", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_draft_writeoffs",
    "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "expiresAt", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "inventory_supplier_cart",
    "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "autoSubmitAt", "order": "ASCENDING" }
    ]
  }
]
```

---

## 14. Sequence Diagrams

### 14.1. Task Complete → Proposed Issue → Confirm

```
Vasya (Telegram)    Vasya Agent       CRM API           Manager Agent
     |                 |                 |                    |
     |-- "done task"-->|                 |                    |
     |                 |-- task.complete->|                    |
     |                 |<--webhook-------|                    |
     |                 |                 |                    |
     |                 |-- POST draft-   |                    |
     |                 |   writeoffs --->|                    |
     |                 |                 |                    |
     |<--"Списание:    |                 |                    |
     |   Wire 50m,     |                 |                    |
     |   Outlets 4pcs  |                 |                    |
     |   [✅][✏️]"------|                 |                    |
     |                 |                 |                    |
     |--[✏️ Edit]----->|                 |                    |
     |<--"Введи факт"--|                 |                    |
     |--"60,4,1"------>|                 |                    |
     |                 |-- PATCH confirm>|                    |
     |                 |                 |--commitTransaction--|
     |                 |                 |  (Unified Write    |
     |                 |                 |   Path, atomic)    |
     |<--"Списано ✅"---|                 |                    |
```

### 14.2. Atomic Transfer with Handshake + Stale Alert

```
Vasya Agent       CRM API          Manager      Warehouse    Vasya        Cron
    |                |                |              |           |           |
    |-- POST transfer|                |              |           |           |
    |   ($120) ----->|                |              |           |           |
    |                |                |              |           |           |
    |                | CategoryPolicy:|              |           |           |
    |                | wire $120<$200 |              |           |           |
    |                | AUTO-APPROVE   |              |           |           |
    |                |--FYI---------->|              |           |           |
    |                |--approved----->|------------->|           |           |
    |                |                |              |           |           |
    |                |<--POST /pick---|--------------|           |           |
    |                |                |              |           |           |
    |                |<--POST /ship---|              |           |           |
    |                | ATOMIC BATCH:  |              |           |           |
    |                | tx: out -150   |              |           |           |
    |                | status:transit |              |           |           |
    |                |--in_transit--->|------------->|---------->|           |
    |                |                |              |           |           |
    |                |<--POST /confirm-receipt-----------------------|           |
    |                | ATOMIC BATCH:  |              |           |           |
    |                | tx: in +150    |              |           |           |
    |                | status:done    |              |           |           |
    |                |                |              |           |           |
    |                |                |              |        24h|no confirm?|
    |                |                |              |           |     ----->|
    |                |                |              |           |  stale    |
    |                |                |<-alert.stale_transit-----|-----------|
```

### 14.3. Supplier Cart (Batch, not Spam)

```
Events              Purchaser Agent      CRM API            Manager
  |                      |                 |                    |
  |--low_stock: tape---->|  add to cart    |                    |
  |--low_stock: wire---->|  Home Depot---->|                    |
  |--low_stock: boxes--->|  Grainger------>|                    |
  ...(throughout day)... |                 |                    |
  |                      |                 |                    |
  ...(16:00 trigger)...  |                 |                    |
  |                      |--"🛒 HD: 5 items                    |
  |                      |   ~$520"------->|--FCM push--------->|
  |                      |                 |<--"Approved"-------|
  |                      |<--Draft PO------|                    |
```

---

## 15. Frozen Decisions (бывший Open Questions — все LOCKED)

| # | Вопрос | Решение | Статус |
|---|---|---|---|
| 1 | Модель унификации | **Hard migration, catalog-based.** Proxy-адаптеры для старых ботов 60 дней. | 🔒 LOCKED |
| 2 | Auto-PO | **ТОЛЬКО Draft + Manager Approval.** AI не тратит деньги без клика. | 🔒 LOCKED |
| 3 | Barcode | **`sku` (canonical key) + `barcodes: string[]` (aliases array).** Fuse.js ищет по массиву. | 🔒 LOCKED |
| 4 | Deprecated endpoints | **60 дней** proxy-адаптеры, потом archive. | 🔒 LOCKED |
| 5 | Auto-approve threshold | **Category-Based Policies** (per-category maxQty + maxUsdValue), не глобальный порог. | 🔒 LOCKED |
| 6 | Anomaly formula | **Per-category:** `Fact > Plan × multiplier AND overrun > minUsdVariance`. Default: ×1.3 / $50. | 🔒 LOCKED |
| 7 | Auto-actions default | **СТРОГО OFF (opt-in).** Включать по одному лучшему сотруднику. | 🔒 LOCKED |
| 8 | Granular scopes | **ДА.** `inventory:cost` разделён на `:purchase` (закупщик) и `:valuation` (владелец). | 🔒 LOCKED |
| 9 | Driver role | **Нет отдельной роли.** Машина = транзитный склад. Pick-up / Drop-off events. | 🔒 LOCKED |
| 10 | Межагентная связь | **Только Event Queue.** Никакого P2P. 100% audit trail + replay testing. | 🔒 LOCKED |
| 11 | Daily limits | **50 write-offs + 10 PO/day + 5 mutations/min rate limit.** | 🔒 LOCKED |
