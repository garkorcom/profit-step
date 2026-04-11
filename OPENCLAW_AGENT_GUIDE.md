# OpenClaw Agent — Полное руководство по созданию агента для CRM Profit Step

> Этот документ — пошаговая инструкция для AI-агента или разработчика, который создаёт
> OpenClaw-агент (LangGraph / LangChain / любой Function Calling агент) для работы с CRM.
> Содержит: архитектуру, авторизацию, все 62 эндпоинта, схемы данных, бизнес-правила и примеры.

---

## 1. Обзор архитектуры

```
┌──────────────────────┐       HTTPS (Bearer token)       ┌───────────────────────────┐
│   OpenClaw Agent     │ ──────────────────────────────▶   │  Firebase Cloud Function   │
│   (Python/LangGraph) │                                   │  agentApi (Express 4.2)    │
│                      │  ◀────────────────────────────    │  62 endpoints, Zod valid.  │
│  Pydantic models     │       JSON responses              │  Firestore backend         │
└──────────────────────┘                                   └───────────────────────────┘
        │                                                           │
        │  Function Calling                                         │  Firestore Admin SDK
        ▼                                                           ▼
┌──────────────────────┐                                   ┌───────────────────────────┐
│  LLM (Claude/GPT)    │                                   │  Firestore Database        │
│  Tool Use / FC       │                                   │  40+ collections           │
└──────────────────────┘                                   └───────────────────────────┘
```

**Принцип «Зеркальной типизации»:**
- **Агент** (Python) — `Pydantic` модели для каждого tool (строгая типизация параметров Function Calling)
- **Бэкенд** (TypeScript) — `Zod` схемы для каждого эндпоинта (зеркальная валидация)
- При ошибке валидации бэкенд возвращает `400` с деталями → агент делает **самокоррекцию**

---

## 2. Быстрый старт

### 2.1. Структура файлов агента

```
~/.openclaw/agents/profit_step/
├── agent.py                 # Главный агент (LangGraph / ReAct)
├── config.py                # URL, API key, настройки
├── models/
│   ├── client.py            # Pydantic: CreateClient, UpdateClient, ClientSearch
│   ├── task.py              # Pydantic: CreateTask, UpdateTask, ListTasks
│   ├── project.py           # Pydantic: CreateProject, ListProjects
│   ├── cost.py              # Pydantic: CreateCost, ListCosts
│   ├── time_tracking.py     # Pydantic: StartSession, StopSession
│   ├── estimate.py          # Pydantic: CreateEstimate
│   ├── inventory.py         # Pydantic: Warehouses, Items, Transactions
│   ├── erp.py               # Pydantic: ChangeOrder, PurchaseOrder
│   └── user.py              # Pydantic: SearchUser
├── tools/
│   ├── search_client.py     # Tool: fuzzy search клиента
│   ├── create_task.py        # Tool: создание задачи
│   ├── track_time.py         # Tool: start/stop сессии
│   ├── add_cost.py           # Tool: добавление расхода
│   ├── manage_inventory.py   # Tool: склад, материалы
│   └── ...                   # По одному tool на бизнес-операцию
└── utils/
    ├── api_client.py         # HTTP клиент с retry + error parsing
    └── error_handler.py      # Парсинг Zod ошибок → строка для LLM
```

### 2.2. Конфигурация

```python
# config.py
import os

API_BASE_URL = "https://us-central1-profit-step.cloudfunctions.net/agentApi/api"
# Или через Firebase Hosting rewrite:
# API_BASE_URL = "https://profit-step.web.app/api"

API_KEY = os.environ["PROFIT_STEP_API_KEY"]  # Bearer token

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

# Rate limit: 60 requests per 60 seconds per user
# Idempotency: POST-запросы поддерживают header X-Idempotency-Key
```

### 2.3. HTTP клиент с обработкой ошибок

```python
# utils/api_client.py
import httpx
from typing import Any

from config import API_BASE_URL, HEADERS


class CRMClient:
    def __init__(self):
        self.client = httpx.Client(base_url=API_BASE_URL, headers=HEADERS, timeout=30)

    def get(self, path: str, params: dict | None = None) -> dict:
        resp = self.client.get(path, params=params)
        return self._handle(resp)

    def post(self, path: str, data: dict, idempotency_key: str | None = None) -> dict:
        headers = {}
        if idempotency_key:
            headers["X-Idempotency-Key"] = idempotency_key
        resp = self.client.post(path, json=data, headers=headers)
        return self._handle(resp)

    def patch(self, path: str, data: dict) -> dict:
        resp = self.client.patch(path, json=data)
        return self._handle(resp)

    def delete(self, path: str) -> dict:
        resp = self.client.delete(path)
        return self._handle(resp)

    def _handle(self, resp: httpx.Response) -> dict:
        if resp.status_code == 429:
            retry_after = resp.json().get("retryAfterMs", 5000)
            return {"error": f"Rate limited. Retry after {retry_after}ms"}

        if resp.status_code == 400:
            # Zod validation error — return details for LLM self-correction
            body = resp.json()
            if "validationErrors" in body:
                errors = "; ".join(
                    f"{e['path']}: {e['message']}" for e in body["validationErrors"]
                )
                return {"error": f"Validation failed: {errors}"}
            return {"error": body.get("error", "Bad request")}

        if resp.status_code >= 400:
            return {"error": f"HTTP {resp.status_code}: {resp.text}"}

        return resp.json()


crm = CRMClient()
```

---

## 3. Авторизация

### Два режима аутентификации

| Режим | Когда использовать | Header |
|-------|-------------------|--------|
| **Static API Key** | Server-to-server (OpenClaw агент) | `Authorization: Bearer <AGENT_API_KEY>` |
| **Firebase JWT** | Браузер / внутренние сервисы | `Authorization: Bearer <firebase_id_token>` |

**Static API Key** берётся из переменной окружения Firebase:
```bash
firebase functions:secrets:set AGENT_API_KEY
# или в functions/.env:
AGENT_API_KEY=your-secret-key-here
```

При использовании Static API Key все действия выполняются от имени владельца (`OWNER_UID` / `OWNER_DISPLAY_NAME` из env).

### Публичные эндпоинты (без авторизации)

| Эндпоинт | Назначение |
|-----------|-----------|
| `GET /api/health` | Health check |
| `GET /api/portal/:slug` | Клиентский портал (token в query params) |
| `POST /api/portal/:slug/approve` | Подтверждение estimate клиентом |
| `POST /api/portal/:slug/comment` | Комментарий клиента |

---

## 4. Полный каталог API эндпоинтов

### 4.1. Clients — Управление клиентами

```
POST   /api/clients              — создать клиента (idempotent)
PATCH  /api/clients/:id          — обновить клиента
GET    /api/clients/list          — список активных клиентов (кешируется 5 мин)
GET    /api/clients/search?query= — fuzzy поиск по имени/адресу (Fuse.js, порог 0.4)
GET    /api/clients/:id           — профиль клиента + агрегации (проекты, задачи, расходы)
```

**Pydantic модель:**
```python
from pydantic import BaseModel, Field
from typing import Optional, List

class CreateClient(BaseModel):
    name: str = Field(..., description="Client full name")
    type: str = Field(default="person", description="person or company")
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    services: Optional[List[str]] = None

class UpdateClient(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    status: Optional[str] = Field(None, description="new|contacted|qualified|customer|churned|done")
```

**Важно:** Перед созданием любой сущности (task, cost, project) агент **обязан** найти `clientId` через `GET /api/clients/search?query=...`. LLM оперирует именами, а API — идентификаторами.

---

### 4.2. GTD Tasks — Управление задачами

```
POST   /api/gtd-tasks              — создать задачу (idempotent)
PATCH  /api/gtd-tasks/:id          — обновить (статус, приоритет, assignee, due date)
DELETE /api/gtd-tasks/:id           — архивировать (soft-delete: status='archived')
GET    /api/gtd-tasks/list          — список с фильтрами
POST   /api/gtd-tasks/batch-update  — массовое обновление
```

**Фильтры GET /api/gtd-tasks/list:**
| Параметр | Тип | Описание |
|----------|-----|----------|
| `clientId` | string | ID клиента |
| `clientName` | string | Fuzzy resolve по имени |
| `projectId` | string | ID проекта |
| `assigneeId` | string | Исполнитель |
| `priority` | string | high, medium, low, none |
| `status` | string | Через запятую: inbox,next_action,waiting,done и др. |
| `dueBefore` | ISO date | Дедлайн до |
| `dueAfter` | ISO date | Дедлайн после |
| `sortBy` | string | Поле сортировки (default: createdAt) |
| `sortDir` | string | asc / desc |
| `offset`, `limit` | number | Пагинация |

**Pydantic модель:**
```python
class CreateTask(BaseModel):
    title: str
    clientId: Optional[str] = None
    projectId: Optional[str] = None
    assigneeId: Optional[str] = None
    priority: str = Field(default="medium", description="high|medium|low|none")
    status: str = Field(default="next_action", description="inbox|next_action|waiting|projects|someday|done")
    dueDate: Optional[str] = Field(None, description="ISO 8601 date")
    description: Optional[str] = None
    estimatedTime: Optional[float] = Field(None, description="Hours")
    amount: Optional[float] = Field(None, description="Budget in USD")

class UpdateTask(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigneeId: Optional[str] = None
    dueDate: Optional[str] = None
    description: Optional[str] = None
```

**Статусы задач (GTD workflow):**
```
inbox → next_action → in_progress → waiting → done
                    → someday (отложено)
                    → projects (большая задача)
                    → estimate (связана с estimate)
                    → archived (удалена)
```

---

### 4.3. Projects — Проекты

```
POST   /api/projects                    — создать проект (idempotent, auto-create client by address)
GET    /api/projects/list                — список (фильтры: clientId, status, type)
GET    /api/projects/:id/dashboard       — dashboard проекта (задачи, сессии, расходы, файлы)
POST   /api/projects/:id/files           — загрузить файл (PDF, images, docs — до 50MB)
GET    /api/projects/:id/files           — список файлов с версиями
POST   /api/blueprint/split              — разбить PDF на страницы
POST   /api/blackboard                   — estimate blackboard (AI scratchpad)
GET    /api/blackboard/:projectId        — текущий blackboard
```

**Pydantic модель:**
```python
class CreateProject(BaseModel):
    name: str
    clientId: Optional[str] = None
    address: Optional[str] = Field(None, description="If no clientId — auto-creates client by address")
    type: str = Field(default="work", description="work|estimate|financial|other")
    description: Optional[str] = None
    areaSqft: Optional[float] = None
    projectType: Optional[str] = None
    facilityUse: Optional[str] = None
```

**Типы файлов (upload):** PDF, JPEG, PNG, WebP, HEIC, GIF, SVG, TIFF, DOCX, XLSX, CSV, TXT, JSON, ZIP. Max 50MB. Версионирование автоматическое.

---

### 4.4. Costs — Расходы

```
POST   /api/costs          — создать расход (idempotent)
GET    /api/costs/list      — список (фильтры: clientId, category, dateRange)
DELETE /api/costs/:id       — void (soft-delete: status='voided')
```

**Категории расходов:**
| Значение | Описание |
|----------|----------|
| `materials` | Материалы |
| `tools` | Инструменты |
| `reimbursement` | Возмещение (отрицательная сумма) |
| `fuel` | Топливо |
| `housing` | Жильё |
| `food` | Питание |
| `permit` | Разрешения |
| `other` | Прочее |

**Pydantic модель:**
```python
class CreateCost(BaseModel):
    clientId: Optional[str] = None
    projectId: Optional[str] = Field(None, description="Auto-resolves if one active project")
    category: str = Field(..., description="materials|tools|reimbursement|fuel|housing|food|permit|other")
    amount: float
    currency: str = Field(default="USD")
    description: str
```

---

### 4.5. Time Tracking — Учёт рабочего времени

```
POST   /api/time-tracking              — start / stop / pause сессию
GET    /api/time-tracking/active-all    — все активные сессии
GET    /api/time-tracking/summary       — сводка по фильтрам
POST   /api/time-tracking/admin-stop    — принудительное закрытие (admin)
```

**Pydantic модель:**
```python
class TrackTime(BaseModel):
    action: str = Field(..., description="start|stop|pause")
    employeeId: str = Field(..., description="Firebase UID or Telegram ID (auto-resolved)")
    clientId: Optional[str] = None
    clientName: Optional[str] = Field(None, description="Fuzzy resolve if no clientId")
    projectId: Optional[str] = None
    taskId: Optional[str] = None
    comment: Optional[str] = None
    startTime: Optional[str] = Field(None, description="ISO 8601, manual override (within 7 days, no future)")

class AdminStop(BaseModel):
    sessionId: str
    reason: Optional[str] = None
```

**Бизнес-логика:**
- При `start` проверяется нет ли уже активной сессии (кросс-платформа: Telegram ↔ Firebase UID)
- Hourly rate cascade: task rate → user rate → 0
- `startTime` override: максимум 7 дней назад, не в будущем
- Сессия автоматически привязывается к `payrollPeriod` (YYYY-MM)

---

### 4.6. Estimates — Сметы

```
POST   /api/estimates          — создать (idempotent, auto-create client by address)
GET    /api/estimates/list      — список (фильтры: clientId, status)
PATCH  /api/estimates/:id       — обновить
POST   /api/estimates/:id/convert  — конвертировать в задачи
```

**Pydantic модель:**
```python
class EstimateItem(BaseModel):
    description: str
    quantity: float = Field(default=1)
    unitPrice: float
    type: Optional[str] = None

class CreateEstimate(BaseModel):
    clientId: Optional[str] = None
    clientName: Optional[str] = Field(None, description="Auto-create client if no clientId")
    address: Optional[str] = None
    items: List[EstimateItem]
    taxRate: float = Field(default=0, description="Tax percentage (e.g. 8.875)")
    notes: Optional[str] = None
    status: str = Field(default="draft", description="draft|sent|approved|rejected|converted|locked")
```

**Автогенерация:** Номер `EST-{last6OfTimestamp}`, расчёт subtotal/taxAmount/total.

**Dual-estimate (V4):** `internalItems[]` (себестоимость) + `clientItems[]` (с наценкой).

---

### 4.7. Users — Пользователи

```
GET    /api/users/search?query=    — fuzzy поиск по имени/email
POST   /api/users/create-from-bot   — создать/обновить из Telegram бота (dedup по telegramId)
GET    /api/users/contacts           — контактная база
POST   /api/users/contacts           — добавить контакт
```

**Роли пользователей:** `superadmin`, `company_admin`, `admin`, `manager`, `user`, `estimator`, `guest`

**Departments:** `sales`, `procurement`, `accounting`, `construction`, `management`, `other`

---

### 4.8. Sites — Объекты

```
POST   /api/sites          — создать (requires valid clientId)
GET    /api/sites           — список по clientId
PATCH  /api/sites/:id       — обновить
```

---

### 4.9. ERP — Change Orders & Purchase Orders

```
POST   /api/change-orders       — создать change order (idempotent, company-scoped)
GET    /api/change-orders        — список (фильтры: clientId, status, projectId)
PATCH  /api/change-orders/:id    — обновить
POST   /api/purchase-orders      — создать PO
GET    /api/purchase-orders       — список PO
```

**Company Scoping:** Все ERP документы хранятся в `companies/{companyId}/change_orders` и `companies/{companyId}/purchase_orders`. `companyId` определяется из профиля пользователя автоматически.

**Нумерация:** Автоматическая: `CO-001`, `CO-002`, `PO-001` и т.д.

---

### 4.10. Inventory — Склад и материалы

```
# Warehouses (склады)
POST   /api/inventory/warehouses          — создать (type: physical|vehicle)
GET    /api/inventory/warehouses           — список (фильтры: type, archived)
GET    /api/inventory/warehouses/:id       — детали + items
PATCH  /api/inventory/warehouses/:id       — обновить
DELETE /api/inventory/warehouses/:id       — архивировать (soft-delete)

# Items (позиции)
POST   /api/inventory/items               — добавить позицию
PATCH  /api/inventory/items/:id           — обновить
DELETE /api/inventory/items/:id           — удалить
GET    /api/inventory/items               — список (фильтр: warehouseId)

# Transactions (движения)
POST   /api/inventory/transactions         — записать движение (in/out/transfer)
POST   /api/inventory/transactions/task    — массовое списание на задачу
GET    /api/inventory/transactions          — история движений

# Norms (нормы расхода)
POST   /api/inventory/norms               — создать норму
GET    /api/inventory/norms               — список
GET    /api/inventory/norms/:id           — детали
POST   /api/inventory/write-off-by-norm   — списать по норме
```

**Типы транзакций:** `purchase`, `return_in`, `adjustment_in`, `write_off`, `transfer`, `loss`, `tool_issue`, `tool_return`

---

### 4.11. Finance — Финансы

```
GET    /api/finance/context                — доступные проекты, категории, правила
POST   /api/finance/transactions/batch     — импорт банковских транзакций (draft)
GET    /api/projects/status                — финансовая сводка по клиенту
POST   /api/finance/approve                — подтвердить транзакции
POST   /api/finance/undo                   — отменить
```

---

### 4.12. Dashboard

```
GET    /api/dashboard                          — обзор: сессии, задачи, расходы, estimates
GET    /api/dashboard/client/:id/summary       — KPI клиента + red flags
GET    /api/dashboard/client/:id/labor-log     — разбивка по сотрудникам
GET    /api/dashboard/client/:id/timeline      — хронология активности
GET    /api/dashboard/client/:id/costs-breakdown — расходы по категориям
```

**Red Flag Engine (автоматические предупреждения):**
| Flag | Цвет | Условие |
|------|------|---------|
| `low_margin` | red | маржа < 20% |
| `over_budget` | red | расходы > estimate |
| `stale_sessions` | yellow | нет активности 7+ дней |

---

### 4.13. Portal — Клиентский портал (публичный)

```
GET    /api/portal/:slug?token=...            — данные портала (фильтрованные)
POST   /api/portal/:slug/approve?token=...    — клиент одобряет estimate
POST   /api/portal/:slug/comment?token=...    — клиент пишет комментарий
```

**Управление токенами (admin):**
```
POST   /api/clients/:id/share-tokens     — сгенерировать (40 hex chars, configurable expiry)
GET    /api/clients/:id/share-tokens     — список активных
DELETE /api/clients/:id/share-tokens/:tid — отозвать
```

---

## 5. Структура данных Firestore

### 5.1. Ключевые коллекции

| Коллекция | Назначение | Ключевые поля |
|-----------|-----------|---------------|
| `clients` | CRM контакты | name, type, status, address, phone, email, contacts[] |
| `projects` | Проекты | clientId, name, status, type, address, totalDebit/Credit/balance |
| `gtd_tasks` | Задачи GTD | title, status, priority, clientId, assigneeId, dueDate, materials[], payments[] |
| `work_sessions` | Таймтрекинг | employeeId, clientId, startTime, endTime, hourlyRate, sessionEarnings, type |
| `costs` | Расходы | userId, clientId, category, amount, description, receiptPhotoUrl |
| `estimates` | Сметы | clientId, items[], subtotal, taxRate, total, status |
| `users` | Пользователи | email, displayName, role, hourlyRate, telegramId, companyId |
| `contacts` | Контактная база | name, roles[], phones[], emails[], messengers |
| `warehouses` | Склады | name, type (physical/vehicle), isActive |
| `inventory_items` | Позиции склада | catalogItemId, warehouseId, qty, unitPrice |
| `inventory_transactions` | Движения | type, qty, fromLocation, toLocation, relatedTaskId |
| `payroll_periods` | Периоды зарплаты | year, month, status (open→closed→locked→paid) |
| `advance_accounts` | Подотчётные | employeeId, amount, status (open/settled/cancelled) |
| `bank_transactions` | Банк. транзакции | date, vendor, amount, category, isDeductible |

### 5.2. Подколлекции (вложенные)

| Путь | Назначение |
|------|-----------|
| `projects/{id}/files` | Документы проекта (PDF, чертежи) |
| `projects/{id}/blueprint_pages` | Страницы разбитого PDF |
| `companies/{id}/change_orders` | Change orders (ERP) |
| `companies/{id}/purchase_orders` | Purchase orders (ERP) |
| `companies/{id}/punch_lists` | Punch lists |
| `companies/{id}/work_acts` | Акты выполненных работ |
| `companies/{id}/payment_schedules` | Графики платежей |
| `users/{id}/rate_history` | История ставок сотрудника |

### 5.3. Системные коллекции

| Коллекция | Назначение | TTL |
|-----------|-----------|-----|
| `_cache/active_clients` | Кеш клиентов | 5 min |
| `_rate_limits/{userId}` | Rate limit counters | 60 sec window |
| `_idempotency/{key}` | Дедупликация POST | 24h |
| `auditLog` | Аудит (compliance) | permanent |
| `activityLog` | Лог активности | permanent |

---

## 6. Паттерны и бизнес-правила

### 6.1. Resolution Pattern (обязательный!)

LLM оперирует именами ("Фермерское молоко"), а API — идентификаторами. **Каждый tool ОБЯЗАН** сначала resolve имя в ID:

```python
# tools/search_client.py
from pydantic import BaseModel, Field
from utils.api_client import crm


class SearchClientInput(BaseModel):
    """Search for a client by name or address fragment."""
    query: str = Field(..., description="Client name or address to search for")


def search_client(query: str) -> str:
    """Find client ID by fuzzy name/address match. MUST be called before any client-related operation."""
    result = crm.get("/clients/search", params={"query": query})
    if "error" in result:
        return f"Error: {result['error']}"

    clients = result.get("clients", [])
    if not clients:
        return f"No clients found for '{query}'. Try a different search term."

    lines = []
    for c in clients[:5]:
        lines.append(f"- {c['name']} (ID: {c['id']}, status: {c.get('status', 'unknown')})")
    return "Found clients:\n" + "\n".join(lines)
```

**Цепочка вызовов:** `search_client("Farmer") → clientId → create_task(clientId=...)` 

### 6.2. Idempotency (дедупликация)

Все POST-эндпоинты, которые создают сущности, поддерживают дедупликацию:

```python
import uuid

# При создании — передавай уникальный ключ
idempotency_key = f"task-{client_id}-{task_title}-{uuid.uuid4().hex[:8]}"
result = crm.post("/gtd-tasks", data=task_data, idempotency_key=idempotency_key)
```

Если тот же ключ отправить повторно в течение 24 часов — вернётся уже созданная сущность, а не дубликат.

### 6.3. Soft Deletes

CRM **никогда не удаляет физически**:
- Задачи → `status = 'archived'`
- Расходы → `status = 'voided'`
- Склады → `isArchived = true`

### 6.4. Employee ID Resolution

Сотрудники идентифицируются двумя способами:
- **Firebase UID** (строка, например `"abc123def"`)
- **Telegram ID** (число, например `123456789`)

API time tracking автоматически резолвит: ищет в коллекции `users` по полю `telegramId`, возвращает Firebase UID. Агент может передавать любой из двух.

### 6.5. Payroll Lifecycle

```
open → closed → locked → paid
```

- **open** — рабочие пишут часы, расходы
- **closed** — подсчитаны gross, advances, net. Редактирование часов ещё возможно
- **locked** — заморожено, данные неизменяемы
- **paid** — оплачено

**Advance Deduction (FIFO):** При закрытии периода авансы вычитаются из зарплаты по принципу FIFO с гарантией минимальной ставки FL ($13/h).

### 6.6. Error Self-Correction

Когда Zod валидация на бэкенде падает, ответ `400` содержит:

```json
{
  "error": "Validation failed",
  "validationErrors": [
    { "path": "amount", "message": "Expected number, received string" },
    { "path": "clientId", "message": "Required" }
  ]
}
```

Агент **обязан** передать эту ошибку LLM как строку, чтобы тот мог скорректировать параметры и повторить вызов.

---

## 7. Полный пример: Tool для создания задачи

```python
# tools/create_task.py
from pydantic import BaseModel, Field
from typing import Optional
from utils.api_client import crm


class CreateTaskInput(BaseModel):
    """Create a new GTD task in the CRM."""
    title: str = Field(..., description="Task title")
    client_query: str = Field(..., description="Client name to search for (will be resolved to clientId)")
    priority: str = Field(default="medium", description="high|medium|low|none")
    description: Optional[str] = Field(None, description="Task description")
    due_date: Optional[str] = Field(None, description="Due date in ISO 8601 format")
    amount: Optional[float] = Field(None, description="Budget in USD")
    assignee_query: Optional[str] = Field(None, description="Employee name (will be resolved to assigneeId)")


def create_task(input: CreateTaskInput) -> str:
    """
    Create a task in CRM. Resolves client name and assignee name to IDs automatically.
    Returns task details or error message for self-correction.
    """
    # Step 1: Resolve client
    client_result = crm.get("/clients/search", params={"query": input.client_query})
    if "error" in client_result:
        return f"Failed to search client: {client_result['error']}"

    clients = client_result.get("clients", [])
    if not clients:
        return f"Client '{input.client_query}' not found. Ask user for correct name."

    client_id = clients[0]["id"]
    client_name = clients[0]["name"]

    # Step 2: Resolve assignee (optional)
    assignee_id = None
    if input.assignee_query:
        user_result = crm.get("/users/search", params={"query": input.assignee_query})
        users = user_result.get("users", [])
        if users:
            assignee_id = users[0]["id"]

    # Step 3: Create task
    task_data = {
        "title": input.title,
        "clientId": client_id,
        "priority": input.priority,
        "status": "next_action",
    }
    if input.description:
        task_data["description"] = input.description
    if input.due_date:
        task_data["dueDate"] = input.due_date
    if input.amount:
        task_data["amount"] = input.amount
    if assignee_id:
        task_data["assigneeId"] = assignee_id

    result = crm.post("/gtd-tasks", data=task_data)
    if "error" in result:
        return f"Failed to create task: {result['error']}"

    task = result.get("task", result)
    return (
        f"Task created for {client_name}:\n"
        f"- ID: {task.get('id')}\n"
        f"- Title: {task.get('title')}\n"
        f"- Priority: {task.get('priority')}\n"
        f"- Status: {task.get('status')}"
    )
```

---

## 8. Полный пример: LangGraph агент

```python
# agent.py
from langgraph.prebuilt import create_react_agent
from langchain_anthropic import ChatAnthropic
from tools.search_client import search_client, SearchClientInput
from tools.create_task import create_task, CreateTaskInput

# Initialize LLM
llm = ChatAnthropic(model="claude-sonnet-4-20250514", temperature=0)

# Define tools
tools = [
    {
        "name": "search_client",
        "description": "Search for a CRM client by name or address. Returns list of matches with IDs. MUST be called before any operation that needs clientId.",
        "input_schema": SearchClientInput,
        "function": search_client,
    },
    {
        "name": "create_task",
        "description": "Create a GTD task in the CRM. Automatically resolves client and assignee names to IDs.",
        "input_schema": CreateTaskInput,
        "function": create_task,
    },
    # ... add more tools
]

# Create agent
agent = create_react_agent(
    llm,
    tools=tools,
    state_modifier=(
        "You are a CRM assistant for Profit Step construction company. "
        "You help manage clients, tasks, time tracking, expenses, and estimates. "
        "ALWAYS search for client/user IDs before creating entities. "
        "If a Zod validation error is returned, fix the parameters and retry. "
        "Respond in the same language the user writes in (Russian or English)."
    ),
)

# Run
result = agent.invoke({
    "messages": [{"role": "user", "content": "Добавь задачу для Farmer's Milk — отправить счёт на $500"}]
})
```

---

## 9. Telegram Bot — взаимодействие

CRM имеет два Telegram бота, которые работают **параллельно** с API:

| Бот | Webhook Function | Назначение |
|-----|-----------------|-----------|
| **Worker Bot** | `onWorkerBotMessage` | Бригадиры: таймтрекинг, фото, задачи, отчёты |
| **Costs Bot** | `onCostsBotMessage` | Все: расходы, чеки, голосовые заметки |

**Важно для агента:** Данные, созданные через бот (work_sessions, costs, notes), доступны через API. Агент видит всё в едином пространстве.

Подробнее о ботах — см. `BOT_AND_API_REFERENCE.md`.

---

## 10. Scheduled Functions

| Функция | Расписание | Назначение |
|---------|-----------|-----------|
| `invalidateClientCache` | Firestore trigger (on client write) | Обновляет кеш клиентов |
| `cleanupIdempotencyKeys` | Каждые 24h | Удаляет expired ключи дедупликации |
| `autoCloseIdleSessions` | Каждые 30 min | Закрывает сессии без активности >12h |
| `generatePayrollReport` | При закрытии периода | Рассчитывает gross/net/advances |

---

## 11. Переменные окружения

### Functions (.env)

| Переменная | Назначение |
|-----------|-----------|
| `AGENT_API_KEY` | Bearer token для OpenClaw агента |
| `OWNER_UID` | Firebase UID владельца (используется при static API key auth) |
| `OWNER_DISPLAY_NAME` | Имя владельца |
| `TELEGRAM_BOT_TOKEN` | Token worker бота |
| `TELEGRAM_COSTS_BOT_TOKEN` | Token costs бота |
| `ADMIN_TELEGRAM_CHAT_ID` | Chat ID для admin уведомлений |
| `OPENAI_API_KEY` | OpenAI (voice transcription, estimate AI) |
| `ANTHROPIC_API_KEY` | Claude (blueprint analysis) |
| `GOOGLE_AI_API_KEY` | Gemini (blueprint analysis) |

---

## 12. Audit и Compliance

Каждая операция через API логируется в `auditLog`:

```typescript
{
  action: "CREATE" | "UPDATE" | "DELETE" | "BATCH_UPDATE",
  entityType: "client" | "gtd_task" | "project" | "cost" | ...,
  entityId: string,
  changes: { from: {...}, to: {...} },
  source: "openclaw" | "web" | "bot" | "system",
  performedBy: string,  // userId
  timestamp: Timestamp
}
```

Агент OpenClaw автоматически помечается как `source: "openclaw"`.

---

## 13. Rate Limits и Best Practices

### Лимиты
- **60 запросов** в 60 секунд на пользователя
- **60MB** максимальный размер тела запроса (для file uploads)
- **120 секунд** таймаут функции

### Best Practices для агента

1. **Resolution first** — всегда ищи ID перед созданием
2. **Idempotency keys** — используй для всех POST (защита от дублей)
3. **Error parsing** — передавай Zod ошибки LLM для самокоррекции
4. **Batch operations** — используй `batch-update` для массовых изменений задач
5. **Caching** — `/clients/list` кешируется 5 мин, повторные вызовы дешёвые
6. **Pagination** — используй `offset` + `limit` для больших списков
7. **Soft deletes** — никогда не пытайся удалить физически, используй archive/void
8. **Date formats** — всегда ISO 8601 (`2026-04-11T10:00:00Z`)

---

## 14. Тестирование агента

### Локальная разработка с эмуляторами

```bash
cd /path/to/profit-step
firebase emulators:start --only functions,firestore
# API доступен на: http://localhost:5001/profit-step/us-central1/agentApi/api
```

### Smoke test

```bash
# Health check
curl http://localhost:5001/profit-step/us-central1/agentApi/api/health

# Search client
curl -H "Authorization: Bearer test-key" \
  "http://localhost:5001/profit-step/us-central1/agentApi/api/clients/search?query=Jim"

# Create task
curl -X POST -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test task","clientId":"abc123","priority":"high"}' \
  "http://localhost:5001/profit-step/us-central1/agentApi/api/gtd-tasks"
```

### Пример Python-теста

```python
def test_search_and_create():
    """Integration test: search client, create task."""
    # Search
    result = crm.get("/clients/search", params={"query": "Jim"})
    assert "clients" in result
    assert len(result["clients"]) > 0

    client_id = result["clients"][0]["id"]

    # Create
    result = crm.post("/gtd-tasks", data={
        "title": "Test task from agent",
        "clientId": client_id,
        "priority": "low",
    })
    assert "error" not in result
    assert result["task"]["title"] == "Test task from agent"
```

---

## 15. Безопасность

1. **API ключ** — хранится в Secret Manager или `.env`, никогда в коде
2. **Bearer token** — проверяется middleware, без него 401
3. **Zod валидация** — 100% входящих данных валидируется, «галлюцинации» LLM отсекаются
4. **Rate limiting** — 60 req/min, защита от loop
5. **Audit trail** — каждое действие логируется с source и userId
6. **Soft deletes** — данные не теряются, всегда можно откатить
7. **Idempotency** — защита от дублей при повторных вызовах
8. **Portal filter** — клиент видит только свои данные через портал

---

## 16. Частые сценарии для агента

### Сценарий 1: «Добавь задачу для клиента»
```
User: "Нужно отправить счёт Джиму на 500 долларов"
Agent:
  1. search_client("Джим") → clientId
  2. create_task(clientId, "Отправить счёт", amount=500)
```

### Сценарий 2: «Залогируй расход»
```
User: "Купил материалы для Farmer's Milk на $200"
Agent:
  1. search_client("Farmer's Milk") → clientId
  2. create_cost(clientId, category="materials", amount=200)
```

### Сценарий 3: «Начни работу на объекте»
```
User: "Вася начал работу у Джима"
Agent:
  1. search_client("Джим") → clientId
  2. search_user("Вася") → employeeId
  3. track_time(action="start", employeeId, clientId)
```

### Сценарий 4: «Покажи отчёт по клиенту»
```
User: "Сколько потратили на Farmer's Milk?"
Agent:
  1. search_client("Farmer's Milk") → clientId
  2. get_dashboard(clientId) → KPI, costs, hours, margin
```

### Сценарий 5: «Создай смету»
```
User: "Сделай estimate для нового проекта — электрика $5000, сантехника $3000"
Agent:
  1. create_estimate(items=[
       {description: "Электрика", quantity: 1, unitPrice: 5000},
       {description: "Сантехника", quantity: 1, unitPrice: 3000}
     ])
```

---

## 17. Ссылки

| Документ | Что внутри |
|----------|-----------|
| `CLAUDE.md` | Инструкции для AI-агентов (стек, правила, deploy) |
| `BOT_AND_API_REFERENCE.md` | Telegram боты: команды, handlers, callback routing |
| `OPENCLAW_AGENT_INTEGRATION_GUIDE.md` | Краткий обзор архитектуры (первая версия) |
| `docs/PROJECT_WORKFLOW_SPEC_V1.md` | Жизненный цикл проекта в CRM |
| `PROJECT_MAP.md` | Карта файлов проекта |
| `functions/src/agent/routes/` | Исходный код всех API роутов |
| `functions/src/agent/schemas/` | Zod схемы валидации |
| `functions/src/agent/agentMiddleware.ts` | Auth, rate limiting, error handling |
