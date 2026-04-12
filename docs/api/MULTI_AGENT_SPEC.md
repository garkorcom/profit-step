# ТЗ: Мульти-агентная инфраструктура CRM Profit Step

> Статус: Phase 1-3 SHIPPED (2026-04-11), Phase 4-6 TODO
> Автор: Денис + Claude Code
> Задача: каждый сотрудник имеет персонального AI-агента на своём компьютере

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
