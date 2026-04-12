# ТЗ: Мульти-агентная инфраструктура CRM Profit Step

> Статус: Phase 1-3 SHIPPED (2026-04-11), Phase 4-7 TODO
> Автор: Денис + Claude Code
> Задача: каждый сотрудник имеет персонального AI-агента на своём компьютере
> Версия: 2.0 (2026-04-11) — добавлены: indexes, error catalog, bot conflicts, billing, migration, monitoring, edge cases

---

## Проблема

Текущий Agent API рассчитан на **одного** пользователя (владелец). Один `AGENT_API_KEY` → все агенты выглядят как один user → нет разграничения прав, rate limit общий, audit trail бесполезен.

Если у каждого сотрудника будет агент на своём компьютере:
- Все 20 агентов шарят один token → identity loss
- Rate limit 60 req/min на всех → коллизии
- Нет фильтрации данных по роли → worker видит всё
- Нет event stream → агенты не знают что происходит в CRM
- Audit log пишет одного user на все действия

---

## Архитектура (целевая)

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│  Vasya Agent         │     │  Petya Agent         │     │  Admin Agent         │
│  (Python/LangGraph)  │     │  (Python/LangGraph)  │     │  (OpenClaw)          │
│  Token: abc123...    │     │  Token: def456...    │     │  Token: AGENT_API_KEY│
│  Scopes: tasks,time  │     │  Scopes: tasks,costs │     │  Scopes: admin       │
└──────────┬───────────┘     └──────────┬───────────┘     └──────────┬───────────┘
           │ Bearer abc123              │ Bearer def456              │ Bearer KEY
           ▼                            ▼                            ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         agentApi (Firebase Cloud Function)                       │
│                                                                                  │
│  Auth Middleware:                                                                 │
│    Mode 1: AGENT_API_KEY → OWNER_UID (admin)                                    │
│    Mode 2: Firebase JWT → uid (browser)                                          │
│    Mode 3: agent_tokens → employeeId + scopes + role  ← NEW                    │
│                                                                                  │
│  Scope Middleware: requireScope('tasks:read')                                    │
│  Rate Limit: per-employee (individual buckets)                                   │
│                                                                                  │
│  Routes:                                                                         │
│    /api/agent-tokens (admin CRUD)                                                │
│    /api/events (polling event queue)                                             │
│    /api/gtd-tasks, /api/time-tracking, /api/costs, ...                           │
└──────────────────────────────┬───────────────────────────────────────────────────┘
                               │
                               ▼
                     ┌─────────────────────┐
                     │   Firestore          │
                     │   agent_tokens       │
                     │   agent_events       │
                     │   _rate_limits       │
                     │   + все бизнес-      │
                     │     коллекции        │
                     └─────────────────────┘
```

---

## Phase 1: Per-employee API Tokens — SHIPPED

**Коллекция:** `agent_tokens`

**Документ:**
```typescript
{
  token: string,           // 40 hex chars (160 bits), unique
  employeeId: string,      // Firebase UID сотрудника
  employeeName: string,
  label: string,           // "Vasya MacBook", "Petya office"
  scopes: string[],        // ['tasks:read', 'tasks:write', 'time:write']
  createdAt: Timestamp,
  createdBy: string,       // admin UID
  expiresAt: Timestamp,    // default 90 days
  revokedAt: Timestamp | null,
  revokedBy: string | null,
  lastUsedAt: Timestamp | null,
  useCount: number,
}
```

**Эндпоинты (admin-only):**

| Method | Endpoint | Назначение |
|--------|----------|-----------|
| POST | `/api/agent-tokens` | Создать токен |
| GET | `/api/agent-tokens` | Список (фильтр: employeeId, includeRevoked) |
| DELETE | `/api/agent-tokens/:id` | Отозвать |
| POST | `/api/agent-tokens/:id/rotate` | Перегенерировать (старый невалиден) |

**Auth middleware — Mode 3:**
```
Bearer <40-hex-char-token>
  → lookup agent_tokens where token == X, revokedAt == null
  → check expiry
  → lookup users/{employeeId} → role, companyId
  → set req.agentUserId, agentRole, agentScopes, agentCompanyId
  → update lastUsedAt + useCount (fire-and-forget)
```

**Файлы:**
- `functions/src/agent/agentMiddleware.ts` — Mode 3 auth + requireScope() + requireAdmin()
- `functions/src/agent/routes/agentTokens.ts` — 4 admin endpoints
- `functions/src/agent/schemas/agentTokenSchemas.ts` — Zod validation

---

## Phase 2: RBAC Scope Enforcement — SHIPPED

**14 гранулярных scopes:**

| Scope | Что даёт |
|-------|---------|
| `tasks:read` | Просмотр задач (свои или все, зависит от роли) |
| `tasks:write` | Создание / обновление / архивация задач |
| `time:read` | Просмотр сессий и summary |
| `time:write` | Старт / стоп / пауза сессий |
| `costs:read` | Просмотр расходов |
| `costs:write` | Добавление расходов |
| `clients:read` | Поиск и просмотр клиентов |
| `clients:write` | Создание / обновление клиентов |
| `projects:read` | Просмотр проектов |
| `projects:write` | Создание / обновление проектов |
| `estimates:read` | Просмотр смет |
| `estimates:write` | Создание / обновление смет |
| `inventory:read` | Просмотр склада |
| `inventory:write` | Операции со складом |
| `erp:read` | Просмотр change orders / PO |
| `erp:write` | Создание change orders / PO |
| `events:read` | Polling event queue |
| `dashboard:read` | Просмотр dashboard |
| `admin` | Полный доступ ко всему |

**Scoped Queries (реализовано для tasks):**
- Worker (без `admin` scope, роль `user`/`worker`) → `WHERE assigneeId == req.agentUserId`
- Manager → видит задачи подчинённых (через hierarchyPath в будущем)
- Admin → все задачи

**Middleware `requireScope(...scopes)`:**
```typescript
// На каждом эндпоинте:
router.get('/api/gtd-tasks/list', requireScope('tasks:read', 'admin'), handler);
router.post('/api/gtd-tasks', requireScope('tasks:write', 'admin'), handler);
```

**Файлы:**
- `functions/src/agent/agentMiddleware.ts` — requireScope(), requireAdmin()
- `functions/src/agent/routes/tasks.ts` — scope checks + scoped queries
- `functions/src/agent/routes/costs.ts` — scope checks
- `functions/src/agent/routes/timeTracking.ts` — scope checks

---

## Phase 3: Agent Event Queue — SHIPPED

**Коллекция:** `agent_events`

**Документ:**
```typescript
{
  type: 'task' | 'session' | 'cost' | 'estimate' | 'project' | 'inventory' | 'payroll' | 'alert',
  action: string,          // 'created', 'updated', 'assigned', 'completed', 'started', 'stopped'
  entityId: string,
  entityType: string,      // 'gtd_task', 'work_session', 'cost', etc.
  summary: string,         // "Task created: Send invoice"
  data: object,            // key fields для быстрой обработки без доп. API call
  employeeId: string|null, // null = broadcast всем агентам
  companyId: string|null,
  source: 'api'|'bot'|'trigger'|'scheduled',
  createdAt: Timestamp,
  expiresAt: Timestamp,    // +7 days (auto-cleanup)
}
```

**Эндпоинты:**

| Method | Endpoint | Назначение |
|--------|----------|-----------|
| GET | `/api/events?since=<ISO>&types=task,session&limit=50` | Polling новых событий |
| GET | `/api/events/types` | Список доступных типов |

**Scoping событий:**
- Admin → все события
- Worker → события `WHERE employeeId == userId OR employeeId == null`

**Текущие точки публикации:**
- Task created / updated / completed / assigned → `publishTaskEvent()`
- Session started / stopped → `publishSessionEvent()`
- Cost created → `publishCostEvent()`

**Файлы:**
- `functions/src/agent/utils/eventPublisher.ts` — publish helpers
- `functions/src/agent/routes/events.ts` — polling endpoint
- Wired into: `tasks.ts`, `timeTracking.ts`, `costs.ts`

---

## Phase 4: Расширение scoped queries — TODO

**Задача:** Добавить scoped queries ко ВСЕМ route'ам (не только tasks).

| Route | Текущее состояние | Нужно |
|-------|------------------|-------|
| tasks | Scoped by assigneeId | OK |
| timeTracking | scope middleware | Добавить: worker видит только свои сессии |
| costs | scope middleware | Добавить: worker видит только свои расходы |
| clients | Без scoping | Добавить: scope middleware (read/write) |
| projects | Без scoping | Добавить: scope middleware |
| estimates | Без scoping | Добавить: scope middleware |
| inventory | Без scoping | Добавить: scope middleware |
| erp | Без scoping | Добавить: scope middleware |
| dashboard | Без scoping | Добавить: worker видит свой KPI, admin видит всё |
| dashboardClient | Без scoping | Добавить: scope middleware |
| finance | Без scoping | Добавить: admin-only |

**Приоритет:** costs → timeTracking → dashboard → clients → остальное

---

## Phase 5: Event Queue расширение — TODO

**5a: Подключить Firestore triggers к event queue**

Сейчас события публикуются только из API routes. Нужно также:
- `onTaskCreate` trigger → publishTaskEvent('created')
- `onWorkSessionCreate` trigger → publishSessionEvent('started')
- `onWorkSessionUpdate` trigger → publishSessionEvent('stopped')
- `onCostCreated` trigger → publishCostEvent('created')
- Bot actions → publish events (Telegram бот создаёт сессии/задачи — агенты должны видеть)

**5b: Cleanup scheduled function**

```typescript
// cleanupAgentEvents — schedule every 24h
// Delete from agent_events WHERE expiresAt < now
// Batch delete, 500 per iteration
```

**5c: Event types расширение**

| Тип | Действия | Приоритет |
|-----|---------|-----------|
| `task` | created, updated, assigned, completed, blocked | SHIPPED |
| `session` | started, stopped, paused, auto_closed | SHIPPED (start/stop) |
| `cost` | created, voided | SHIPPED (created) |
| `estimate` | created, sent, approved, rejected | TODO |
| `project` | created, updated, completed | TODO |
| `inventory` | transaction, low_stock | TODO |
| `payroll` | period_closed, period_locked, period_paid | TODO |
| `alert` | budget_warning, deadline, safety, idle_session | TODO |

---

## Phase 6: Agent SDK / Client Library — TODO

**Задача:** Готовый Python-пакет для быстрого старта агента.

```python
# pip install profit-step-agent
from profit_step_agent import CRMAgent

agent = CRMAgent(
    token="abc123def456...",
    base_url="https://profit-step.web.app/api",
)

# Typed methods
tasks = agent.tasks.list(status="next_action")
agent.time.start(client_name="Jim Dvorkin")
agent.costs.create(category="materials", amount=200)

# Event loop
async for event in agent.events.stream(types=["task", "session"]):
    if event.type == "task" and event.action == "assigned":
        print(f"New task: {event.summary}")
```

**Компоненты:**
- `CRMClient` — HTTP клиент с retry, error parsing, rate limit handling
- Typed methods для каждого домена (tasks, time, costs, events, etc.)
- Event stream — async generator с polling + exponential backoff
- Pydantic models для всех request/response schemas
- CLI tool: `psa login`, `psa tasks list`, `psa time start`

---

## Phase 7: Bot ↔ Agent Conflict Resolution — TODO

**Задача:** Устранить race conditions между Telegram ботом и Agent API.

### 7a: Единый формат employeeId
- Все `work_sessions` пишут `employeeId` как Firebase UID (строка)
- `telegramId` сохраняется в отдельном поле `telegramId` (для обратной совместимости)
- Bot при создании сессии: resolve telegramId → Firebase UID → write UID
- Миграция: batch update existing sessions с числовым employeeId → resolve → UID

### 7b: Bot → транзакции
- Переписать `initWorkSession()` в `onWorkerBotMessage.ts` на `runTransaction()`
- Внутри транзакции: check active → close if exists → create new
- Убрать TOCTOU race window в double-click guard

### 7c: Cross-notification
- При закрытии bot-сессии через API → отправить Telegram сообщение:
  `"⚠️ Ваша сессия была закрыта через API. Текущий статус: ..."`
- При закрытии API-сессии через бота → publish event `session.stopped` с source='bot'

### 7d: Optimistic locking
- Добавить `users/{uid}.activeSessionLock = { sessionId, source, timestamp }`
- При старте: check lock → if lock exists and fresh (<1 min) → reject
- Bot и API оба проверяют lock → предотвращает одновременный старт

### 7e: Event publish из бота
- Bot при старте/стопе/паузе → `publishSessionEvent()` с source='bot'
- Агенты получают уведомления о bot-сессиях через `/api/events`
- Полная картина: кто когда начал/закончил, из какого источника

---

## Безопасность

### Token Security
- 160-bit entropy (40 hex chars) — brute force невозможен
- Tokens хранятся в Firestore (server-side only) — не в .env
- Token value показывается **только при создании** — не в GET list
- Rotation без downtime (POST /:id/rotate)
- Expiry по умолчанию 90 дней
- Revocation мгновенная (revokedAt != null → reject)

### Scope Enforcement
- requireScope() middleware на каждом endpoint
- `admin` scope bypasses все проверки
- Scoped queries: worker не может запросить чужие данные даже через фильтры
- Audit: каждое действие логируется с реальным employeeId (не OWNER_UID)

### Rate Limiting
- Per-employee buckets (req.agentUserId из token)
- 60 req/min на сотрудника (не shared)
- Firestore-based counter с transaction near threshold

### Backward Compatibility
- Mode 1 (AGENT_API_KEY) → работает как раньше, role=superadmin, scopes=['admin']
- Mode 2 (Firebase JWT) → работает как раньше, scopes=['admin']
- Mode 3 (agent token) → новое, scoped access

---

## Как создать токен для сотрудника

```bash
# Admin создаёт токен для Васи
curl -X POST \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "vasya-firebase-uid",
    "label": "Vasya MacBook agent",
    "expiresInDays": 90,
    "scopes": ["tasks:read", "tasks:write", "time:read", "time:write", "costs:write", "events:read"]
  }' \
  https://profit-step.web.app/api/agent-tokens
```

**Response:**
```json
{
  "tokenId": "abc123",
  "token": "a1b2c3d4e5f6...40chars",
  "employeeId": "vasya-firebase-uid",
  "employeeName": "Vasya",
  "scopes": ["tasks:read", "tasks:write", "time:read", "time:write", "costs:write", "events:read"],
  "expiresAt": "2026-07-10T00:00:00.000Z",
  "warning": "Save this token now — it will not be shown again."
}
```

**Вася конфигурирует агента:**
```python
# config.py на машине Васи
API_KEY = "a1b2c3d4e5f6...40chars"
API_BASE = "https://profit-step.web.app/api"
```

---

## Типичные наборы scopes по роли

| Роль | Scopes |
|------|--------|
| **Worker** (бригадир) | tasks:read, tasks:write, time:read, time:write, costs:write, events:read |
| **Foreman** (старший) | tasks:read, tasks:write, time:read, time:write, costs:read, costs:write, events:read, dashboard:read |
| **Estimator** | estimates:read, estimates:write, clients:read, projects:read |
| **Accountant** | costs:read, time:read, dashboard:read, events:read |
| **Project Manager** | tasks:read, tasks:write, time:read, costs:read, clients:read, projects:read, dashboard:read, events:read |
| **Admin** | admin |

---

---

## Firestore Indexes

### Обязательные (добавить в `firestore.indexes.json`)

```json
{
  "collectionGroup": "agent_tokens",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "token", "order": "ASCENDING" },
    { "fieldPath": "revokedAt", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "agent_tokens",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "employeeId", "order": "ASCENDING" },
    { "fieldPath": "revokedAt", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "agent_events",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "employeeId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "agent_events",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "createdAt", "order": "ASCENDING" }
  ]
}
```

**Без этих индексов** запросы `GET /api/agent-tokens` и `GET /api/events` будут падать с ошибкой `FAILED_PRECONDITION` в Firestore.

Деплой: `firebase deploy --only firestore:indexes`

---

## Каталог ошибок API

Агент **обязан** обрабатывать все эти ответы и передавать LLM для самокоррекции.

### Стандартные HTTP коды

| Код | Когда | Формат ответа | Действие агента |
|-----|-------|--------------|-----------------|
| **200** | Success (GET, PATCH, DELETE) | `{ ...data }` | Обработать результат |
| **201** | Created (POST) | `{ entityId: "..." }` | Сохранить ID |
| **400** | Zod validation failed | `{ error, code: "VALIDATION_ERROR", details: [{field, message}] }` | Передать details LLM → исправить параметры → retry |
| **401** | Token missing / expired / invalid | `{ error: "Missing authorization token" \| "Agent token expired" \| "Invalid authorization token" }` | Если expired — запросить новый token у admin |
| **403** | Scope insufficient / not admin | `{ error: "Insufficient permissions", required: [...], hint: "..." }` | Показать required scopes → запросить расширение у admin |
| **404** | Entity not found | `{ error: "Задача не найдена" }` | Передать LLM → уточнить у пользователя |
| **409** | Conflict (duplicate, state violation) | `{ error: "...", entityId: "..." }` | Часто идемпотентность — вернуть existing entity |
| **429** | Rate limit | `{ error: "Rate limit exceeded", retryAfterMs: 5000 }` | `sleep(retryAfterMs)` → retry |
| **500** | Internal error | `{ error: "Internal server error", code: "INTERNAL_ERROR", requestId }` | Log requestId → retry 1 раз → если повторяется, показать пользователю |
| **503** | Firestore unavailable | `{ error: "Database temporarily unavailable", requestId }` | Exponential backoff: 1s → 2s → 4s → fail |

### Zod Validation Error (подробный формат)

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "requestId": "req_m4abc_x7f2",
  "details": [
    { "field": "amount", "message": "Expected number, received string" },
    { "field": "clientId", "message": "Required" },
    { "field": "status", "message": "Invalid enum value. Expected 'inbox' | 'next_action' | ..., received 'in_progress'" }
  ]
}
```

**Агент парсит `details` → формирует строку → передаёт LLM:**
```
"Validation error: amount — Expected number, received string; clientId — Required"
```

LLM исправляет параметры и вызывает tool повторно.

---

## Конфликты: Telegram Bot vs Agent API

### Проблема

Bot и Agent API пишут в одну коллекцию `work_sessions`. При одновременной работе возможны конфликты.

### Как работает каждый

| Аспект | Telegram Bot | Agent API |
|--------|-------------|-----------|
| **employeeId** | Telegram ID (число: `123456789`) | Firebase UID (строка: `"abc123def"`) |
| **Транзакции** | НЕТ (`.add()` без transaction) | ДА (Firestore transaction) |
| **Проверка дублей** | `getActiveSession(telegramId)` — один запрос | `resolveEmployeeIds()` → 3 варианта ID → scan в transaction |
| **Закрытие старых** | Нет автозакрытия | Авто-закрывает все активные перед стартом |
| **Pointer** | Не обновляет `users.activeSessionId` | Обновляет внутри transaction |

### Сценарии конфликтов

**Сценарий A: Bot → API (API побеждает)**
1. Бот создаёт сессию `{employeeId: 123456789, status: 'active'}`
2. API вызывает `resolveEmployeeIds(firebaseUid)` → `[firebaseUid, 123456789, "123456789"]`
3. API находит сессию бота → **автозакрывает** → создаёт свою
4. Бот не знает что его сессия закрыта — пользователь не уведомлён

**Сценарий B: API → Bot (дубликат)**
1. API создаёт сессию `{employeeId: firebaseUid, status: 'active'}`
2. Бот ищет `WHERE employeeId == telegramId` → **не находит** (разные ID!)
3. Бот создаёт вторую сессию → **2 активных сессии одновременно**
4. Cron `finalizeExpiredSessions` (1 AM) закроет старую через 2 дня

**Сценарий C: Одновременный старт (worst case)**
1. Оба проверяют — ничего нет
2. Оба создают → **2 сессии**
3. Нет автоматической очистки до cron-а

### Защиты (уже есть)

- API: транзакции + cross-platform ID resolution + auto-close
- Bot: double-click guard (проверка после intent)
- Cron: `finalizeExpiredSessions` (daily 1 AM) — закрывает сессии >2 дней
- Cron: `autoCloseStaleSessions` (каждые 30 мин) — закрывает >12 часов

### Что нужно доделать (Phase 7)

1. **Единый формат employeeId** — всегда Firebase UID, telegramId только для lookup
2. **Bot → транзакции** — переписать `.add()` на `runTransaction()` с проверкой
3. **Cross-notification** — при закрытии API-сессии → уведомить бота через Telegram
4. **Lock-документ** — `users/{uid}.activeSessionLock` с timestamp → optimistic concurrency
5. **Event publish из бота** — бот тоже пишет в `agent_events` при старте/стопе

---

## Firebase Billing: прогноз расходов

### На одного агента (worker, active workday)

| Операция | Reads/day | Writes/day | Формула |
|----------|-----------|------------|---------|
| Auth (token lookup) | ~100 | 100 (lastUsedAt) | 1 read + 1 write per request |
| User profile lookup | ~100 | 0 | Кешируется в middleware |
| Task list | ~50 | 0 | 50 запросов × 1 read |
| Task create/update | ~10 | 20 | 2 writes per task (create + idempotency) |
| Time start/stop | ~4 | 12 | 3 writes per action (session + user + audit) |
| Cost create | ~5 | 10 | 2 writes per cost |
| Event poll | ~50 | 0 | Polling каждые 30 сек = 2880, но кешируем |
| Event publish | 0 | ~20 | Fire-and-forget |
| Rate limit | ~100 | 100 | 1 per request |
| **ИТОГО** | **~420** | **~262** | |

### На 20 агентов (команда)

| Метрика | В день | В месяц | Стоимость |
|---------|--------|---------|-----------|
| Reads | 8,400 | 252,000 | Free tier (50K/day) |
| Writes | 5,240 | 157,200 | Free tier (20K/day) если <20K/day |
| Deletes | ~100 | 3,000 | Negligible |
| **Estimated cost** | | | **$0–5/month** при умеренном использовании |

### Danger Zone

| Риск | Условие | Стоимость |
|------|---------|-----------|
| Event polling слишком частый | 20 агентов × каждые 5 сек = 345,600 reads/day | ~$10/month |
| Infinite loop trigger | `onTaskCreate` → publishEvent → creates doc → trigger fires | $10,000+/day |
| Rate limit DB writes | 20 agents × 60 req/min × 2 writes = 2,400 writes/min | $50/month |

**Mitigation:**
- Event polling: minimum 30 сек интервал (рекомендация в SDK)
- Triggers: idempotency guard через `processedEvents` collection
- Rate limit: transaction-based, не каждый request пишет

---

## Plan миграции: Single-Key → Multi-Token

### Step 1: Deploy (без breaking changes)
```bash
# Build + deploy functions
npm --prefix functions run build
firebase deploy --only functions:agentApi

# Deploy indexes
firebase deploy --only firestore:indexes
```

Всё backward-compatible: `AGENT_API_KEY` (Mode 1) работает как раньше.

### Step 2: Создать токены для сотрудников
```bash
# Для каждого сотрудника:
curl -X POST -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{"employeeId":"<uid>", "label":"<name> <device>", "scopes":[...]}' \
  https://profit-step.web.app/api/agent-tokens
```

### Step 3: Раздать токены
- Каждому сотруднику — его token + config.py
- Документация по установке агента на машину
- Smoke test: `curl -H "Authorization: Bearer <token>" .../api/health`

### Step 4: Мониторинг (первые 48 часов)
```bash
# Проверить что токены используются
firebase functions:log --only agentApi | grep "Agent token"

# Проверить rate limits
firebase functions:log --only agentApi | grep "Rate limit"

# Проверить scope denials
firebase functions:log --only agentApi | grep "Scope denied"
```

### Step 5: Отключение общего ключа (опционально)
Когда все на персональных токенах:
1. Сменить `AGENT_API_KEY` на новый (для admin-only use)
2. Убрать старый ключ из агентских конфигов
3. Мониторить 401 ошибки — кто ещё использует старый

---

## Deployment Checklist

### Pre-deploy
- [ ] `npm --prefix functions run build` — без новых ошибок
- [ ] Проверить что `firestore.indexes.json` содержит индексы для `agent_tokens` и `agent_events`
- [ ] Проверить `.env` / Secret Manager: `AGENT_API_KEY`, `OWNER_UID` не изменились
- [ ] Backup текущих functions: `firebase functions:list`

### Deploy
- [ ] `firebase deploy --only firestore:indexes` (сначала индексы — нужно время на build)
- [ ] Подождать ~5 мин пока индексы создадутся (проверить в Console)
- [ ] `firebase deploy --only functions:agentApi` (одна функция)
- [ ] `curl https://profit-step.web.app/api/health` — проверить версию

### Post-deploy
- [ ] `firebase functions:log --only agentApi` — первые 10 минут без ошибок
- [ ] Тест Mode 1: `curl -H "Authorization: Bearer $OLD_KEY" .../api/gtd-tasks/list` → 200
- [ ] Тест Mode 3: создать token → `curl -H "Authorization: Bearer <token>" .../api/gtd-tasks/list` → 200
- [ ] Тест scope deny: создать token с `["tasks:read"]` → POST task → 403
- [ ] Тест events: `curl .../api/events?since=2026-01-01T00:00:00Z` → 200

### Rollback plan
```bash
# Откатить только agentApi на предыдущую версию:
# 1. Найти предыдущий коммит
git log --oneline -5 -- functions/src/agent/
# 2. Checkout файлы
git checkout <prev-commit> -- functions/src/agent/
# 3. Build + deploy
npm --prefix functions run build
firebase deploy --only functions:agentApi
```

---

## Мониторинг production

### Ключевые метрики (первые 48 часов)

| Метрика | Где смотреть | Алерт-порог |
|---------|-------------|-------------|
| Auth failures (401) | `functions:log \| grep "Auth failed"` | >10/hour |
| Scope denials (403) | `functions:log \| grep "Scope denied"` | >20/hour (конфиг scopes) |
| Rate limits (429) | `functions:log \| grep "Rate limit"` | >5/min (один user) |
| Token lookups | `functions:log \| grep "Agent token"` | Должны быть |
| Event queue size | Firestore Console → agent_events count | >10,000 (cleanup не работает) |
| Function errors | Firebase Console → Functions → Error rate | >1% |
| Billing | Firebase Console → Usage & Billing | >$5/day unexpected |

### Команды мониторинга

```bash
# Live tail логов agentApi
firebase functions:log --only agentApi --follow

# Подсчёт ошибок за последний час
firebase functions:log --only agentApi | grep -c "error"

# Кто использует токены
firebase functions:log --only agentApi | grep "token" | grep -oP 'employeeId=\K[^,]+' | sort | uniq -c

# Сколько events накопилось
firebase firestore:indexes  # check agent_events collection size in Console
```

---

## Edge Cases

### Token украден
1. Admin немедленно: `DELETE /api/agent-tokens/:id` (revoke)
2. Revocation мгновенная — следующий запрос получит 401
3. Создать новый токен для сотрудника
4. Проверить `activityLog` за период — что было сделано под украденным токеном

### Сотрудник уволен
1. `DELETE /api/agent-tokens/:id` для всех его токенов
2. Обновить `users/{uid}.status = 'inactive'`
3. Даже если token не revoked — middleware проверяет `users` profile (inactive = reject в будущей фазе)

### Token expired mid-session
- Текущее поведение: следующий запрос → 401 `"Agent token expired"`
- Агент должен: показать сообщение → попросить admin rotate/recreate
- Работа не теряется — данные уже в Firestore

### Сеть пропала (offline agent)
- Агент должен: queue requests локально → retry при reconnect
- Events: polling с `since` параметром → пропущенные события получит при reconnect (TTL 7 дней)
- Time tracking: если stop не дошёл → cron `autoCloseStaleSessions` (12h) закроет

### 20 агентов стартуют одновременно (cold start)
- Каждый делает: auth → rate limit → request = 3 Firestore ops
- 20 × 3 = 60 concurrent Firestore ops → в пределах нормы
- Rate limit: individual buckets → без коллизий
- Cloud Function: `minInstances: 1` → first request may be slow (~3s), rest fast

---

## Файлы (реализация)

| Файл | Что делает |
|------|-----------|
| `functions/src/agent/agentMiddleware.ts` | Auth Mode 3, requireScope(), requireAdmin() |
| `functions/src/agent/routes/agentTokens.ts` | CRUD токенов (4 endpoints) |
| `functions/src/agent/routes/events.ts` | Event queue polling (2 endpoints) |
| `functions/src/agent/utils/eventPublisher.ts` | publishEvent(), publishTaskEvent(), publishSessionEvent(), publishCostEvent() |
| `functions/src/agent/schemas/agentTokenSchemas.ts` | Zod schemas: CreateAgentToken, ListAgentTokens, EventsQuery |
| `functions/src/agent/routes/tasks.ts` | + scope checks + scoped queries + event publish |
| `functions/src/agent/routes/costs.ts` | + scope checks + event publish |
| `functions/src/agent/routes/timeTracking.ts` | + scope checks + event publish |
