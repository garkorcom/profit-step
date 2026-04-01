# Profit Step CRM — API Reference

> Полная документация по REST API для интеграции с CRM Profit Step.
> Сверена с исходным кодом `functions/src/agent/agentApi.ts` (3923 строки, 40+ эндпоинтов).

---

## Содержание

- [Авторизация](#-авторизация)
- [Rate Limiting](#-rate-limiting)
- [Идемпотентность](#-идемпотентность)
- [Коды ошибок](#-коды-ошибок)
- **Эндпоинты:**
  - [Клиенты (Clients)](#1-клиенты-clients)
  - [Задачи (GTD Tasks)](#2-задачи-gtd-tasks)
  - [Расходы (Costs)](#3-расходы-costs)
  - [Трекинг времени (Time Tracking)](#4-трекинг-времени-time-tracking)
  - [Статус проектов](#5-статус-проектов)
  - [Пользователи (Users)](#6-пользователи-users)
  - [Контакты (Contacts)](#7-контакты-contacts)
  - [Сметы (Estimates)](#8-сметы-estimates)
  - [Проекты (Projects)](#9-проекты-projects)
  - [Файлы проектов (Files)](#10-файлы-проектов-files)
  - [Blueprint Split](#11-blueprint-split)
  - [Blackboard](#12-blackboard)
  - [Sites (Объекты)](#13-sites-объекты)
  - [Финансы (Finance)](#14-финансы-finance)
  - [Change Orders](#15-change-orders)
  - [Purchase Orders](#16-purchase-orders)
  - [Plan vs Fact](#17-plan-vs-fact)

---

## 🔐 Авторизация

Все запросы требуют заголовок `Authorization`:

```http
Authorization: Bearer <TOKEN>
```

| Тип токена | Когда использовать |
|---|---|
| **Static API Key** (`AGENT_API_KEY` из env) | Серверные вызовы, боты, OpenClaw |
| **Firebase Auth JWT** | Браузерные сессии, веб-клиент |

При Static API Key — `userId` и `userName` берутся из env-переменных `OWNER_UID` / `OWNER_DISPLAY_NAME`.

---

## 🛡️ Rate Limiting

- **60 запросов в минуту** на один `userId`
- При превышении: `HTTP 429` с телом `{ "error": "Rate limit exceeded", "retryAfterMs": <число> }`
- Счётчик сбрасывается автоматически через 60 секунд

---

## 🔁 Идемпотентность

Эндпоинты `POST /api/clients`, `POST /api/gtd-tasks`, `POST /api/costs`, `POST /api/estimates`, `POST /api/change-orders`, `POST /api/purchase-orders` принимают опциональный `idempotencyKey`.

- Ключ кешируется **24 часа**
- Повторный запрос с тем же ключом вернёт `200` + ID существующей записи + `"deduplicated": true`
- Рекомендуется UUID v4

---

## ❌ Коды ошибок

| Код | Значение | Тело ответа |
|---|---|---|
| `400` | Ошибка валидации (Zod) | `{ "error": "Validation failed", "details": [{ "field": "...", "message": "..." }] }` |
| `401` | Нет/невалидный токен | `{ "error": "Missing/Invalid authorization token" }` |
| `403` | Нет прав (только OWNER) | `{ "error": "Только владелец может..." }` |
| `404` | Сущность не найдена | `{ "error": "... не найден(а)" }` |
| `409` | Конфликт (уже конвертировано и т.д.) | `{ "error": "...", "taskId": "..." }` |
| `429` | Rate limit | `{ "error": "Rate limit exceeded" }` |
| `500` | Внутренняя ошибка | `{ "error": "Internal server error" }` |

---

## 1. Клиенты (Clients)

### `POST /api/clients` — Создание клиента

**Request:**
```json
{
  "name": "Steve Jobs LLC",
  "address": "1 Infinite Loop, CA",
  "contactPerson": "Tim Cook",
  "phone": "+1-555-000-0000",
  "email": "tim@apple.com",
  "notes": "VIP клиент",
  "type": "commercial",
  "company": "Apple Inc",
  "geo": { "lat": 37.33, "lng": -122.03 },
  "idempotencyKey": "uuid-v4-here"
}
```
Обязательные: `name`. Остальное опционально. `type`: `residential | commercial | industrial`.

**Response `201`:**
```json
{ "clientId": "abc123", "name": "Steve Jobs LLC" }
```

---

### `PATCH /api/clients/:id` — Обновление клиента

Частичное обновление. Принимает любые поля из `POST`, плюс:

```json
{
  "nearbyStores": ["Home Depot на 5-й", "Lowe's"]
}
```
`nearbyStores` — массив строк (названия/адреса ближайших магазинов).

**Response `200`:**
```json
{ "clientId": "abc123", "updated": true }
```

---

### `GET /api/clients/search?q=Steve` — Поиск клиента

Fuzzy search по имени и адресу (Fuse.js, threshold 0.4). Минимум 2 символа в `q`.

**Response `200`:**
```json
{
  "results": [
    { "clientId": "abc123", "clientName": "Steve Jobs LLC", "address": "1 Infinite Loop", "score": 0.1 }
  ],
  "count": 1
}
```

---

## 2. Задачи (GTD Tasks)

### `POST /api/gtd-tasks` — Создание задачи

**Request:**
```json
{
  "title": "Закупить материалы",
  "clientId": "abc123",
  "clientName": "Steve Jobs LLC",
  "assigneeId": "user-id",
  "assigneeName": "Иван",
  "priority": "high",
  "status": "next_action",
  "description": "Цемент 10 мешков",
  "dueDate": "2026-04-05T00:00:00.000Z",
  "estimatedDurationMinutes": 120,
  "taskType": "purchase",
  "siteId": "site-id",
  "projectId": "project-id",
  "idempotencyKey": "uuid-v4"
}
```
Обязательные: `title`. `priority`: `high | medium | low | none` (default `none`). `status`: `inbox | next_action | waiting | projects | estimate | someday` (default `inbox`).

**Response `201`:**
```json
{ "taskId": "task-id-123" }
```

---

### `GET /api/gtd-tasks/list` — Список задач

**Query параметры:**

| Параметр | Тип | Описание |
|---|---|---|
| `clientId` | string | Фильтр по ID клиента |
| `clientName` | string (min 2) | Fuzzy-поиск клиента → фильтр |
| `status` | string | Через запятую: `inbox,next_action` |
| `assigneeId` | string | Фильтр по исполнителю |
| `priority` | enum | `high / medium / low / none` |
| `dueBefore` | ISO string | Задачи с дедлайном до |
| `dueAfter` | ISO string | Задачи с дедлайном после |
| `limit` | number | 1–100, default 50 |
| `offset` | number | Пагинация, default 0 |
| `sortBy` | enum | `createdAt / dueDate / priority / updatedAt` |
| `sortDir` | enum | `asc / desc` |

**Response `200`:**
```json
{
  "tasks": [{ "id": "...", "title": "...", "status": "...", "priority": "...", ... }],
  "total": 42,
  "hasMore": true
}
```

---

### `PATCH /api/gtd-tasks/:id` — Обновление задачи

Partial update. Поля: `status`, `priority`, `title`, `description`, `dueDate`, `assigneeId`, `assigneeName`, `estimatedDurationMinutes`, `parentTaskId`, `isSubtask`, `budgetAmount`, `paidAmount`, `budgetCategory`, `progressPercentage`, `payments[]`.

`status` расширен до: `inbox | next_action | waiting | projects | estimate | someday | completed | archived`.

**Response `200`:** `{ "taskId": "...", "updated": true }`

---

### `DELETE /api/gtd-tasks/:id` — Архивация задачи

Не физическое удаление, а установка `status: "archived"`.

**Response `200`:** `{ "taskId": "...", "archived": true, "message": "Задача удалена (archived)" }`

---

## 3. Расходы (Costs)

### `POST /api/costs` — Создание расхода

**Request:**
```json
{
  "clientId": "abc123",
  "clientName": "Steve Jobs LLC",
  "category": "materials",
  "amount": 299.99,
  "description": "Цемент 10 мешков",
  "taskId": "task-id",
  "siteId": "site-id",
  "idempotencyKey": "uuid-v4"
}
```
Обязательные: `clientId`, `clientName`, `category`, `amount`.

`category`: `materials | tools | reimbursement | fuel | housing | food | permit | other`.

> 💡 Если `category == "reimbursement"`, сумма записывается как **отрицательная** (`-amount`).

**Response `201`:** `{ "costId": "cost-id-123" }`

---

### `GET /api/costs/list` — Список расходов

Query: `clientId`, `clientName`, `category` (через запятую), `from` (ISO), `to` (ISO), `limit` (1–200), `offset`, `sortBy` (`createdAt | amount | category`), `sortDir`.

**Response `200`:**
```json
{
  "costs": [{ "id": "...", "category": "materials", "amount": 299.99, ... }],
  "total": 15,
  "hasMore": false,
  "sum": { "total": 1500.00, "byCategory": { "materials": 1200, "fuel": 300 } }
}
```

---

### `DELETE /api/costs/:id` — Отмена расхода

Не физическое удаление, а `status: "voided"`.

**Response `200`:** `{ "costId": "...", "voided": true }`

---

## 4. Трекинг времени (Time Tracking)

### `POST /api/time-tracking` — Управление таймером

Discriminated union по полю `action`: `start | stop | status`.

#### Action: `start`

```json
{
  "action": "start",
  "taskTitle": "Монтаж розеток",
  "taskId": "task-id",
  "clientId": "abc123",
  "clientName": "Steve Jobs LLC",
  "startTime": "2026-04-01T07:00:00.000Z",
  "siteId": "site-id"
}
```
Обязательные: `taskTitle`. `startTime` — ручное переопределение (не старше 7 дней, не в будущем).

> 💡 **Автоматически** закрывает все предыдущие `active/paused` сессии (включая кросс-платформенную проверку по Telegram ID из профиля).

**Response `201`:**
```json
{
  "sessionId": "sess-id",
  "message": "Таймер запущен",
  "closedPrevious": "Предыдущая сессия закрыта: 120мин, $60.00",
  "closedCount": 1,
  "warnings": ["⚠️ Ставка $0/ч. Обратитесь к руководителю."]
}
```

#### Action: `stop`

```json
{ "action": "stop", "endTime": "2026-04-01T17:00:00.000Z" }
```

**Response `200`:**
```json
{ "durationMinutes": 120, "earnings": 60.00, "message": "Сессия завершена: 120мин, $60.00" }
```

Ошибки: `404` — нет активной сессии, `400` — `endTime` < `startTime`.

#### Action: `status`

```json
{ "action": "status" }
```

**Response `200`:**
```json
{
  "active": true,
  "sessionId": "sess-id",
  "task": "Монтаж розеток",
  "client": "Steve Jobs LLC",
  "status": "active",
  "elapsedMinutes": 45,
  "hourlyRate": 30
}
```
Или `{ "active": false, "message": "Нет активной сессии" }`.

---

### `GET /api/time-tracking/active-all` — Все активные сессии

Query: `clientId` (опционально).

**Response `200`:**
```json
{
  "activeSessions": [{ "sessionId": "...", "employeeName": "Иван", "task": "...", "elapsedMinutes": 45, ... }],
  "count": 3
}
```

---

### `GET /api/time-tracking/summary` — Сводка по времени

Query: `from` (обязательно, ISO), `to` (обязательно, ISO), `employeeId` (опционально).

**Response `200`:**
```json
{
  "from": "2026-03-01", "to": "2026-03-31",
  "totalHours": 160.5, "totalEarnings": 4815.00, "totalSessions": 42,
  "employees": [{ "employeeId": "...", "employeeName": "Иван", "totalHours": 80, "totalEarnings": 2400, "sessionCount": 21 }]
}
```

---

### `POST /api/time-tracking/admin-stop` — Принудительная остановка (только OWNER)

```json
{ "sessionId": "sess-id", "endTime": "2026-04-01T17:00:00.000Z" }
```

**Response `200`:**
```json
{
  "sessionId": "sess-id", "durationMinutes": 120, "earnings": 60.00,
  "employeeName": "Иван", "message": "Сессия Иван остановлена: 120мин, $60.00"
}
```

Ошибки: `403` — только OWNER, `404` — сессия не найдена, `400` — сессия не активна / endTime < startTime.

---

## 5. Статус проектов

### `GET /api/projects/status` — Агрегированный отчёт по клиенту

Query: `clientId` или `clientName` (min 2). Одно из двух обязательно.

**Response `200`:**
```json
{
  "clientId": "abc123",
  "tasks": { "total": 15, "recentByStatus": { "inbox": 3, "next_action": 5, "completed": 7 } },
  "costs": { "total": 2500.00, "count": 12 },
  "time": { "totalHours": 80.5, "totalEarnings": 2415.00 }
}
```

---

## 6. Пользователи (Users)

### `GET /api/users/search?q=Иван` — Fuzzy-поиск юзеров

Query: `q` (min 1), `limit` (1–20, default 5).

**Response `200`:**
```json
{ "results": [{ "userId": "...", "displayName": "Иван", "email": "...", "role": "worker", "hourlyRate": 30, "score": 0.1 }], "count": 1 }
```

---

### `POST /api/users/create-from-bot` — Создание/обновление юзера из бота

```json
{ "telegramId": 123456789, "displayName": "Иван Петров", "hourlyRate": 30, "role": "worker" }
```

Если юзер с таким `telegramId` уже существует — обновляет `hourlyRate`.

**Response `201` (новый):** `{ "userId": "...", "created": true }`
**Response `200` (обновлён):** `{ "userId": "...", "updated": true }`

---

## 7. Контакты (Contacts)

### `POST /api/contacts` — Создание контакта

```json
{
  "name": "Сергей Электрик",
  "phones": [{ "number": "+1-555-111", "label": "Мобильный" }],
  "roles": ["electrician", "inspector"],
  "linkedProjects": ["project-id-1"],
  "notes": "Работает по субботам",
  "emails": ["sergey@test.co"],
  "messengers": { "whatsapp": "+1-555-111", "telegram": "@sergey" },
  "defaultCity": "Austin"
}
```

**Response `201`:** `{ "contactId": "...", "name": "Сергей Электрик" }`

---

### `GET /api/contacts/search` — Поиск контактов

Query: `q` (min 1), `role` (фильтр по роли), `projectId` (фильтр по проекту), `limit` (1–50, default 10).

**Response `200`:**
```json
{ "results": [{ "contactId": "...", "name": "Сергей Электрик", "phones": [...], "roles": [...], "score": 0.1 }], "count": 1 }
```

---

## 8. Сметы (Estimates)

### `POST /api/estimates` — Создание сметы

```json
{
  "clientId": "abc123",
  "address": "123 Main St",
  "items": [
    { "id": "item-1", "description": "Розетка", "quantity": 10, "unitPrice": 15, "total": 150, "type": "material" }
  ],
  "notes": "Все материалы на стороне клиента",
  "taxRate": 8.25,
  "validUntil": "2026-05-01T00:00:00.000Z",
  "idempotencyKey": "uuid-v4"
}
```

> 💡 Если `clientId` не передан, но есть `address` — система ищет клиента по адресу (fuzzy), или **автоматически создаёт** нового.

`type` items: `labor | material | service | other`.

**Response `201`:**
```json
{ "estimateId": "est-id", "number": "EST-123456", "total": 162.38 }
```

---

### `GET /api/estimates/list` — Список смет

Query: `clientId`, `clientName`, `status` (через запятую: `draft,sent,approved`), `limit`, `offset`.

---

### `PATCH /api/estimates/:id` — Обновление сметы

Поля: `status` (`draft | sent | approved | rejected | converted`), `items[]`, `notes`, `terms`, `validUntil`, `taxRate`.

При обновлении `items` — автоматически пересчитывает `subtotal`, `taxAmount`, `total`.

---

### `POST /api/estimates/:id/convert-to-tasks` — Конвертация сметы в задачи

Атомарная транзакция: создаёт **родительскую задачу** + **подзадачи** по категориям (material, labor, service, other). Устанавливает `status: "converted"` на смете.

**Response `201`:**
```json
{
  "parentTaskId": "parent-id",
  "taskIds": ["parent-id", "child-1", "child-2"],
  "taskCount": 3,
  "message": "Создано 3 задач из сметы EST-123456"
}
```

Ошибки: `409` — смета уже конвертирована.

---

## 9. Проекты (Projects)

### `POST /api/projects` — Создание проекта

```json
{
  "clientId": "abc123",
  "name": "Ремонт офиса",
  "description": "Полный ремонт 2 этажа",
  "type": "work",
  "address": "123 Main St",
  "areaSqft": 2000,
  "projectType": "electrical",
  "facilityUse": "office"
}
```

`type`: `work | estimate | financial | other` (default `work`). Авто-поиск/создание клиента по адресу.

**Response `201`:** `{ "projectId": "proj-id", "name": "Ремонт офиса" }`

---

### `GET /api/projects/list` — Список проектов

Query: `clientId`, `clientName`, `status`, `type`, `limit`.

---

## 10. Файлы проектов (Files)

### `POST /api/projects/:id/files` — Загрузка файла (base64)

```json
{
  "fileName": "floorplan.pdf",
  "contentType": "application/pdf",
  "base64Data": "JVBERi0xLjQ...",
  "description": "План первого этажа"
}
```

Максимум **50MB**. Автоматическое версионирование (если файл с таким именем уже существует — `version` инкрементируется). Генерирует Signed URL на 30 дней.

**Response `201`:**
```json
{ "fileId": "file-id", "name": "floorplan.pdf", "version": 1, "url": "https://...", "size": 1234567, "path": "projects/proj-id/blueprints/v1_floorplan.pdf" }
```

---

### `GET /api/projects/:id/files` — Список файлов проекта

**Response `200`:**
```json
{
  "files": [{ "id": "file-id", "name": "floorplan.pdf", "version": 1, "url": "...", "size": 1234567, ... }],
  "grouped": { "floorplan.pdf": [/* все версии */] },
  "count": 3
}
```

---

## 11. Blueprint Split

### `POST /api/blueprint/split` — Разбивка PDF чертежа на страницы

```json
{ "projectId": "proj-id", "fileId": "file-id" }
```

Только для PDF. Каждая страница сохраняется как отдельный PDF в Storage + метаданные в Firestore.

**Response `200`:**
```json
{
  "projectId": "proj-id", "fileId": "file-id", "totalPages": 5,
  "pages": [{ "pageNumber": 1, "path": "...", "url": "https://...", "size": 12345, "width": 792, "height": 612 }]
}
```

---

## 12. Blackboard

### `POST /api/blackboard` — Создание/обновление Blackboard

```json
{
  "projectId": "proj-id",
  "version": 1,
  "zones": ["Kitchen", "Bedroom"],
  "extracted_elements": [{ ... }],
  "rfis": [{ ... }],
  "estimate_summary": { ... },
  "status": "in_progress"
}
```

`status`: `in_progress | completed | review_needed`. Если blackboard для данного `projectId` + `version` уже существует — **обновляет** его.

---

### `GET /api/blackboard/:projectId` — Получение Blackboard

Query: `version` (опционально, иначе — последняя версия).

---

## 13. Sites (Объекты)

### `POST /api/sites` — Создание объекта

```json
{
  "clientId": "abc123",
  "name": "Офис на Бродвее",
  "address": "123 Broadway, NY",
  "city": "New York", "state": "NY", "zip": "10001",
  "geo": { "lat": 40.75, "lng": -73.98 },
  "sqft": 5000,
  "type": "commercial",
  "permitNumber": "PRM-2026-001",
  "status": "active"
}
```

`status`: `active | completed | on_hold`.

---

### `GET /api/sites?clientId=abc123` — Список объектов клиента

`clientId` обязателен.

---

### `PATCH /api/sites/:id` — Обновление объекта

Partial update любых полей.

---

## 14. Финансы (Finance)

### `GET /api/finance/context` — Контекст для AI-парсера

Возвращает активные проекты, категории расходов и правила автоклассификации.

```json
{
  "projects": [{ "id": "...", "projectId": "...", "name": "Ремонт офиса", "clientName": "..." }],
  "categories": ["materials", "tools", ...],
  "rules": [{ "merchantName": "home depot", "defaultCategoryId": "materials", "defaultProjectId": "..." }]
}
```

---

### `POST /api/finance/transactions/batch` — Пакетная загрузка транзакций

Загружает банковские транзакции со статусом `draft`. Пропускает уже `approved`. Чанки по 400.

```json
{
  "transactions": [{
    "id": "tx-unique-id",
    "date": "2026-03-15",
    "rawDescription": "HOME DEPOT #1234",
    "cleanMerchant": "Home Depot",
    "amount": -125.99,
    "paymentType": "company",
    "categoryId": "materials",
    "projectId": "proj-id",
    "confidence": "high"
  }]
}
```

**Response `200`:** `{ "success": true, "count": 10, "totalReceived": 12 }`

---

### `POST /api/finance/transactions/approve` — Утверждение транзакций

При утверждении: (1) создаёт запись в `costs` (если `paymentType == "company"` и есть `projectId`), (2) сохраняет правило автоклассификации в `finance_rules`, (3) обновляет статус на `approved`.

---

### `POST /api/finance/transactions/undo` — Откат утверждения

```json
{ "transactionIds": ["tx-id-1", "tx-id-2"] }
```

Удаляет связанные `costs` записи и возвращает статус `draft`.

---

## 15. Change Orders

### `POST /api/change-orders` — Создание заказа на изменения

```json
{
  "projectId": "proj-id", "projectName": "Ремонт",
  "clientId": "abc123", "clientName": "Steve LLC",
  "parentEstimateId": "est-id",
  "title": "Добавить розетки в кухню",
  "items": [{
    "id": "item-1", "description": "Розетка GFCI", "type": "material",
    "quantity": 5, "unit": "шт",
    "unitCostPrice": 12, "totalCost": 60,
    "unitClientPrice": 18, "totalClientPrice": 90, "markupPercent": 50
  }],
  "defaultMarkupPercent": 20
}
```

Автоматически генерирует номер `CO-001`, `CO-002`, etc.

---

### `GET /api/change-orders` — Список

Query: `projectId`, `clientId`, `clientName`, `status`, `limit`, `offset`.

---

### `PATCH /api/change-orders/:id` — Обновление

При `status: "approved"` — автоматически записывает `approvedAt` и `approvedBy`.

---

## 16. Purchase Orders

### `POST /api/purchase-orders` — Создание закупки

```json
{
  "projectId": "proj-id", "projectName": "Ремонт",
  "clientId": "abc123", "clientName": "Steve LLC",
  "vendor": "Home Depot", "vendorContact": "+1-555-000",
  "items": [{
    "id": "item-1", "description": "Провод 12AWG", "quantity": 100, "unit": "м",
    "unitPrice": 1.50, "total": 150, "plannedUnitPrice": 1.20
  }],
  "category": "materials",
  "taxAmount": 12.38,
  "status": "received",
  "purchaseDate": "2026-04-01T00:00:00.000Z",
  "plannedTotal": 120
}
```

Автоматически вычисляет `varianceAmount` и `variancePercent` по сравнению с `plannedTotal` и `plannedUnitPrice`.

---

### `GET /api/purchase-orders` — Список

Query: `projectId`, `clientId`, `clientName`, `status`, `limit`, `offset`.

Ответ включает агрегат `sum: { total, byCategory }`.

---

## 17. Plan vs Fact

### `GET /api/plan-vs-fact` — Анализ План/Факт

Query: `clientId` или `clientName` или `projectId` (одно обязательно).

Агрегирует данные из `estimates`, `change_orders`, `costs`, `purchase_orders` и `work_sessions`.

**Response `200`:**
```json
{
  "clientId": "abc123", "clientName": "Steve LLC",
  "planned": { "materials": 5000, "labor": 3000, "subcontract": 1000, "total": 9000 },
  "actual": { "materials": 5500, "labor": 2800, "subcontract": 900, "total": 9200 },
  "variance": { "materials": 500, "labor": -200, "subcontract": -100, "total": 200 },
  "margin": { "planned": 25.0, "actual": 23.5 },
  "alerts": [
    "⚠️ Materials over budget by 10%",
    "🔴 Total expenses exceed plan by $200.00"
  ]
}
```

> 💡 Алерты генерируются автоматически при превышении 10% порога по категории.

---

## Деплой и Runtime

- **Runtime:** Firebase Cloud Functions (Node.js)
- **Memory:** 512MB
- **Timeout:** 120s
- **Min Instances:** 1 (warm start)
- **Max body:** 60MB (`express.json({ limit: '60mb' })`)

Экспорт: `agentApi` → `functions.https.onRequest(app)`
