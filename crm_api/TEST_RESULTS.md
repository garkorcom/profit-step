# Profit Step API — Инструкции по тестированию и результаты

> Полное руководство по запуску, структуре и анализу результатов Agent API тестов.
> **Версия API:** 4.1.0 | **Последний прогон:** 2026-04-01 | **Результат:** 92/93 ✅

---

## 🚀 Быстрый старт

### Предварительные условия

| Зависимость | Версия | Зачем |
|---|---|---|
| Java | 11+ | Firestore Emulator |
| Firebase CLI | latest | `firebase emulators:start` |
| Node.js | 20+ | Runtime |
| npm packages | installed | `supertest`, `ts-jest` |

### 3 команды для запуска

```bash
# Терминал 1 — Emulator
firebase emulators:start --only firestore

# Терминал 2 — Все тесты
cd functions && npm run test:api

# Один файл / verbose
npx jest --config jest.agentApi.config.js clients.test
npm run test:api -- --verbose
```

---

## 📁 Структура проекта

```
functions/
├── jest.agentApi.config.js          ← Jest config (maxWorkers:1, forceExit)
├── src/agent/
│   ├── agentApi.ts                  ← 40+ endpoints (Express app)
│   ├── agentMiddleware.ts           ← Auth, Rate Limit, Logger, ErrorHandler
│   └── agentHelpers.ts              ← Cache, Fuzzy Search, Auto-Create
├── test/agentApi/
│   ├── jest.env.ts                  ← AGENT_API_KEY, OWNER_UID, Emulator
│   ├── testSetup.ts                 ← Seed/cleanup helpers + app import
│   ├── clients.test.ts              ← 9 тестов
│   ├── tasks.test.ts                ← 13 тестов
│   ├── costs.test.ts                ← 9 тестов
│   ├── time-tracking.test.ts        ← 13 тестов (1 skipped)
│   ├── estimates.test.ts            ← 9 тестов
│   ├── projects.test.ts             ← 6 тестов
│   ├── users-contacts.test.ts       ← 8 тестов
│   ├── sites.test.ts                ← 5 тестов
│   ├── finance.test.ts              ← 5 тестов
│   ├── erp.test.ts                  ← 7 тестов
│   ├── blackboard.test.ts           ← 4 тестов
│   └── health-and-validation.test.ts← 5 тестов
```

---

## ✅ Результаты тестов

### Финальная статистика

```
Test Suites:  12 passed, 12 total      ✅ 100%
Tests:        92 passed, 1 skipped, 93 total
Time:         6.4 s
```

### Детальные результаты

| # | Файл | Pass | Skip | Покрываемые эндпоинты |
|---|---|---|---|---|
| 1 | `clients.test.ts` | 9 ✅ | 0 | POST/PATCH/GET search |
| 2 | `tasks.test.ts` | 13 ✅ | 0 | POST/GET/PATCH/DELETE |
| 3 | `costs.test.ts` | 9 ✅ | 0 | POST/GET/DELETE + sum.byCategory |
| 4 | `time-tracking.test.ts` | 12 ✅ | 1 ⏭️ | start/stop/status/active-all/summary/admin-stop |
| 5 | `estimates.test.ts` | 9 ✅ | 0 | POST/GET/PATCH + convert-to-tasks |
| 6 | `projects.test.ts` | 6 ✅ | 0 | POST/GET + files upload/list |
| 7 | `users-contacts.test.ts` | 8 ✅ | 0 | Users search/create + Contacts CRUD |
| 8 | `sites.test.ts` | 5 ✅ | 0 | POST/GET/PATCH |
| 9 | `finance.test.ts` | 5 ✅ | 0 | context/batch/approve/undo |
| 10 | `erp.test.ts` | 7 ✅ | 0 | CO/PO/Plan-vs-Fact |
| 11 | `blackboard.test.ts` | 4 ✅ | 0 | POST upsert + GET latest/version |
| 12 | `health-and-validation.test.ts` | 5 ✅ | 0 | Health check + MIME validation |
| | **ИТОГО** | **92** | **1** | **40+ эндпоинтов** |

### 1 Skipped тест

| Тест | Причина |
|---|---|
| RBAC 403 (admin-stop) | Static API key всегда = OWNER_UID. Нужен Firebase Auth JWT с другим UID для полного теста. |

---

## 📊 Матрица покрытия по эндпоинтам

### Клиенты — `POST /api/clients` · `PATCH /api/clients/:id` · `GET /api/clients/search`

| Что проверяется | Статус |
|---|---|
| Создание с полными данными | ✅ |
| Создание с минимумом (только name) | ✅ |
| Идемпотентность (duplicate key → 200) | ✅ |
| Пустой name → 400 | ✅ |
| Обновление nearbyStores + address | ✅ |
| Несуществующий ID → 404 | ✅ |
| Пустое тело PATCH → 400 | ✅ |
| Fuzzy search по имени | ✅ |
| Короткий запрос → 400 | ✅ |

### Задачи (GTD Tasks) — 4 эндпоинта, 13 тестов

| Что проверяется | Статус |
|---|---|
| Создание с title only | ✅ |
| Полный payload с projectId | ✅ |
| Идемпотентность | ✅ |
| Нет title → 400 | ✅ |
| Список без фильтров | ✅ |
| Фильтр по status (comma-separated) | ✅ |
| Пагинация offset/limit + hasMore | ✅ |
| Фильтр по dueBefore | ✅ |
| Обновление status + priority | ✅ |
| Budget tracking (amount, percentage) | ✅ |
| Несуществующий → 404 | ✅ |
| Архивация (soft delete) | ✅ |
| Повторный DELETE → 400 | ✅ |

### Расходы (Costs) — 3 эндпоинта, 9 тестов

| Что проверяется | Статус |
|---|---|
| Создание materials | ✅ |
| Reimbursement → отрицательная сумма | ✅ |
| Идемпотентность | ✅ |
| Missing fields → 400 | ✅ |
| Фильтр по category | ✅ |
| sum.byCategory корректность | ✅ |
| Фильтр по date range | ✅ |
| Void (soft delete) | ✅ |
| Повторный void → 400 | ✅ |

### Трекинг времени — 5 эндпоинтов, 13 тестов

| Что проверяется | Статус |
|---|---|
| Создание сессии | ✅ |
| Ручной startTime | ✅ |
| Авто-закрытие предыдущей сессии | ✅ |
| startTime в будущем → 400 | ✅ |
| Остановка + earnings расчёт | ✅ |
| Нет сессии → 404 | ✅ |
| Status active=true/false | ✅ |
| Список активных сессий | ✅ |
| Summary по диапазону дат | ✅ |
| Admin-stop с seed session | ✅ |
| Admin-stop не-существующая → 404 | ✅ |
| RBAC 403 (требует JWT) | ⏭️ |

### Сметы — 4 эндпоинта, 9 тестов • Проекты+Файлы — 5 эндпоинтов, 6 тестов

Все ✅ — создание, auto-client, idempotency, filters, update items, convert-to-tasks, file upload (MIME validated), list files.

### Users/Contacts — 4 эндпоинта, 8 тестов • Sites — 3 эндпоинта, 5 тестов

Все ✅ — fuzzy search, create-from-bot, hourlyRate update, contacts CRUD+filters, sites CRUD+validation.

### Finance — 4 эндпоинта, 5 тестов • ERP — 6 эндпоинтов, 7 тестов • Blackboard — 2 эндпоинта, 4 теста

Все ✅ — batch transactions, approve/undo pipeline, CO/PO auto-numbering, plan-vs-fact alerts, blackboard upsert.

### Health + Validation — 5 тестов

| Что проверяется | Статус |
|---|---|
| `/api/health` без auth → 200 + JSON | ✅ |
| MIME type disallowed → 400 | ✅ |
| Extension disallowed → 400 | ✅ |
| Valid PDF upload → 201 | ✅ |
| Valid image upload → 201 | ✅ |

---

## 🏗️ Архитектура

### Стек тестирования

| Компонент | Технология |
|---|---|
| Runner | Jest 30 + ts-jest |
| HTTP | Supertest 7 |
| Database | Firestore Emulator (localhost:8080) |
| Storage | jest.spyOn mock |
| Auth | Static API key (env) |

### Ключевые решения

| Решение | Почему |
|---|---|
| `maxWorkers: 1` | Тесты делят один Firestore Emulator |
| `jest.spyOn(admin, 'storage')` | Mock без поломки `admin.apps` |
| `setupFiles` | Env vars до импорта модулей |
| `forceExit: true` | Firestore keep-alive блокирует Jest |
| Dynamic `getApp()` | Порядок: env → import → app |
| Reads-before-writes | Транзакции совместимы с Emulator |

### Тестовые хелперы (`testSetup.ts`)

```typescript
authHeaders()              // { Authorization: 'Bearer test-agent-key' }
seedClient(overrides?)     // → clientId
seedTask(clientId, ov?)    // → taskId
seedCost(clientId, ov?)    // → costId
seedProject(clientId, ov?) // → projectId
seedEstimate(clientId, ov?)// → estimateId
seedUser(overrides?)       // → userId
seedSite(clientId, ov?)    // → siteId
clearAll()                 // Очистка 16 коллекций
```

---

## 🔄 История изменений

| Дата | Версия | Тестов | Изменения |
|---|---|---|---|
| 2026-04-01 v1 | 4.0 | 85/88 | Первый прогон, 3 skip (emulator tx) |
| 2026-04-01 v2 | 4.1 | 90/93 | +health-check, +MIME validation, +5 tests |
| 2026-04-01 v3 | 4.1 | 92/93 | Refactored tx reads-before-writes, unskipped 2 tests |

---

*Документ обновляется после каждого значимого изменения в test suite.*
