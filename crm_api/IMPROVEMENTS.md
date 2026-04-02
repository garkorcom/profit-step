# Profit Step API — Доработки и рекомендации

> Глубокий аудит системы на основе ревью ~4200 строк кода API, middleware,
> helpers, cron jobs, и результатов 99 тестов.
> Дата анализа: **2026-04-02** | Фаза 1 ✅ | Фаза 2 ✅ | Фаза 3 ✅

---

## 🔴 Критичные проблемы (нужно исправить)

### 1. ~~`_idempotency` коллекция никогда не чистится~~ ✅ RESOLVED

**Решено:** Добавлен cleanup в cron `autoCloseStaleSessions` — удаление expired ключей каждый час.

6 эндпоинтов пишут в `_idempotency`:
- `POST /api/clients` (строка 448)
- `POST /api/gtd-tasks` (строка 612)
- `POST /api/costs` (строка 674)
- `POST /api/estimates` (строка 2270)
- `POST /api/change-orders` (строка 3343)
- `POST /api/purchase-orders` (строка 3564)

**Влияние:** Коллекция бесконечно растёт → увеличение расходов Firestore, замедление запросов.

**Решение:** Добавить cleanup в существующий cron `autoCloseStaleSessions` (каждый час):
```typescript
// Cleanup expired idempotency keys
const expiredKeys = await db.collection('_idempotency')
  .where('expiresAt', '<', Date.now())
  .limit(500).get();
if (!expiredKeys.empty) {
  const batch = db.batch();
  expiredKeys.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}
```

---

### 2. ~~`_rate_limits` коллекция тоже не чистится~~ ✅ RESOLVED

**Решено:** Добавлен cleanup стейлых записей (>1 день) в тот же cron.

---

### 3. ~~`searchClientByAddress()` сканирует ВСЮ коллекцию~~ ✅ RESOLVED

**Решено:** Заменено `db.collection('clients').get()` на `getCachedClients()` (5-мин TTL кэш).

---

### 4. ~~Транзакция `start` — read-after-write~~ ✅ RESOLVED

**Решено:** Рефакторинг обеих транзакций (start + admin-stop):
- Phase 1: ALL READS (user, session pointer, cross-platform scan, task)
- Phase 2: ALL WRITES (close sessions, create new, update pointer)
- 2 ранее пропущенных теста теперь проходят в Emulator

---

## 🟡 Важные доработки

### 5. `agentApi.ts` — монолит 3927 строк

**Проблема:** Один файл содержит **все 40+ хэндлеров**, все Zod-схемы, и всю бизнес-логику. Невозможно:
- Параллельно работать нескольким разработчикам
- Быстро находить баги
- Делать code review

**Решение:** Разбить на модули по домену:
```
src/agent/
├── agentApi.ts           ← только app setup + middleware wiring (50 строк)
├── routes/
│   ├── clients.ts        ← POST/PATCH/GET + schemas
│   ├── tasks.ts
│   ├── costs.ts
│   ├── timeTracking.ts
│   ├── estimates.ts
│   ├── projects.ts
│   ├── users.ts
│   ├── contacts.ts
│   ├── sites.ts
│   ├── finance.ts
│   ├── erp.ts
│   └── blackboard.ts
├── schemas/              ← Zod schemas отдельно
│   ├── clientSchemas.ts
│   ├── taskSchemas.ts
│   └── ...
├── agentMiddleware.ts
└── agentHelpers.ts
```

**Приоритет:** Средний (можно делать постепенно)

---

### 6. Нет Webhook / Push уведомлений

**Проблема:** API не имеет механизма уведомлять внешние системы (OpenClaw) о событиях:
- Бюджет превышен (plan-vs-fact alert) → никто не узнает пока не запросит
- Задача просрочена (dueBefore прошло) → нет alert
- Сессия не закрыта 8+ часов → cron закрывает, но никому не сообщает

**Решение:** Добавить webhook endpoint:
```
POST /api/webhooks/register  — { url, events: ['budget_alert', 'task_overdue', ...] }
DELETE /api/webhooks/:id
```
Или проще — отправлять alert через Telegram при критичных событиях.

---

### 7. Нет `GET /api/clients/:id` — полная карточка клиента

**Проблема:** Есть `search`, `create`, `update`, но нет endpoint для получения **полного профиля** одного клиента с агрегацией:
- Все проекты клиента
- Все задачи
- Все расходы
- Time tracking summary
- Активные сметы

OpenClaw агент не может получить полную картину по клиенту одним запросом.

**Решение:**
```
GET /api/clients/:id  →  { client, projects[], tasks[], costs.total, timeTracking.totalHours }
```

---

### 8. Нет `GET /api/dashboard` — сводная панель

**Проблема:** Для получения общей картины агент должен сделать 5+ запросов. Нет единого endpoint для:
- Активные сессии
- Задачи на сегодня (due today)
- Бюджетные alerts
- Последние расходы

**Решение:**
```
GET /api/dashboard  →  {
  activeSessions: [],
  tasksDueToday: [],
  budgetAlerts: [],
  recentCosts: [],
  openEstimates: { count, totalValue }
}
```

---

### 9. Нет версионирования API

**Проблема:** API доступно по `/api/*` без версии. Любое breaking change сломает всех клиентов.

**Решение:** Перейти на `/api/v1/*` и при breaking changes создавать `/api/v2/*`.

---

### 10. `activityLog` — нет ротации

**Проблема:** Каждая мутация пишет в `activityLog`. Через год — десятки тысяч документов без пользы.

**Решение:**
- Добавить TTL cleanup (90 дней) в cron
- Или переносить в BigQuery через уже существующий DWH pipeline

---

## 🟢 Полезные улучшения

### 11. Batch-операции для задач

Нет возможности массово обновить задачи:
```
POST /api/gtd-tasks/batch-update
{ taskIds: [...], update: { status: 'completed' } }
```
**Use case:** Закрыть все задачи по проекту одним вызовом.

---

### 12. Экспорт данных

Нет эндпоинтов для получения данных в формате для отчётов:
```
GET /api/reports/costs?clientId=X&format=csv&from=2026-01-01&to=2026-12-31
GET /api/reports/timesheet?userId=X&month=2026-03
```

---

### 13. Health-check endpoint

Нет `/api/health` для мониторинга:
```
GET /api/health  →  { status: 'ok', uptime, firestore: 'connected', version: '4.0' }
```

---

### 14. Pagination consistency

Некоторые эндпоинты используют `offset/limit`, другие — `limit` only. Нужна единая стратегия:
- `limit` + `cursor` (Firestore-native, лучше для больших объёмов)
- `limit` + `offset` (текущий, хорош для малых объёмов)

---

### 15. File upload → нет virus scan

`POST /api/projects/:id/files` принимает base64 без проверки:
- Нет лимита на размер файла (кроме express json limit 60mb)
- Нет проверки типа файла (MIME type)
- Нет malware scan

---

## 📊 Приоритезация

| # | Задача | Важность | Сложность | Рекомендация |
|---|---|---|---|---|
| 1 | **Cleanup `_idempotency`** | 🔴 Критично | Лёгкая | Добавить в cron — **30 мин** |
| 2 | **Cleanup `_rate_limits`** | 🟡 Средне | Лёгкая | В тот же cron — **10 мин** |
| 3 | **Fix `searchClientByAddress`** | 🔴 Критично | Средняя | Кэш с адресами — **2 часа** |
| 4 | **Refactor transaction** | 🟡 Средне | Сложная | Reads-before-writes — **4 часа** |
| 5 | **Split `agentApi.ts`** | 🟡 Средне | Средняя | Модули по домену — **1 день** |
| 6 | **Webhook notifications** | 🟢 Полезно | Средняя | Event bus — **1 день** |
| 7 | **`GET /api/clients/:id`** | 🟡 Средне | Лёгкая | Новый endpoint — **1 час** |
| 8 | **`GET /api/dashboard`** | 🟢 Полезно | Средняя | Агрегация — **3 часа** |
| 9 | **API versioning** | 🟢 Полезно | Лёгкая | `/api/v1/*` — **1 час** |
| 10 | **`activityLog` ротация** | 🟡 Средне | Лёгкая | TTL в cron — **30 мин** |
| 11 | **Batch-update tasks** | 🟢 Полезно | Лёгкая | Новый endpoint — **1 час** |
| 12 | **Export CSV** | 🟢 Полезно | Средняя | Форматирование — **3 часа** |
| 13 | **Health-check** | 🟢 Полезно | Лёгкая | 10 строк — **15 мин** |
| 14 | **Pagination consistency** | 🟢 Полезно | Средняя | Рефактор — **2 часа** |
| 15 | **File validation** | 🟡 Средне | Лёгкая | MIME + size check — **1 час** |

---

## 🏁 Рекомендуемый порядок работы

### Фаза 1: Гигиена (1 день) ✅ DONE
- [x] Cleanup `_idempotency` в cron
- [x] Cleanup `_rate_limits` в cron
- [x] Ротация `activityLog` (90 дней)
- [x] Health-check endpoint (`GET /api/health`)
- [x] File validation (MIME whitelist + extension check)

### Фаза 2: Стабильность ✅ DONE
- [x] Fix `searchClientByAddress` → использует `getCachedClients()` вместо full-scan
- [x] Refactor transaction → reads-before-writes (start + admin-stop)
- [x] 2 ранее skipped теста теперь проходят (92/93 pass)

### Фаза 3: API Extension ✅ DONE
- [x] `GET /api/clients/:id` — полный профиль с 6 параллельных агрегаций
- [x] `GET /api/dashboard` — активные сессии, задачи, расходы, сметы
- [x] `POST /api/gtd-tasks/batch-update` — обновление до 50 задач
- [ ] API versioning `/api/v1/*` (отложено)

### Фаза 4: Масштабирование (по мере роста)
- [5] Split `agentApi.ts` на модули
- [6] Webhook notifications
- [12] Export CSV
- [14] Cursor-based pagination

---

*Анализ основан на ревью: `agentApi.ts` (~4200 строк, 48 эндпоинтов), `agentMiddleware.ts` (165 строк), `agentHelpers.ts` (245 строк), `autoCloseStaleSessions.ts` (143 строки), и результатах 99 integration тестов.*
