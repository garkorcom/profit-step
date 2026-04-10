# Инструкции для AI-агентов (Claude, Codex, Cursor, и т.д.)

Это боевой CRM проект **profit-step** — конструкшн-бизнес (estimates, payroll, GTD tasks, time tracking, telegram-боты). Прод по адресу https://profit-step.web.app.

**Владелец:** Денис. Если сомневаешься — спроси в чате, не додумывай.

---

## 🎯 ЦЕНТРАЛЬНОЕ ТЕХНИЧЕСКОЕ ЗАДАНИЕ

**📄 [`docs/PROJECT_WORKFLOW_SPEC_V1.md`](docs/PROJECT_WORKFLOW_SPEC_V1.md)**

Это **главный продуктовый документ проекта** — описывает полный жизненный цикл проекта в CRM от первого контакта до завершения. Все новые фичи должны соответствовать этому workflow или явно его расширять.

**Ключевые сущности:**
- **Project Knowledge Base** — централизованное хранилище нефинансовой информации по проекту (команда, доступы/ключи/пароли, техдокументация, предпочтения клиента, permits)
- **База контактов с ролями** — единая база сотрудников/субподрядчиков с тегами (`электрик`, `пламбер`, `дизайнер`) и мессенджерами

**Ключевые этапы:**
- **Этап 1 (готов):** Инициация + AI-powered тендер с субподрядчиками + автогенерация договора + Commercial Estimate с наценкой
- **Этап 2 (готов):** AI-декомпозиция Internal Estimate в задачи + подбор исполнителей + draft Purchase Orders
- **Этапы 3–5:** будут добавлены по мере обсуждения (TBD)

**Всегда перед реализацией новой фичи:**
1. Прочитай этот SPEC целиком
2. Пойми на каком этапе живёт твоя фича
3. Проверь не противоречит ли она существующему workflow
4. Если противоречит — останови работу и обсуди с Денисом

---

## 0. Первое что делать в любой сессии

1. **Прочитай `CLAUDE.md` (этот файл) целиком.**
2. **Прочитай `docs/PROJECT_WORKFLOW_SPEC_V1.md`** — центральное ТЗ (см. секцию выше).
3. Прочитай `PROJECT_MAP.md` (карта проекта) и `README.md`.
4. Запусти `git status` в `/Users/denysharbuzov/Projects/profit-step` — если там 100+ uncommitted файлов, значит кто-то (другой агент или Денис) работает параллельно. **Не делай `git add -A`** пока не разберёшься.
5. Проверь `git log --oneline -10` — понять в каком состоянии ветка.
6. Посмотри `src/pages/dashbord-for-client/SPEC.md` если задача связана с client dashboard / portal.

---

## 1. Стек

- **Frontend:** React 19 + Material UI v7 + TypeScript 4.9 + **Vite 8** (мигрировали с CRA, не используй `react-scripts` команды)
- **Backend:** Firebase Cloud Functions (Node.js), Firestore, Storage, Auth
- **Agent API:** `functions/src/agent/routes/*.ts` — Express роуты, вызываются через Firebase Hosting rewrite `/api/**` → `agentApi`
- **Тесты:** Jest (frontend + rules), Cypress (E2E), Artillery (load)
- **Linter:** `oxlint` (быстрый Rust-based ESLint-совместимый)
- **Боты:** Telegram (worker + costs), WhatsApp (stub)

---

## 2. Критичные DON'T (бьют по деньгам или безопасности)

### 2.1. Firebase Cloud Functions — infinite loop risk

Один неправильный `onUpdate` триггер без idempotency guard = **$10,000+ billing bomb** за пару дней. Прочитай `docs/legacy-nov2025/DEFENSIVE_PROGRAMMING_GUIDE.md` ДО любых правок триггеров. Всегда:

- Идемпотентность через `processedEvents` коллекцию ИЛИ guard на `before.data() vs after.data()` вернуть `null` если ничего не изменилось
- Не делать писать в тот же документ который триггерит функцию, без защиты от рекурсии
- Тестировать в emulators: `firebase emulators:start` + `npm run test:unit` перед деплоем триггеров

### 2.2. Не ломать существующие модули

| Модуль | Почему не ломать |
|---|---|
| `functions/src/index.ts` | Экспорты ботов — сломаешь и Telegram боты отвалятся |
| `functions/src/triggers/telegram/onWorkerBotMessage.ts` (1200+ строк) | Живой бот, используется бригадирами каждый день |
| `functions/src/agent/routes/timeTracking.ts` | Payroll-чувствительная логика, без тестов. Любая правка → сначала юнит-тест |
| `firestore.rules` | Продовые правила доступа. Менять через PR, не напрямую |
| `firestore.indexes.json` | Если добавил `where + orderBy` → Firestore попросит index. Добавлять через `firebase firestore:indexes` |
| `src/components/dashboard/widgets/FinanceWidget.tsx` | Используется на admin dashboard |
| `src/api/crmApi.ts` | Прямой Firestore доступ, расширять МОЖНО, ломать существующие методы — нельзя |

### 2.3. Секреты

- **`.env`, `.env.local`, `.env.test`, `functions/.env`** — gitignored, **не коммитить**
- Если видишь в диффе файл с API key / token / password / service account — **немедленно стоп**, покажи Денису
- `serviceAccountKey.json` — **никогда не коммитить**, всегда gitignored
- **Никаких credentials в коммит-сообщениях или PR описаниях**

### 2.4. Destructive git operations

- **Не делать** `git push --force` на `main` или `master` без явного разрешения
- **Не делать** `git reset --hard` / `git clean -fd` без разрешения — может потерять чужую работу
- **Не использовать** `git add -A` слепо в main repo — там часто лежит чужая параллельная работа. Используй explicit file adds.

---

## 3. Структура веток и pipeline

**Production branch:** `main`
**Integration branch:** `feature/project-hierarchy-fix` — сюда мерджатся фичи, отсюда деплоится
**Работа агентов:** в worktrees под `.claude/worktrees/` (игнорируется git через `.gitignore` правило `.claude/worktrees/`)

### Pipeline для фич (через Машу — координационный агент)

1. **Маша** создаёт задачу: `~/projects/pipeline/{date}/task-{slug}.md`
2. **Никита** (Claude Code Opus) → `spec.md` (структура файлов, API, типы, миграции)
3. **Стёпа** (Gemini 2.5 Pro) параллельно → `spec-review.md` + `test-plan.md`
4. **Никита** → имплементация backend + skeleton frontend → лог в `nikita-*.md`
5. **Стёпа** → UI + тесты + скриншоты → лог в `stepa-*.md`
6. **Стёпа** → `test-results.md`
7. **Маша** → `summary.md` → отчёт Денису

### 3.1. Bridge Никита/Маша/Стёпа → Claude Code (добавлено 2026-04-09)

**Проблема (которую решает bridge):** Никита и Стёпа работают в ограниченном окружении без Firebase auth, без file writes на произвольные пути, без git push и без `firebase deploy`. Их "implementation" часто останавливается на handoff package'ах (как `~/Desktop/Warehouse_API_Handoff/` 2026-04-08, который пришлось руками доделывать). Они могут *описать* работу, но не *сделать* её целиком.

**Решение:** они пишут task spec в `~/projects/pipeline/{date}/task-{slug}.md`, а Claude Code в main worktree подхватывает и выполняет end-to-end через slash command.

**Поток:**

1. **Маша / Никита** пишет `~/projects/pipeline/{YYYY-MM-DD}/task-{slug}.md` по шаблону `~/projects/pipeline/TASK_TEMPLATE.md`. Содержит goal, scope, API contract, acceptance criteria, out-of-scope, open questions.

2. **Денис** открывает Claude Code в main worktree и вызывает:
   ```
   /pickup task-{slug}
   ```
   Без аргументов — интерактивный режим: Claude Code сканирует pipeline, показывает список pending tasks, спрашивает какую взять.

3. **Claude Code** выполняет задачу end-to-end (см. `.claude/commands/pickup.md`):
   - Sync integration branch → cut feature branch
   - Read spec + find existing patterns
   - Implement + verify (tsc + oxlint + vite build + tests)
   - Commit + push + `gh pr create`
   - Написать implementation log в `~/projects/pipeline/{date}/nikita-{slug}-log.md` (и синхронизировать в `projects/pipeline/...` копию, если существует)

4. **Claude Code НЕ деплоит** — даже если task спеку говорит "deploy it". Деплой только через Дениса по CLAUDE.md §5.

5. **Стёпа / Маша** читают `nikita-{slug}-log.md` для QA/review/summary. Статус `SHIPPED` / `IN_REVIEW` / `IN_PROGRESS` / `TODO` в `Status:` метаданных log файла — единый источник правды для всех агентов.

**Files живущие за этот bridge:**

- `.claude/commands/pickup.md` — slash command definition (полный workflow)
- `~/projects/pipeline/TASK_TEMPLATE.md` — canonical template для Маши
- `~/projects/pipeline/{date}/task-*.md` — task specs
- `~/projects/pipeline/{date}/nikita-{slug}-log.md` — implementation logs (writable by Claude Code via pickup)
- `~/projects/pipeline/{date}/stepa-*.md` — QA artifacts (writable by Styopa, not touched by pickup)

**Важные safety constraints внутри `/pickup`:**

- Один task за invocation — даже если несколько pending, Claude Code берёт одну, завершает, потом спрашивает Дениса о следующей
- Не трогать `claude/confident-lewin` ветку (stale)
- Не `git push --force`
- Если task просит prohibited action (deploy, create account, handle credentials) — остановиться и спросить Дениса вместо того чтобы следовать спецу слепо
- Если task уже shipped (как warehouse 2026-04-09) но spec всё ещё TODO — обновить log в SHIPPED с ссылками на existing git trail, НЕ реимплементировать

**Пример задачи 2026-04-08 "warehouse"** — canonical case использования bridge'а:
- `task-warehouse.md` был создан Машей 2026-04-06 (неявно, через `task-inventory.md`)
- Никита написал `nikita-warehouse-api-log.md` на 2026-04-08 но не смог задеплоить
- Handoff пакет на Desktop — 4 ошибки компиляции, collisions с existing inventory module
- 2026-04-09 Claude Code через ручной workflow (предшественник `/pickup`) распарсил task, merge'нул в existing inventory.ts, добавил 28 unit tests, deployed через Дениса
- Log файл обновлён со статусом SHIPPED + ссылками на PR #2 и #5
- Desktop marker `~/Desktop/Warehouse_API_SHIPPED.md` остановил попытки агентов воссоздать handoff

### Worktrees

Если работаешь над изолированной задачей — используй worktree:

```bash
git worktree add .claude/worktrees/<task-name> -b claude/<task-name>
cd .claude/worktrees/<task-name>
# ... работа ...
```

Это даёт:
- Изолированную рабочую копию
- Отдельную ветку
- `.claude/worktrees/` уже в `.gitignore` — не коммитится в main репо

---

## 4. Текущее состояние проекта (обновлять при значимых изменениях)

**Последнее обновление:** 2026-04-07

### Недавние большие изменения

- **Vite migration** — проект переехал с CRA на Vite. `package.json` скрипты: `vite`, `vite build`, `vite preview`. Build output в `build/` (сконфигурировано в `vite.config.ts:12`), совпадает с `firebase.json` hosting.
- **Client dashboard unified refactor в процессе** (см. `src/pages/dashbord-for-client/SPEC.md`):
  - ✅ Phase 1 (коммит `84c408f`) — 5 portal-компонентов переехали в `src/components/client-dashboard/sections/`
  - ✅ Phase 2 (коммит `6089c0f`) — `ClientDashboardLayout` + `ClientPortalPage` как обёртка
  - ⏳ Phase 3 — конвертация `src/pages/dashboard/client/[id].tsx` (677 строк) в обёртку + internal-only секции (KPI cards, Cost breakdown, Internal notes, Red flags, Team activity, Share button)
  - ⏳ Phase 4 — backend `portal.ts` + `portalFilter.ts` + `client_portal_tokens` + approval flow
- **ERP V4** — Phase 1-3 в процессе (change orders, purchase orders, plan-vs-fact). Частично в ветке, частично в прод.

### Pre-existing технический долг

- **13 TypeScript ошибок** в `siteDashboard/`, `estimator/`, `ElectricalEstimatorPage` — pre-existing work от предыдущего AI-агента. Vite build проходит (warnings, не errors), но `tsc --noEmit` падает. **Не игнорируй при правке этих модулей** — добавлять новые ошибки нельзя.
- **Backend тестов НОЛЬ** (130 .ts файлов в `functions/src/`). Любой рефакторинг без тестов — рулетка. См. `docs/tasks/` если там есть план покрытия.
- **Глобальный ErrorBoundary отсутствует** (см. `docs/legacy-nov2025/TODO_FUTURE_IMPROVEMENTS.md`)
- **Sentry не подключен**
- **Offline detection** не реализован
- **Zod валидация форм** — не везде

### Активные WIP коммиты

В ветке `feature/project-hierarchy-fix` может быть незакоммиченная работа от параллельных агентов. Всегда проверяй `git status` и **не затирай** чужие изменения.

---

## 5. Deploy процедура

**Только владелец (Денис) или с его явного разрешения.**

### Hosting only (frontend changes)

```bash
cd /Users/denysharbuzov/Projects/profit-step
npm run build       # vite build + stamp-sw.js
firebase deploy --only hosting
```

Деплоится всё из `build/` на `https://profit-step.web.app`.

### Functions (backend changes)

⚠️ **Опаснее** — может сломать боты, триггеры, payroll. Делать ТОЛЬКО после:
1. `npm --prefix functions run build` проходит
2. `firebase emulators:start` + ручная проверка нового endpoint'а
3. **Триггеры** — юнит-тесты обязательны
4. Деплой в non-peak часы

```bash
firebase deploy --only functions:agentApi             # агент API
firebase deploy --only functions:onWorkerBotMessage   # telegram bot
firebase deploy --only firestore:rules                # security rules
firebase deploy --only firestore:indexes              # indexes
```

### Monitoring после деплоя

- Firebase Console → Functions → Logs (первые 48 часов особенно внимательно если триггеры)
- `firebase functions:log` для live-tail
- `scripts/monitor-production.sh` если существует

---

## 6. Тестирование

```bash
npm run test                          # Jest (unit)
npm run test:security                 # Firestore rules
npm run test:integration              # Integration
npm run test:e2e                      # Cypress (нужен dev-сервер)
npm run emulator                      # Firebase emulators для локального dev
npm run emulator:test                 # emulators + все тесты
```

**Правила:**
- Новая фича → новый тест (хотя бы smoke). Особенно для functions/.
- Не правь фичу без теста если файл был без теста до тебя (тех.долг, но не расширяй его молча)
- Bug fix → regression test, который падал до фикса

---

## 7. Код-стайл и правила PR

- **Оригинальные комментарии на русском** — OK, **новый код пишем по-английски** (код + идентификаторы). Комментарии могут быть на любом языке, но технические — по-английски.
- **TypeScript strict** — не добавляй `any` без очень веской причины
- **Material UI v7** — используем `Grid size={{ xs: 12, md: 6 }}` синтаксис (не `item xs={12}`)
- **Commit messages** — conventional: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`, `perf:`
  - Тело — описать **почему**, не только **что**
  - `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` если делал AI агент
- **PR template** — `.github/pull_request_template.md`, обязателен чек-лист если трогал Cloud Functions

---

## 8. Документация (корень + docs/)

| Файл | Что там |
|---|---|
| `README.md` | Базовое описание проекта, setup |
| `PROJECT_MAP.md` | Карта файлов, директорий, модулей |
| `ARCHITECTURE_DIAGRAM.md` | Диаграмма архитектуры |
| `CODE_ARCHITECTURE.md` | Принципы организации кода |
| `DEVELOPER_GUIDE.md` | Гайд для новых разработчиков |
| `AUDIT_REPORT.md` | Последний аудит |
| `OPENCLAW_AGENT_INTEGRATION_GUIDE.md` | Интеграция с OpenClaw агентами |
| `docs/` | Модульная документация (CRM, Finance, GTD, Shopping, TimeTracking, Telegram bot, User guide) |
| `docs/legacy/` | Исторические документы (guides, миграции, deployment logs) |
| `docs/tasks/` | Активные task specs и follow-ups |
| `src/pages/dashbord-for-client/SPEC.md` | Client dashboard unified architecture |

**Новые доки** — клади в `docs/` с понятным именем. Не плоди `IMPROVEMENTS.md` во всех папках (это было сделано предыдущим агентом, смотрится шумно).

---

## 9. Боевые клиенты и тестовые данные

- **Реальный клиент для smoke-тестов:** Jim Dvorkin (если есть в Firestore). Проверить: `/portal/jim-dvorkin` или `/dashboard/client/<jim-id>`
- **Тестовые данные:** `npm run seed:test` (создаёт) / `npm run seed:clean` (удаляет)
- **Не использовать прод клиентов для экспериментов** — только реальные операции

---

## 10. Когда НЕ уверен — спроси

Не пиши "я сделаю Х" если не понимаешь:
- Связь между Х и живым клиентом/деньгами
- Impact на billing (Firebase Functions execution costs)
- Влияние на running telegram бот
- Безопасность данных клиента

В этих случаях всегда:
1. Читай код вокруг
2. Покажи Денису что собираешься сделать
3. Получи явное разрешение
4. Только потом делай

**Правило большого пальца:** если изменение может стоить больше $100 за ошибку — остановись и спроси.

---

## 11. История этого файла

- **2026-04-07** — первая версия. Создана после рефакторинга client dashboard (Phase 1+2). Денис попросил "сохранить в корне инструкции для агентов".
