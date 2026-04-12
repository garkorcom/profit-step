# ТЗ: Мульти-агентная инфраструктура CRM Profit Step

> Статус: Phase 1-3 SHIPPED (2026-04-11), Phase 4-7 TODO
> Автор: Денис + Claude Code
> Задача: каждый сотрудник имеет персонального AI-агента на своём компьютере
> Версия: 3.0 (2026-04-11) — добавлены: детальные планы Phase 4-10, API контракты, Zod schemas, sequence diagrams, тест-план, timeline, SDK architecture, payroll endpoints

---

## Оглавление фаз

| Phase | Статус | Описание | Источник |
|-------|--------|----------|----------|
| **1** | SHIPPED | Per-employee API tokens | Новое |
| **2** | SHIPPED | RBAC scope enforcement | Новое |
| **3** | SHIPPED | Agent event queue | Новое |
| **4** | TODO | Scoped queries для всех routes | Новое |
| **5** | TODO | Event queue расширение (triggers, cleanup) | Новое |
| **6** | TODO | Python Agent SDK | Новое |
| **7** | TODO | Bot ↔ Agent conflict resolution | Анализ onWorkerBotMessage.ts |
| **8** | TODO | Новые бизнес-эндпоинты (/my-balance, overtime, etc.) | `FINANCE_PAYROLL_IMPROVEMENTS.md` |
| **9** | TODO | OpenAPI / Swagger авто-документация | `TODO_FUTURE_IMPROVEMENTS.md` §21 |
| **10** | TODO | Push-уведомления (webhooks, Telegram bridge, FCM) | `TODO_FUTURE_IMPROVEMENTS.md` §10 |

### Связанные документы

| Документ | Что взято |
|----------|----------|
| `docs/tasks/FINANCE_PAYROLL_IMPROVEMENTS.md` | Phase 8: payroll self-service, overtime, anomaly detection, export |
| `docs/legacy-nov2025/TODO_FUTURE_IMPROVEMENTS.md` | Phase 9 (OpenAPI), Phase 10 (notifications), advanced permissions |
| `OPENCLAW_AGENT_GUIDE.md` | API reference, Pydantic models, business flows |
| `BOT_AND_API_REFERENCE.md` | Phase 7: bot architecture, conflict analysis |
| `OPENCLAW_AGENT_INTEGRATION_GUIDE.md` | Original mirror-typing architecture |

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

## Phase 8: Новые API endpoints для агентов — TODO

> Источник: `docs/tasks/FINANCE_PAYROLL_IMPROVEMENTS.md`, `docs/legacy-nov2025/TODO_FUTURE_IMPROVEMENTS.md`

Текущие 62 эндпоинта покрывают CRUD. Но агентам нужны **бизнес-операции** и **аналитика**.

### 8a: Payroll & Finance endpoints

| Endpoint | Method | Назначение | Scopes | Приоритет |
|----------|--------|-----------|--------|-----------|
| `/api/payroll/my-balance` | GET | Баланс текущего сотрудника (earned, paid, outstanding PO) | `time:read` | P1 — workers спрашивают каждый день |
| `/api/payroll/my-hours` | GET | Часы за текущую неделю по дням и проектам, overtime warning | `time:read` | P1 |
| `/api/payroll/my-pay` | GET | Последний период: gross, deductions, net (текстовый pay stub) | `time:read` | P1 |
| `/api/payroll/period/:id/validate` | POST | Pre-disbursement anomaly detection (hours >60, rate changes, duplicates) | `admin` | P2 |
| `/api/payroll/period/:id/export` | GET | CSV/PDF экспорт периода для бухгалтера | `admin` | P2 |
| `/api/payroll/overtime-check` | GET | Текущая неделя: кто на пороге overtime (>35h) | `admin` | P1 — legal compliance |
| `/api/finance/burdened-cost` | GET | Burdened labor cost по проекту (rate × burden multiplier) | `dashboard:read` | P3 |

**Важно:** `/api/payroll/my-*` — scoped endpoints. Worker видит **только свои** данные. Это self-service через агента вместо спрашивания admin'а.

### 8b: Расширение существующих endpoints

| Существующий | Что добавить | Зачем |
|-------------|-------------|-------|
| `POST /api/time-tracking (start)` | `projectRate` override | Per-project hourly rates (§3.2 Payroll spec) |
| `GET /api/time-tracking/summary` | `overtimeHours`, `overtimePremium` | FLSA compliance |
| `GET /api/dashboard/client/:id/summary` | `burdenedLaborCost` | True job cost для менеджеров |
| `POST /api/costs` | `approvalRequired: bool` в response | Расходы >$500 требуют подтверждения |

### 8c: Agent-initiated workflows (callable)

| Workflow | Trigger | Что делает |
|----------|---------|-----------|
| `calculateOvertime` | Agent POST `/api/payroll/calculate-overtime` | Weekly: sum hours → create OT adjustment entries |
| `reconcileBalances` | Agent POST `/api/payroll/reconcile` | Compare cached runningBalance vs actual → flag drifts |
| `weeklyReport` | Agent GET `/api/reports/weekly-summary` | Per-employee hours, earnings, OT, unsigned sessions |
| `anomalyCheck` | Agent POST `/api/payroll/period/:id/validate` | Flags: >60h, >12h session, rate changes, zero hours |

Эти workflows агент может вызывать **по расписанию** (Monday 8 AM — overtime check, Friday 5 PM — weekly summary) или **по запросу** admin'а.

---

## Phase 9: OpenAPI / Swagger документация — TODO

> Источник: `docs/legacy-nov2025/TODO_FUTURE_IMPROVEMENTS.md` §21

**Проблема:** Нет машиночитаемой спецификации API. Каждый агент парсит OPENCLAW_AGENT_GUIDE.md вручную.

**Решение:**
1. Автогенерация OpenAPI 3.0 spec из Zod schemas (библиотека `zod-to-openapi`)
2. Endpoint `GET /api/docs/openapi.json` — машиночитаемая спецификация
3. Swagger UI на `GET /api/docs` — человекочитаемая
4. Agent при первом подключении делает `GET /api/docs/openapi.json` → получает все endpoints + schemas → авто-генерирует Pydantic models

**Файлы:**
- `functions/src/agent/routes/docs.ts` — уже существует (заглушка)
- `zod-to-openapi` → npm install → конвертация schemas

### Пример авто-сгенерированного Pydantic

```python
# Auto-generated from GET /api/docs/openapi.json
class CreateTask(BaseModel):
    title: str
    clientId: Optional[str] = None
    priority: Literal["high", "medium", "low", "none"] = "medium"
    status: Literal["inbox", "next_action", "waiting", ...] = "next_action"
    dueDate: Optional[str] = None
    # ... все поля из Zod schema
```

Это eliminates рассинхрон между Pydantic моделями агента и Zod схемами бэкенда.

---

## Phase 10: Agent Notifications → Telegram/Email — TODO

> Источник: `docs/legacy-nov2025/TODO_FUTURE_IMPROVEMENTS.md` §10

**Проблема:** Сейчас event queue — polling only. Агент узнаёт о событиях с задержкой.

**Решение (staged):**

### 10a: Webhook callbacks (phase 1 — простое)
- Admin регистрирует webhook URL для агента при создании token:
  ```json
  { "webhookUrl": "https://vasya-pc.local:8080/webhook" }
  ```
- При publish event → HTTP POST на webhookUrl (fire-and-forget, 3 retries)
- Агент получает push-уведомление мгновенно

### 10b: Telegram bridge (phase 2)
- Agent events → Telegram сообщение сотруднику (если `telegramId` есть)
- Формат: `"🔔 Task assigned: Отправить счёт Джиму — priority: high"`
- Сотрудник видит в Telegram → агент на компе тоже получает через polling

### 10c: Firebase Cloud Messaging (phase 3 — PWA)
- Web push notification через FCM
- Агент (если запущен как PWA) получает native push
- Самый надёжный канал для desktop-агентов

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

---
---

# ДЕТАЛЬНЫЕ ПЛАНЫ РЕАЛИЗАЦИИ (Phase 4–10)

---

## Phase 4: Детальный план — Scoped queries для всех routes

### 4.1 Текущий аудит scope enforcement

| Route файл | requireScope | Scopes | Data scoping (userId filter) | Endpoints |
|-----------|:--:|--------|:--:|-----------|
| **tasks.ts** | ✅ | `tasks:read/write` | ✅ assigneeId | 5 endpoints |
| **costs.ts** | ✅ | `costs:read/write` | ❌ глобальные запросы | 3 endpoints |
| **timeTracking.ts** | ✅ | `time:read/write` | ✅ partial | 6 endpoints |
| **events.ts** | ✅ | `events:read` | ✅ employeeId | 2 endpoints |
| **agentTokens.ts** | ✅ | admin via requireAdmin() | ✅ admin-only | 4 endpoints |
| **clients.ts** | ❌ | — | ❌ | 5 endpoints |
| **projects.ts** | ❌ | — | ❌ (companyId only) | 8 endpoints |
| **estimates.ts** | ❌ | — | ❌ (companyId only) | 4 endpoints |
| **inventory.ts** | ❌ | — | ❌ | 15 endpoints |
| **erp.ts** | ❌ | — | ❌ (companyId only) | 6 endpoints |
| **dashboard.ts** | ❌ | — | ❌ | 1 endpoint |
| **dashboardClient.ts** | ❌ | — | ❌ (clientId param) | 4 endpoints |
| **finance.ts** | ❌ | — | ❌ | 5 endpoints |
| **users.ts** | ❌ | — | ❌ | 2 endpoints |
| **sites.ts** | ❌ | — | ❌ | 3 endpoints |
| **contacts.ts** | — | — | — | (in users.ts) 2 endpoints |

**Итого: 12 route-файлов без scope enforcement, ~55 endpoints без защиты.**

### 4.2 План добавления scopes (по приоритету)

**Tier 1 (P1 — данные сотрудников):**

| Файл | Добавить import | GET endpoints | Write endpoints |
|------|----------------|---------------|-----------------|
| `costs.ts` | уже есть | Добавить: worker видит только `WHERE userId == agentUserId` | OK (уже scoped) |
| `timeTracking.ts` | уже есть | `active-all`: worker → только свои сессии | `admin-stop`: уже requireScope('admin') |
| `dashboard.ts` | `requireScope` | `GET /api/dashboard`: worker → только свой KPI | — |

**Конкретные изменения для costs.ts scoped query:**
```typescript
// GET /api/costs/list — добавить после line ~130:
const isAdmin = (req.agentScopes || []).includes('admin');
const role = req.agentRole || 'user';
const isManagerOrAbove = ['superadmin', 'company_admin', 'admin', 'manager'].includes(role);

if (!isAdmin && !isManagerOrAbove) {
  q = q.where('userId', '==', req.agentUserId);
}
```

**Tier 2 (P2 — бизнес-данные):**

| Файл | GET scopes | Write scopes | Data scoping |
|------|-----------|-------------|-------------|
| `clients.ts` | `clients:read` | `clients:write` | Все видят клиентов (company-level) |
| `projects.ts` | `projects:read` | `projects:write` | Все видят проекты (company-level) |
| `sites.ts` | `projects:read` | `projects:write` | По clientId из проекта |
| `users.ts` | `admin` (search) | `admin` (create) | Admin-only |
| `contacts.ts` | `clients:read` | `clients:write` | Company-level |

**Tier 3 (P3 — финансы, ERP):**

| Файл | GET scopes | Write scopes | Data scoping |
|------|-----------|-------------|-------------|
| `estimates.ts` | `estimates:read` | `estimates:write` | Company-level |
| `erp.ts` | `erp:read` | `erp:write` | Company-level |
| `inventory.ts` | `inventory:read` | `inventory:write` | Company-level |
| `finance.ts` | `admin` | `admin` | Admin-only (sensitive) |
| `dashboardClient.ts` | `dashboard:read` | — | Company-level |

### 4.3 Шаблон добавления scope к существующему route

```typescript
// 1. Добавить import:
import { requireScope } from '../agentMiddleware';

// 2. Добавить audit imports:
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';

// 3. На каждый GET endpoint:
router.get('/api/XXX/list', requireScope('XXX:read', 'admin'), async (req, res, next) => { ... });

// 4. На каждый POST/PATCH/DELETE endpoint:
router.post('/api/XXX', requireScope('XXX:write', 'admin'), async (req, res, next) => { ... });

// 5. Для worker-scoped data — добавить фильтр:
const isAdmin = (req.agentScopes || []).includes('admin');
const isManager = ['superadmin','company_admin','admin','manager'].includes(req.agentRole || '');
if (!isAdmin && !isManager) {
  q = q.where('createdBy', '==', req.agentUserId); // или assigneeId, userId
}
```

### 4.4 Acceptance criteria Phase 4

- [ ] Все 55+ endpoints имеют `requireScope()` middleware
- [ ] Worker с `tasks:read` токеном получает 403 на `GET /api/costs/list`
- [ ] Worker видит только свои costs (userId filter)
- [ ] Admin token обходит все проверки
- [ ] Тесты: 1 test per route file (scope deny + scope allow + data scoping)
- [ ] Backward compatible: Mode 1 (AGENT_API_KEY) работает как раньше

### 4.5 Effort estimate

- **Tier 1:** 2-3 часа (3 файла, простые изменения)
- **Tier 2:** 3-4 часа (5 файлов, нужно решить какие данные company-level)
- **Tier 3:** 4-5 часов (5 файлов, finance = sensitive, нужны тесты)
- **Тесты:** 4-6 часов (12 test files, по 2-3 теста каждый)
- **ИТОГО:** ~15-18 часов работы

---

## Phase 5: Детальный план — Event Queue расширение

### 5a: Firestore triggers → event queue

**Текущее состояние:** события публикуются ТОЛЬКО из API routes (tasks.ts, costs.ts, timeTracking.ts). Telegram бот и Firestore triggers НЕ публикуют.

**Нужно подключить:**

| Trigger | Файл | Событие | Приоритет |
|---------|------|---------|-----------|
| `onTaskCreate` | `functions/src/triggers/onTaskCreate.ts` (новый) | `task.created` | P1 |
| `onWorkSessionUpdate` | `functions/src/triggers/onWorkSessionUpdate.ts` (существующий?) | `session.stopped` | P1 |
| Telegram bot start/stop | `handlers/selfServiceHandler.ts` | `session.started/stopped` source='bot' | P1 |
| `onCostCreated` | Новый или существующий trigger | `cost.created` | P2 |
| `onEstimateUpdated` | Новый trigger | `estimate.approved/rejected` | P2 |
| `onProjectStatusChange` | Новый trigger | `project.completed` | P3 |

**Реализация для Telegram бота:**

```typescript
// В selfServiceHandler.ts после createSession:
import { publishSessionEvent } from '../../agent/utils/eventPublisher';

// После успешного создания сессии через бота:
publishSessionEvent('started', sessionRef.id, 
  `Timer started via bot: ${taskTitle}`,
  { taskTitle, clientId, source: 'bot' },
  firebaseUid // или telegramId → resolve to UID
);
```

**⚠️ Idempotency guard для triggers:**

```typescript
// Каждый trigger ОБЯЗАН проверять:
const eventKey = `${context.eventId}_${context.eventType}`;
const processed = await db.doc(`_processedEvents/${eventKey}`).get();
if (processed.exists) return null; // Already processed

// ... publish event ...

await db.doc(`_processedEvents/${eventKey}`).set({
  processedAt: FieldValue.serverTimestamp(),
  expiresAt: Date.now() + 24 * 3600_000,
});
```

### 5b: Cleanup scheduled function

```typescript
// functions/src/scheduled/cleanupAgentEvents.ts
// Schedule: every 24 hours (3 AM ET)

export const cleanupAgentEvents = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .pubsub.schedule('0 3 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const now = Timestamp.now();
    const expiredQuery = db.collection('agent_events')
      .where('expiresAt', '<', now)
      .limit(500);
    
    let totalDeleted = 0;
    let batch = db.batch();
    let count = 0;
    
    while (true) {
      const snap = await expiredQuery.get();
      if (snap.empty) break;
      
      snap.docs.forEach(doc => {
        batch.delete(doc.ref);
        count++;
      });
      
      await batch.commit();
      totalDeleted += count;
      batch = db.batch();
      count = 0;
      
      if (snap.docs.length < 500) break; // No more
    }
    
    logger.info(`🧹 cleanupAgentEvents: deleted ${totalDeleted} expired events`);
  });
```

**Также:** cleanup для `_processedEvents` и `_idempotency` (TTL 24h):

```typescript
// В том же scheduled function:
const expiredIdempotency = db.collection('_idempotency')
  .where('expiresAt', '<', Date.now())
  .limit(500);
// ... batch delete ...
```

### 5c: Расширение типов событий

**Новые publishEventX() helpers:**

```typescript
// eventPublisher.ts — добавить:
export function publishEstimateEvent(action, estimateId, summary, data, employeeId)
export function publishProjectEvent(action, projectId, summary, data, employeeId)
export function publishInventoryEvent(action, entityId, summary, data, employeeId)
export function publishPayrollEvent(action, periodId, summary, data, employeeId)
```

### 5d: Acceptance criteria Phase 5

- [ ] Telegram бот публикует events при start/stop через бота
- [ ] Firestore trigger на `work_sessions` публикует session events
- [ ] Cleanup удаляет expired events ежедневно
- [ ] Cleanup удаляет expired `_processedEvents` и `_idempotency`
- [ ] Все triggers имеют idempotency guard
- [ ] `GET /api/events/types` отражает новые типы
- [ ] Нет infinite loops (trigger → event → trigger)

### 5e: Effort estimate

- **Triggers (5a):** 4-6 часов
- **Cleanup (5b):** 2 часа
- **Event expansion (5c):** 2 часа
- **Testing:** 3-4 часа
- **ИТОГО:** ~12-14 часов

---

## Phase 6: Детальный план — Python Agent SDK

### 6.1 Package структура

```
profit-step-agent/
├── pyproject.toml
├── README.md
├── profit_step_agent/
│   ├── __init__.py
│   ├── client.py          # CRMClient — HTTP клиент
│   ├── auth.py             # Token management
│   ├── models/
│   │   ├── __init__.py
│   │   ├── tasks.py        # Task, CreateTask, UpdateTask, ListTasksParams
│   │   ├── time.py         # Session, StartSession, StopSession, TimeSummary
│   │   ├── costs.py        # Cost, CreateCost, ListCostsParams
│   │   ├── events.py       # Event, EventQuery
│   │   ├── clients.py      # Client, CreateClient, SearchParams
│   │   ├── projects.py     # Project, CreateProject
│   │   ├── estimates.py    # Estimate, CreateEstimate
│   │   └── common.py       # Pagination, ErrorResponse, SortDir
│   ├── domains/
│   │   ├── __init__.py
│   │   ├── tasks.py        # TasksDomain — .list(), .create(), .update(), .delete()
│   │   ├── time.py         # TimeDomain — .start(), .stop(), .status(), .summary()
│   │   ├── costs.py        # CostsDomain — .list(), .create(), .void()
│   │   ├── events.py       # EventsDomain — .poll(), .stream(), .types()
│   │   ├── clients.py      # ClientsDomain
│   │   └── projects.py     # ProjectsDomain
│   ├── exceptions.py       # CRMError, ValidationError, ScopeError, RateLimitError
│   └── cli.py              # CLI entry point
└── tests/
    ├── test_client.py
    ├── test_tasks.py
    └── conftest.py
```

### 6.2 Core Client

```python
# profit_step_agent/client.py
import httpx
from typing import Optional

class CRMClient:
    """HTTP client for Profit Step CRM API."""
    
    def __init__(
        self,
        token: str,
        base_url: str = "https://profit-step.web.app/api",
        timeout: float = 30.0,
        max_retries: int = 3,
    ):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=timeout,
        )
        self._max_retries = max_retries
    
    def get(self, path: str, params: dict = None) -> dict:
        return self._request("GET", path, params=params)
    
    def post(self, path: str, json: dict = None) -> dict:
        return self._request("POST", path, json=json)
    
    def patch(self, path: str, json: dict = None) -> dict:
        return self._request("PATCH", path, json=json)
    
    def delete(self, path: str) -> dict:
        return self._request("DELETE", path)
    
    def _request(self, method, path, **kwargs) -> dict:
        for attempt in range(self._max_retries):
            resp = self._client.request(method, path, **kwargs)
            if resp.status_code == 429:
                retry_after = resp.json().get("retryAfterMs", 5000) / 1000
                time.sleep(retry_after)
                continue
            if resp.status_code == 503:
                time.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            return resp.json()
        raise CRMError("Max retries exceeded")
```

### 6.3 Domain example (Tasks)

```python
# profit_step_agent/domains/tasks.py
from ..models.tasks import Task, CreateTask, UpdateTask, ListTasksParams
from ..client import CRMClient

class TasksDomain:
    def __init__(self, client: CRMClient):
        self._client = client
    
    def list(self, *, status: str = None, client_name: str = None, 
             priority: str = None, limit: int = 50) -> list[Task]:
        params = ListTasksParams(status=status, clientName=client_name, 
                                  priority=priority, limit=limit)
        resp = self._client.get("/api/gtd-tasks/list", params=params.to_query())
        return [Task(**t) for t in resp["tasks"]]
    
    def create(self, *, title: str, client_id: str = None, 
               priority: str = "medium", **kwargs) -> str:
        data = CreateTask(title=title, clientId=client_id, priority=priority, **kwargs)
        resp = self._client.post("/api/gtd-tasks", json=data.model_dump(exclude_none=True))
        return resp["taskId"]
    
    def update(self, task_id: str, **fields) -> bool:
        data = UpdateTask(**fields)
        resp = self._client.patch(f"/api/gtd-tasks/{task_id}", json=data.model_dump(exclude_none=True))
        return resp.get("updated", False)
    
    def complete(self, task_id: str) -> bool:
        return self.update(task_id, status="done")
```

### 6.4 Event streaming

```python
# profit_step_agent/domains/events.py
import asyncio
from datetime import datetime, timezone

class EventsDomain:
    def __init__(self, client):
        self._client = client
    
    def poll(self, since: str, types: list[str] = None, limit: int = 50) -> list[dict]:
        params = {"since": since, "limit": limit}
        if types:
            params["types"] = ",".join(types)
        return self._client.get("/api/events", params=params)["events"]
    
    async def stream(self, types: list[str] = None, 
                     interval: float = 15.0,
                     since: str = None):
        """Async generator — yields events as they arrive."""
        cursor = since or datetime.now(timezone.utc).isoformat()
        while True:
            events = self.poll(cursor, types=types)
            for event in events:
                yield event
                cursor = event["createdAt"]
            await asyncio.sleep(interval)
```

### 6.5 Main CRMAgent class

```python
# profit_step_agent/__init__.py
from .client import CRMClient
from .domains.tasks import TasksDomain
from .domains.time import TimeDomain
from .domains.costs import CostsDomain
from .domains.events import EventsDomain
from .domains.clients import ClientsDomain

class CRMAgent:
    """Main entry point for Profit Step CRM integration."""
    
    def __init__(self, token: str, base_url: str = "https://profit-step.web.app/api"):
        self._client = CRMClient(token=token, base_url=base_url)
        self.tasks = TasksDomain(self._client)
        self.time = TimeDomain(self._client)
        self.costs = CostsDomain(self._client)
        self.events = EventsDomain(self._client)
        self.clients = ClientsDomain(self._client)
    
    def health(self) -> dict:
        return self._client.get("/api/health")
```

### 6.6 CLI tool

```bash
# Installation:
pip install profit-step-agent

# Setup:
psa auth setup --token <your-40-hex-token>
psa auth test  # → "✅ Connected as Vasya (worker)"

# Usage:
psa tasks list --status next_action
psa tasks create "Fix wiring at Site B" --client "Farmer's Milk" --priority high
psa time start --client "Farmer's Milk" --task "Fix wiring"
psa time stop
psa time status
psa costs add --amount 150 --category materials --client "Farmer's Milk"
psa events watch --types task,session  # live stream
```

### 6.7 Effort estimate

- **Core client + auth:** 4 часа
- **Pydantic models (all domains):** 6 часов
- **Domain classes (7 domains):** 8 часов
- **Event streaming:** 3 часа
- **CLI:** 4 часа
- **Tests:** 6 часов
- **Packaging + docs:** 3 часа
- **ИТОГО:** ~34 часа

---

## Phase 7: Детальный план — Bot ↔ Agent Conflict Resolution

### 7.1 Sequence Diagram: Current Problem

```
Telegram Bot                 Firestore                Agent API
    │                           │                         │
    │  getActiveSession(tgId)   │                         │
    │ ─────────────────────────>│                         │
    │  ← null (no active)      │                         │
    │                           │  resolveEmployeeIds(uid)│
    │                           │<────────────────────────│
    │                           │  ← null (no active)     │
    │  .add({empId: tgId})     │                         │
    │ ─────────────────────────>│                         │
    │  ← sessionA created      │                         │
    │                           │  .add({empId: uid})     │
    │                           │<────────────────────────│
    │                           │  ← sessionB created     │
    │                           │                         │
    │  ⚠️ TWO ACTIVE SESSIONS  │  ⚠️ CONFLICT           │
```

### 7.2 Sequence Diagram: After Fix

```
Telegram Bot                 Firestore                Agent API
    │                           │                         │
    │  resolve(tgId → uid)     │                         │
    │ ─────────────────────────>│                         │
    │  ← uid                   │                         │
    │                           │                         │
    │  runTransaction {         │                         │
    │    check lock             │                         │
    │    check active(uid)      │                         │
    │    set lock               │                         │
    │    .add({empId: uid})     │                         │
    │  }                        │                         │
    │ ─────────────────────────>│                         │
    │  ← sessionA (uid)        │                         │
    │  publishEvent(started)   │                         │
    │ ─────────────────────────>│                         │
    │                           │                         │
    │                           │  resolveEmployeeIds(uid)│
    │                           │<────────────────────────│
    │                           │  ← sessionA found!      │
    │                           │  auto-close + new       │
    │                           │  publishEvent(stopped)  │
    │                           │<────────────────────────│
    │  [receives event: stopped]│                         │
    │  notify user via Telegram │                         │
```

### 7.3 Конкретные изменения

**7.3a: `onWorkerBotMessage.ts` — initWorkSession → transaction**

```typescript
// Текущий код (упрощённо):
async function initWorkSession(telegramId, ...) {
  const existing = await getActiveSession(telegramId); // ← Race window!
  if (existing) await closeSession(existing);
  const ref = await db.collection('work_sessions').add({...}); // ← No transaction!
}

// Новый код:
async function initWorkSession(firebaseUid, telegramId, ...) {
  return db.runTransaction(async (tx) => {
    // 1. Check lock
    const lockRef = db.doc(`users/${firebaseUid}`);
    const lockDoc = await tx.get(lockRef);
    const lock = lockDoc.data()?.activeSessionLock;
    if (lock && Date.now() - lock.timestamp < 60_000) {
      throw new Error('Session start in progress from another source');
    }
    
    // 2. Set lock
    tx.update(lockRef, { activeSessionLock: { source: 'bot', timestamp: Date.now() } });
    
    // 3. Find active sessions (ALL employee IDs)
    const ids = [firebaseUid, telegramId, String(telegramId)];
    for (const id of ids) {
      const active = await db.collection('work_sessions')
        .where('employeeId', '==', id)
        .where('status', '==', 'active')
        .limit(1).get();
      if (!active.empty) {
        // Close existing within transaction
        tx.update(active.docs[0].ref, { status: 'completed', endTime: Timestamp.now() });
      }
    }
    
    // 4. Create new session with Firebase UID (не telegramId!)
    const ref = db.collection('work_sessions').doc();
    tx.set(ref, {
      employeeId: firebaseUid,  // ← Единый формат!
      telegramId: telegramId,   // ← Для обратного lookup
      status: 'active',
      ...sessionData,
    });
    
    // 5. Clear lock, set activeSessionId
    tx.update(lockRef, { 
      activeSessionId: ref.id,
      activeSessionLock: null,
    });
    
    return ref.id;
  });
}
```

**⚠️ ВАЖНО:** Это изменение в `onWorkerBotMessage.ts` (1200+ строк, живой бот). Нужны:
1. Полное юнит-тестирование с mock Firestore
2. Тестирование в emulators
3. Деплой в off-peak (ночью)
4. Мониторинг первые 48ч

**7.3b: employeeId migration script**

```typescript
// scripts/migrateEmployeeIds.ts
// One-time batch: work_sessions where employeeId is number → resolve to Firebase UID

const sessions = await db.collection('work_sessions')
  .where('employeeId', '>=', 0)  // numeric telegramId
  .get();

const batch = db.batch();
for (const doc of sessions.docs) {
  const tgId = doc.data().employeeId;
  // Lookup users collection for telegramId mapping
  const user = await db.collection('users')
    .where('telegramId', '==', tgId)
    .limit(1).get();
  
  if (!user.empty) {
    batch.update(doc.ref, {
      employeeId: user.docs[0].id,      // Firebase UID
      telegramId: tgId,                   // Preserve original
      _migratedEmployeeId: true,
    });
  }
}
await batch.commit();
```

### 7.4 Acceptance criteria Phase 7

- [ ] Bot создаёт сессии с Firebase UID (не telegramId)
- [ ] Bot использует `runTransaction()` для создания сессий
- [ ] Lock-документ предотвращает одновременный старт
- [ ] Bot публикует events в agent_events
- [ ] Migration script выполнен для существующих сессий
- [ ] Cross-notification: API closes bot session → Telegram message
- [ ] Тесты: unit tests для transaction logic, mock Firestore
- [ ] 48ч мониторинг после деплоя

### 7.5 Effort estimate

- **Transaction rewrite (7.3a):** 8-10 часов (sensitive code, нужна осторожность)
- **Migration script (7.3b):** 2 часа
- **Event publish from bot:** 3 часа
- **Cross-notification:** 4 часа
- **Lock mechanism:** 3 часа
- **Unit tests:** 6-8 часов
- **Emulator testing + deploy:** 3 часа
- **ИТОГО:** ~30-34 часа

---

## Phase 8: Детальный план — Payroll API Endpoints

### 8.1 Текущее состояние payroll

**Уже реализовано:**
- `generateDailyPayroll.ts` — ежедневно 4 AM, создаёт `payroll_ledger` entries
- `reconcileBalances.ts` — еженедельно Sun 2 AM, проверяет `runningBalance`
- `closePayrollPeriod.ts` — callable, закрывает период
- `selfServiceHandler.ts` — Telegram команды `/myweek`, `/mybalance`, `/myhours`, `/mypay`
- Коллекции: `payroll_periods`, `payroll_ledger`, `work_sessions`, `advance_accounts`

**Не реализовано:**
- ❌ API endpoints для self-service (агент не может запросить данные)
- ❌ FLSA overtime auto-calculation
- ❌ Per-project hourly rates
- ❌ Anomaly detection endpoint
- ❌ CSV/PDF export

### 8.2 Новые endpoints — Zod schemas

```typescript
// functions/src/agent/schemas/payrollSchemas.ts

export const MyBalanceQuerySchema = z.object({
  // Никаких параметров — данные привязаны к req.agentUserId
}).strict();

export const MyHoursQuerySchema = z.object({
  weekOf: z.string().optional(), // ISO date, default = current week (Monday)
}).strict();

export const MyPayQuerySchema = z.object({
  period: z.string().optional(), // "2026-03", default = last closed period
}).strict();

export const OvertimeCheckQuerySchema = z.object({
  weekOf: z.string().optional(), // ISO date, default = current week
}).strict();

export const PeriodValidateSchema = z.object({
  checks: z.array(z.enum([
    'hours_over_60',
    'session_over_12h', 
    'rate_changes',
    'zero_hours',
    'duplicate_sessions',
    'unsigned_sessions',
  ])).optional(), // default = all checks
}).strict();

export const PeriodExportSchema = z.object({
  format: z.enum(['csv', 'json']).default('json'),
  includeDetails: z.boolean().default(false), // include per-session breakdown
}).strict();
```

### 8.3 Endpoint specifications

#### `GET /api/payroll/my-balance`
**Scope:** `time:read` | **Data:** self-only

```json
// Response:
{
  "employeeId": "uid123",
  "employeeName": "Vasya",
  "ytdEarned": 15430.00,
  "ytdPaid": 14200.00,
  "balance": 1230.00,
  "pendingPO": 350.00,    // advance_accounts balance
  "netBalance": 880.00,   // balance - pendingPO
  "lastPayment": {
    "amount": 2800.00,
    "date": "2026-04-01T00:00:00Z",
    "method": "check"
  },
  "currentPeriod": "2026-04",
  "periodStatus": "open"
}
```

**Реализация:** Query `users/{uid}` для `runningBalance`, `ytdEarned`, `ytdPaid` + `advance_accounts` для PO balance.

#### `GET /api/payroll/my-hours`
**Scope:** `time:read` | **Data:** self-only

```json
// Response:
{
  "weekOf": "2026-04-06",  // Monday
  "totalHours": 38.5,
  "overtimeHours": 0,
  "days": [
    { "date": "2026-04-06", "hours": 8.0, "sessions": 1, "projects": ["Farmer's Milk"] },
    { "date": "2026-04-07", "hours": 7.5, "sessions": 1, "projects": ["ABC Manufacturing"] },
    { "date": "2026-04-08", "hours": 8.0, "sessions": 2, "projects": ["Farmer's Milk", "Johnson"] },
    { "date": "2026-04-09", "hours": 7.5, "sessions": 1, "projects": ["ABC Manufacturing"] },
    { "date": "2026-04-10", "hours": 7.5, "sessions": 1, "projects": ["Farmer's Milk"] }
  ],
  "earnings": {
    "regular": 962.50,
    "overtime": 0,
    "total": 962.50
  },
  "warnings": []  // ["⚠️ Approaching 40h overtime threshold"] if hours > 35
}
```

#### `GET /api/payroll/my-pay`
**Scope:** `time:read` | **Data:** self-only

```json
// Response:
{
  "period": "2026-03",
  "periodStatus": "paid",
  "gross": 3850.00,
  "regularHours": 152.0,
  "overtimeHours": 8.0,
  "regularPay": 3800.00,
  "overtimePay": 300.00,
  "deductions": {
    "advances": 200.00,
    "other": 0
  },
  "net": 3650.00,
  "payments": [
    { "date": "2026-03-15", "amount": 1800.00, "method": "check" },
    { "date": "2026-04-01", "amount": 1850.00, "method": "check" }
  ]
}
```

#### `GET /api/payroll/overtime-check` (admin)
**Scope:** `admin` | **Data:** all employees

```json
// Response:
{
  "weekOf": "2026-04-06",
  "employees": [
    {
      "employeeId": "uid123",
      "name": "Vasya",
      "hoursThisWeek": 42.5,
      "overtimeHours": 2.5,
      "overtimeCost": 93.75,
      "status": "over_threshold",
      "projects": ["Farmer's Milk", "Johnson"]
    },
    {
      "employeeId": "uid456", 
      "name": "Petya",
      "hoursThisWeek": 38.0,
      "overtimeHours": 0,
      "status": "approaching",  // > 35h
      "projects": ["ABC Manufacturing"]
    }
  ],
  "summary": {
    "totalOvertime": 2.5,
    "totalOvertimeCost": 93.75,
    "employeesOverThreshold": 1,
    "employeesApproaching": 1
  }
}
```

#### `POST /api/payroll/period/:id/validate` (admin)
**Scope:** `admin` | **Callable: pre-close validation**

```json
// Request body:
{ "checks": ["hours_over_60", "session_over_12h", "rate_changes"] }

// Response:
{
  "period": "2026-03",
  "valid": false,
  "anomalies": [
    {
      "type": "session_over_12h",
      "severity": "warning",
      "employeeId": "uid789",
      "employeeName": "Kolya",
      "details": "Session sess123: 14.5 hours on 2026-03-15",
      "sessionId": "sess123"
    },
    {
      "type": "hours_over_60",
      "severity": "error",
      "employeeId": "uid789",
      "employeeName": "Kolya",
      "details": "Week of 2026-03-11: 63.5 hours",
      "weekOf": "2026-03-11"
    }
  ],
  "stats": {
    "totalSessions": 245,
    "totalHours": 1230.5,
    "employees": 12,
    "anomalyCount": 2
  }
}
```

### 8.4 Новые scopes

Добавить в `agentTokenSchemas.ts`:

```typescript
// Добавить в ScopeEnum:
'payroll:read',   // my-balance, my-hours, my-pay (self-only)
'payroll:write',  // admin: close period, validate, export
```

### 8.5 Effort estimate

- **Schemas:** 2 часа
- **my-balance, my-hours, my-pay:** 6 часов (3 endpoints, query payroll_ledger + work_sessions)
- **overtime-check:** 4 часа (aggregate across employees, weekly window)
- **period validate:** 6 часов (complex anomaly detection logic)
- **period export (CSV):** 4 часа
- **Tests:** 6 часов
- **ИТОГО:** ~28-30 часов

---

## Phase 9: Детальный план — OpenAPI Auto-Documentation

### 9.1 Подход

```bash
npm install zod-to-openapi swagger-ui-express --save --prefix functions
```

### 9.2 Регистрация schemas

```typescript
// functions/src/agent/routes/docs.ts
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as schemas from '../schemas';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// Register all schemas
registry.registerPath({
  method: 'post',
  path: '/api/gtd-tasks',
  request: { body: { content: { 'application/json': { schema: schemas.CreateGTDTaskSchema } } } },
  responses: { 201: { description: 'Task created' } },
});
// ... repeat for all endpoints

// Generate spec
const generator = new OpenApiGeneratorV3(registry.definitions);
const spec = generator.generateDocument({
  openapi: '3.0.0',
  info: { title: 'Profit Step CRM API', version: '2.0.0' },
  servers: [{ url: 'https://profit-step.web.app' }],
});

router.get('/api/docs/openapi.json', (_req, res) => res.json(spec));
```

### 9.3 Effort estimate

- **Setup + registration:** 8 часов (62+ endpoints to register)
- **Swagger UI:** 2 часа
- **Testing:** 2 часа
- **ИТОГО:** ~12 часов

---

## Phase 10: Детальный план — Push Notifications

### 10.1 Webhook registration

Добавить поле в `agent_tokens`:

```typescript
{
  ...existingFields,
  webhookUrl: string | null,  // "https://vasya-pc:8080/webhook"
  webhookSecret: string | null, // HMAC-SHA256 signing key
  webhookEvents: string[] | null, // ["task.assigned", "alert.*"]
}
```

### 10.2 Webhook delivery

```typescript
// functions/src/agent/utils/webhookDelivery.ts
export async function deliverWebhook(tokenDoc, event) {
  const { webhookUrl, webhookSecret, webhookEvents } = tokenDoc;
  if (!webhookUrl) return;
  
  // Check event filter
  const eventKey = `${event.type}.${event.action}`;
  if (webhookEvents && !webhookEvents.some(p => matchPattern(p, eventKey))) return;
  
  // Sign payload
  const payload = JSON.stringify(event);
  const signature = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
  
  // Deliver (3 retries, exponential backoff)
  for (let i = 0; i < 3; i++) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Event-Type': eventKey,
        },
        body: payload,
      });
      return; // Success
    } catch (e) {
      await sleep(1000 * 2 ** i);
    }
  }
  logger.warn('Webhook delivery failed after 3 retries', { webhookUrl, eventType: eventKey });
}
```

### 10.3 Telegram bridge

```typescript
// При publish event → если сотрудник имеет telegramId:
const user = await db.doc(`users/${event.employeeId}`).get();
const tgId = user.data()?.telegramId;
if (tgId) {
  await bot.sendMessage(tgId, formatEventForTelegram(event));
}
```

### 10.4 Effort estimate

- **Webhook registration (schema + API):** 4 часа
- **Webhook delivery + retry:** 6 часов
- **Telegram bridge:** 4 часа
- **FCM (PWA push):** 8 часов
- **Tests:** 4 часа
- **ИТОГО:** ~26 часов

---

## Тест-план

### Unit Tests (по фазам)

| Phase | Test file | Tests | Что проверяем |
|-------|-----------|-------|---------------|
| 1 | `agentTokens.test.ts` | 8 | CRUD: create/list/revoke/rotate, 401 non-admin, token format, expiry |
| 2 | `scopeMiddleware.test.ts` | 10 | requireScope allow/deny, admin bypass, combined scopes, Mode 1/2/3 |
| 3 | `events.test.ts` | 6 | Poll with since, types filter, scoped (admin vs worker), empty result |
| 4 | `scopedRoutes.test.ts` | 24 | 2 tests × 12 routes (scope deny + data scoping) |
| 5 | `eventPublisher.test.ts` | 8 | Trigger events, idempotency, cleanup |
| 7 | `botTransaction.test.ts` | 10 | Transaction: lock, double-start, cross-platform, migration |
| 8 | `payroll.test.ts` | 12 | my-balance, my-hours, my-pay, overtime, validate, export |

### Integration Tests

| Scenario | Что проверяем |
|----------|---------------|
| Worker agent lifecycle | Create token → start timer → create task → poll events → stop timer |
| Admin manages team | Create 3 tokens → list → revoke 1 → verify 401 on revoked |
| Bot + API coexistence | Bot starts session → API polls events → sees bot session |
| Scope escalation attempt | Worker token → try admin endpoint → 403 |
| Token rotation | Create → use → rotate → old token 401 → new token 200 |
| Event expiry | Create event → wait TTL → cleanup → event gone |

### Load Tests (Artillery)

```yaml
# tests/load/multi-agent.yml
phases:
  - duration: 60
    arrivalRate: 20  # 20 agents connecting simultaneously

scenarios:
  - name: "Agent polling loop"
    flow:
      - get:
          url: "/api/events?since=2026-01-01T00:00:00Z"
          headers:
            Authorization: "Bearer {{ $randomToken }}"
      - get:
          url: "/api/gtd-tasks/list?status=next_action"
      - think: 15  # 15 sec polling interval
```

---

## Timeline (рекомендуемый)

| Неделя | Phase | Задачи | Часы |
|--------|-------|--------|------|
| **W1** | Phase 4 Tier 1 | Scope enforcement: costs, timeTracking, dashboard | 8h |
| **W1** | Phase 4 Tier 2 | Scope enforcement: clients, projects, sites, users, contacts | 10h |
| **W2** | Phase 4 Tier 3 | Scope enforcement: estimates, erp, inventory, finance, dashboardClient | 10h |
| **W2** | Phase 4 Tests | Unit tests for scoped routes | 6h |
| **W3** | Phase 5 | Event triggers + cleanup + expansion | 14h |
| **W4** | Phase 8 P1 | my-balance, my-hours, my-pay endpoints | 12h |
| **W5** | Phase 8 P2 | overtime-check, period validate, export | 14h |
| **W6** | Phase 7 | Bot transaction rewrite + migration + cross-notification | 30h |
| **W7-8** | Phase 6 | Python SDK | 34h |
| **W9** | Phase 9 | OpenAPI docs | 12h |
| **W10** | Phase 10 | Webhooks + Telegram bridge | 26h |

**Общий estimate:** ~176 часов = 22 рабочих дня = ~5 недель при full-time

### Приоритеты (если ресурсов мало)

1. **P0 (must):** Phase 4 — без этого worker-токены видят всё → security issue
2. **P1 (should):** Phase 8 (payroll self-service) — workers спрашивают каждый день
3. **P1 (should):** Phase 5 (events from bot) — без этого агенты не видят bot-сессии
4. **P2 (nice):** Phase 7 (bot conflicts) — редкие race conditions, есть cron cleanup
5. **P2 (nice):** Phase 6 (SDK) — ускоряет разработку агентов, но не блокирует
6. **P3 (later):** Phase 9 (OpenAPI) — удобство, не функционал
7. **P3 (later):** Phase 10 (webhooks) — polling работает, push = оптимизация

---

## Глоссарий

| Термин | Значение |
|--------|----------|
| **Mode 1** | Auth через `AGENT_API_KEY` env variable (legacy admin) |
| **Mode 2** | Auth через Firebase JWT token (web/mobile UI) |
| **Mode 3** | Auth через per-employee 40-hex agent token |
| **Scope** | Granular permission (e.g. `tasks:read`) attached to token |
| **Scoped query** | Firestore query filtered by `req.agentUserId` for non-admin |
| **Event queue** | `agent_events` collection, polled via `GET /api/events` |
| **Fire-and-forget** | Async write без await — не блокирует response |
| **Idempotency key** | Client-provided key to prevent duplicate creates |
| **TTL** | Time-to-live — auto-expiry of events (7d), tokens (90d) |
| **RBAC** | Role-Based Access Control |
| **FLSA** | Fair Labor Standards Act (US overtime law: >40h/week = 1.5x) |
| **Burdened cost** | Labor cost × burden multiplier (insurance, taxes, etc.) |
