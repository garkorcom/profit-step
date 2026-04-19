# Firebase Topology (P-1.4)

## Metadata

- **Автор:** Claude Code Opus 4.7 (1M context)
- **Дата:** 2026-04-19
- **Цель:** snapshot текущей Firebase-инфраструктуры проекта — collections, functions, hosting, rules — чтобы при переезде ничего не потеряли
- **Источники:** `firebase.json`, `firestore.indexes.json`, `firebase functions:list`, Firestore Console

---

## 1. Firebase Project

- **Project ID:** `profit-step`
- **Default region:** `us-central1`
- **Secondary region:** `us-east1` (для нескольких callable functions) + `europe-west1` (modifyAiTask)
- **Active use via Firebase CLI:** implicit, через локальный `firebase use` кэш. `.firebaserc` отсутствует — см. P-1.4 ниже.

---

## 2. Firestore collections (24)

Все коллекции с composite-индексами в `firestore.indexes.json`:

### 2.1. Бизнес-сущности

| Collection | Назначение |
|---|---|
| `clients` | Клиенты CRM (24 записи на проде) |
| `companies` | Мульти-тенант компании (3 записи: GARKOR Corp + 2 sub) |
| `users` | Сотрудники (9 на проде) |
| `gtd_tasks` | Задачи / GTD (240 на проде) |
| `work_sessions` | Сессии времятрекинга (с селфи check-in) |
| `projects` | Проекты клиентов (11 активных) |
| `estimates` | Сметы (dual-layer: internalItems + clientItems) |
| `saved_estimates` | Черновики смет |
| `meetings` | Встречи (добавлено в PR #31 2026-04-19) |
| `sites` | Объекты (геолокация) |
| `punch_lists` | Чек-листы завершения |
| `warranty_tasks` | Гарантийные заявки |
| `work_acts` | Акты выполненных работ |

### 2.2. Финансы

| Collection | Назначение |
|---|---|
| `bank_transactions` | Банковские транзакции (338 на проде, 100% AI-auto-categorized) |
| `bank_statements` | Выписки (1 загруженный PDF) |
| `project_ledger` | Журнал финопераций по проектам |

### 2.3. Склад (Warehouse V3 — shipped 2026-04-18)

| Collection | Назначение |
|---|---|
| `inventory_catalog` | V3 каталог позиций (SKU) |
| `inventory_transactions_v2` | V3 immutable journal (plan/fact) |

### 2.4. Blueprint AI

| Collection | Назначение |
|---|---|
| `blueprint_jobs` | Задания LangGraph pipeline |
| `blueprint_batches` | Пакеты обработки |
| `blueprint_v3_sessions` | V3 сессии анализа чертежей |

### 2.5. Операционные

| Collection | Назначение |
|---|---|
| `files` | Метаданные файлов (content в Storage) |
| `invitations` | Пригласительные токены |
| `client_portal_tokens` | Share-токены для клиентского портала |
| `dev_logs` | Публичный devlog (`/blog`) |

### 2.6. Утилитные (не индексированные)

- `_idempotency` — дедупликация операций (24h TTL)
- `_admin_activity_logs` — аудит лог
- `_audit_logs` — отдельный аудит
- `notifications` — очередь push-нотификаций
- `agent_feedbacks` — feedback от OpenClaw агентов
- `agent_tokens` — per-employee токены
- `costs` — расходы (старый collection, будет migrated)

---

## 3. Firestore Indexes (50+ composite)

Определены в `firestore.indexes.json`. Категории:

| Группа | Количество | Примечания |
|---|---|---|
| `bank_transactions` | 6 | Year / month / category / companyId комбинации |
| `users` | 7 | Multi-company + status + role + displayName |
| `companies` | 5 | ownerCompanyId × isArchived × name |
| `gtd_tasks` | ~8 | assigneeId / clientId / status / createdAt комбинации |
| `work_sessions` | ~4 | userId / status / startTime |
| `meetings` | 4 | clientId/dealId/projectId × startAt DESC (added 2026-04-19) |
| `inventory_catalog` | 1 | isArchived × name |
| `inventory_transactions_v2` | 2 | catalogItemId × timestamp ASC/DESC |
| `client_portal_tokens` | 2 | slug/clientId |
| `dev_logs`, `bank_statements`, `invitations`, `files` | по 1-2 | Стандартные фильтры |

Точный список: `firestore.indexes.json` — 897 строк.

---

## 4. Cloud Functions (113 deployed)

**Breakdown по type:**

| Type | Count | Примеры |
|---|---|---|
| HTTPS | ~10 | `agentApi` (главный API), `telegramWebhook`, `brevoWebhookHandler` |
| Callable (v1) | ~30 | `admin_createUserWithPassword`, `confirmAiTask`, `analyzeBlueprintV3Callable`, `closePayrollPeriod` |
| Callable (v2) | ~5 | `modifyAiTask` (europe-west1), `confirmAiTask`, `generateAiTask` (us-east1) |
| Firestore triggers | ~20 | `onCostCreated`, `onTaskCreate`, `calculateActualCost`, `onWorkerBotMessage`, `onCostsBotMessage`, `onTelegramMessage`, `onWhatsAppMessage`, `processMessage` |
| Scheduled | 22 | `autoCloseStaleSessions`, `checkLongBreaks`, `cleanupIdempotencyKeys`, `cleanupAgentEvents`, `aggregateGrowthMetrics`, `aggregateEngagementMetrics`, `autoTaskPriority`, `assembleAlbums`, `deadlineReminders`, `finalizeExpiredSessions`, `generateDailyPayroll`, `scheduledDayPlan`, `sendSessionReminders`, `runAnomalyDetection` (planned для Warehouse V3 Phase 2), etc. |
| Pub/Sub | 1 | `handleBudgetAlert` |

### 4.1. Критичные функции (не сломать при переезде)

1. **`agentApi`** — центральный HTTPS endpoint. Все `/api/*` идут через него. Webhook для внешних интеграций. Region: `us-central1`. Memory: 512. Min instances: 1.
2. **`onWorkerBotMessage`** — 2142-строчный worker bot handler (refactored в 6 модулей 2026-04-15). **Telegram webhook target.** При переезде обязательно переставить webhook в BotFather.
3. **`onCostsBotMessage`** — отдельный бот для расходов + OCR чеков.
4. **`telegramWebhook`** — v2, us-central1, отдельный endpoint для чего-то еще (проверить).
5. **`processMessage`** — Firestore trigger (создание документа в `messages` → AI reply).
6. **`calculateActualCost`** — Firestore onWrite на `costs`. **Infinite-loop risk** per CLAUDE.md §2.1. Не трогать без чтения `DEFENSIVE_PROGRAMMING_GUIDE.md`.

---

## 5. Firebase Hosting

**Config** (`firebase.json`):

```json
{
  "hosting": {
    "public": "build",
    "rewrites": [
      { "source": "/api/**", "function": "agentApi" },
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```

- **Public dir:** `build/` (Vite output)
- **Custom domains:** не найдены (проверить Firebase Console → Hosting)
- **Default domain:** `profit-step.web.app`
- **Alternative:** `profit-step.firebaseapp.com`
- **Rewrite:** `/api/**` проксируется в `agentApi` Cloud Function

---

## 6. Firebase Storage

**Rules:** `storage.rules` (default рядом с `firestore.rules`).

**Buckets:**
- Default: `profit-step.firebasestorage.app` (новый формат)
- Legacy: `profit-step.appspot.com` (старый формат, может ещё существовать для backward compat)

**Основные paths:**
- `projects/<projectId>/files/` — файлы проектов
- `receipts/<userId>/` — чеки расходов
- `blueprints/` — PDF чертежи для LangGraph
- `selfies/<employeeId>/` — селфи check-in фото
- `bank-statements/` — банковские PDF

**Размер не замерен** (добавить `gsutil du` на фазе P-1.5).

---

## 7. Firebase Auth

**Providers:**
- Google (основной)
- Email/Password (для ручных test аккаунтов)

**Custom claims:** используются для role (admin/manager/foreman/worker/driver) и companyId.

**Authorized domains:** `profit-step.web.app`, `profit-step.firebaseapp.com`, `localhost`. На новом проекте добавить новый hosting domain.

---

## 8. Firestore Security Rules

**Файл:** `firestore.rules` (600+ строк).

**Ключевые паттерны:**
- `isAdmin()` — проверка `request.auth.token.role == "admin"` ИЛИ `AGENT_API_KEY`
- `sameCompany()` — `resource.data.companyId == request.auth.token.companyId`
- RLS для worker/driver — видят только свои записи (по `userId`/`createdBy`/`assigneeId`)
- RLS для foreman — плюс team_member_uids

**Warnings при деплое:**
- `⚠ [W] 44:16 - Unused function: targetUserIsActive.`
- `⚠ [W] 45:16 - Invalid variable name: resource.`

Нужна ревизия когда будут силы.

---

## 9. Scheduled functions graph

22 cron'а. Критичные:

| Function | Cron | Что делает |
|---|---|---|
| `autoCloseStaleSessions` | every 30 min | Закрывает "забытые" work_sessions |
| `generateDailyPayroll` | daily | Считает payroll за день |
| `sendSessionReminders` | every 15 min | Push'ит рабочим напоминания |
| `cleanupIdempotencyKeys` | daily | Чистит `_idempotency` старше 24h |
| `aggregateGrowthMetrics` | daily | BigQuery export |
| `checkLongBreaks` | every 5 min | Алёрт на длинные перерывы |

Остальные — менее критичные (статистика, albums, GTD AI).

---

## 10. External integrations (non-Firebase)

| Сервис | Для чего | Куда идёт |
|---|---|---|
| Google AI Studio (Gemini) | blueprint AI, faceVerification, OCR | Через GEMINI_API_KEY |
| Anthropic | blueprint AI fallback | Через ANTHROPIC_API_KEY |
| Brevo | SMTP + transactional email | через EMAIL_* env |
| Telegram Bot API | webhooks для 4 ботов | через *_BOT_TOKEN |
| WhatsApp Cloud API | stub | WHATSAPP_VERIFY_TOKEN |
| Google Cloud BigQuery | metrics aggregation | через ADC |
| Google Cloud Vision (optional?) | deprecated для receiptOcr (перешли на Gemini) | через ADC |
| Google Cloud Pub/Sub | budget alerts | встроено в Firebase |

---

## 11. Что нужно сделать при переезде

### 11.1. Создать новый Firebase project
1. Firebase Console → Create new project → `profit-step-v2` (или новое имя)
2. Upgrade to Blaze plan (нужен для Cloud Functions)
3. Enable APIs: Firestore, Auth, Storage, Cloud Functions, Cloud Scheduler
4. Set region: `us-central1` (или желаемый)

### 11.2. Перенести конфигурацию
1. `.firebaserc` с `{ "projects": { "default": "new-project-id" } }` (см. P-1.4)
2. `firebase use new-project-id` локально
3. `firebase deploy --only firestore:rules,firestore:indexes` — сначала правила и индексы
4. `firebase deploy --only functions` — функции (~5-10 мин)
5. `firebase deploy --only storage` — storage rules
6. `firebase deploy --only hosting` — только после build с новыми env vars

### 11.3. Перенести данные (см. P-1.5, будет отдельно)
- `gcloud firestore export gs://old-bucket/backup` + `import gs://new-bucket/...`
- `gsutil -m cp -r gs://old.appspot.com gs://new.appspot.com` для Storage
- `firebase auth:export users.json` + `firebase auth:import` для Auth

### 11.4. Post-migration
- Обновить webhook URL у 4 Telegram ботов через `setWebhook` API
- Проверить authorized domains в Auth
- Запустить `firebase functions:log` и мониторить 48ч (per CLAUDE.md §5)
- Обновить OpenAPI spec на https://new-host.web.app/api/docs/spec.json
- Уведомить внешнего разработчика `@crmapiprofit_bot` о новом endpoint

---

## References

- Parent plan: [`MASTER_PLAN_2026-04-19.md`](../tasks/MASTER_PLAN_2026-04-19.md) §P-1.4
- Secrets: [`SECRETS.md`](./SECRETS.md)
- Inventory: [`HARDCODED_INVENTORY.md`](./HARDCODED_INVENTORY.md)
- Data export runbook: P-1.5 (не написан)
- Trigger safety: `docs/legacy-nov2025/DEFENSIVE_PROGRAMMING_GUIDE.md`
