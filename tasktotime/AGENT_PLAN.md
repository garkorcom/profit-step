# План имплементации `tasktotime` — Claude Opus + агенты

**Версия:** 2.0 (replaced v1 которая была про роли Маши/Никиты/Стёпы)
**Дата:** 2026-04-26
**Цель:** реализовать mockup `tasktotime/mockup/index.html` как работающий production модуль.

---

## Принцип работы

Я (Claude Opus root в этой сессии) делаю всё. Использую subagents для параллельных задач. Денис ревьюит PR'ы и деплоит.

**Source of truth:**
- [`mockup/index.html`](mockup/index.html) — что должно работать в браузере
- [`spec/`](spec/) — детали полей, lifecycle, API, AI

---

## 6 шагов

### Шаг 1: Hexagonal Foundation (2 дня)

**Цель:** `tasktotime/{domain,ports,adapters,shared,tests}/` skeleton + типы.

**Агенты:**
- `backend-architect` (1×) — дизайн hexagonal layout по [spec/01-overview/architecture-decision.md](spec/01-overview/architecture-decision.md) + [spec/04-storage/data-dependencies.md](spec/04-storage/data-dependencies.md). Выдаёт: точный список файлов + интерфейсы 21 порта.
- `Explore` (1×, параллельно) — найти существующие паттерны в profit-step (`useGTDTasks`, `agent/routes/tasks.ts`, triggers) которые надо учесть.
- `backend-developer` (1×) — реализовать domain types из [spec/02-data-model/](spec/02-data-model/) + lifecycle state machine из [spec/03-state-machine/](spec/03-state-machine/) + cycle detection.
- `test-generator` (1×) — unit tests для lifecycle, cycle detection, subtask rollup math.
- `test-runner` (1×) — прогнать тесты, починить fail'ы.

**Я между ними:** собираю результаты, eslint правило «domain/ не импортирует Firebase/MUI», коммит, PR.

**Deliverable:**
- 21 port interface
- Domain types (Task, Money, Location, AcceptanceAct, etc.)
- Lifecycle transitions table + tests
- ESLint hexagonal rule в CI

**Деплой:** не нужен — типы и rules без эффекта на прод.

---

### Шаг 2: Firestore schema (0.5 дня)

**Цель:** `tasktotime_tasks` коллекция готова.

**Агенты:**
- `general-purpose` — написать блок rules по [spec/04-storage/rules.md](spec/04-storage/rules.md): company-scoped, без public read (НЕ повторять баг `gtd_tasks:343`).
- `test-generator` — security rules tests (cross-tenant isolation).

**Deliverable:**
- `firestore.rules` блок `tasktotime_tasks` + `tasktotime_transitions`
- `firestore.indexes.json` — 11 composite indexes
- `firestore.rules.test.ts` — cross-tenant tests pass

**Деплой:** ты, `firebase deploy --only firestore`.

---

### Шаг 3: Backend (3-4 дня)

**Цель:** REST API + 5 triggers + 6 AI callables.

**Параллельно (3 агента одновременно):**
- `backend-developer` (A) — adapters/firestore/* реальные implementations всех 21 порта.
- `backend-developer` (B) — adapters/http/* + REST handlers по [spec/05-api/rest-endpoints.md](spec/05-api/rest-endpoints.md).
- `backend-developer` (C) — 5 triggers с idempotency guards (`processedEvents/`). Critical — CLAUDE.md §2.1.

**Затем:**
- `backend-developer` (D) — 6 AI callables (generateTask, estimateTask, modifyTask, decomposeEstimate, confirmTask, generateDayPlan).
- `test-generator` + `test-runner` — integration tests с emulator. **Обязательны:** infinite-loop tests, cross-tenant test (`rlsCrossTenant.test.ts`).

**Deliverable:**
- `/api/tasktotime/*` REST endpoints работают в emulator
- Triggers с guard'ами (WATCHED_FIELDS exclude `subtaskRollup`/`isCriticalPath`/`slackMinutes`/`blocksTaskIds`)
- AI callables работают с mocked Anthropic/Gemini API

**PR разбит на 2:** PR-A (adapters + REST), PR-B (triggers + callables) — для review safety.

**Деплой:** ты, `firebase deploy --only functions`. **48h monitoring.**

---

### Шаг 4: Frontend (5-7 дней)

**Цель:** все 10 views из mockup'а + Drawer работают на реальных данных.

**Параллельно (3-4 агента):**
- `frontend-developer` (A) — `useTasks` hook + `<TaskCard>` (компонент с variants для всех views).
- `frontend-developer` (B) — Board / Calendar / Table / MyTasks views.
- `frontend-developer` (C) — Tree (MUI X TreeView) / Graph (xyflow + dagre) / Map (Leaflet).
- `frontend-developer` (D) — Live Ops / Dispatch (новые views, не было в gtd_tasks).
- `fullstack-developer` — Detail Drawer 4 sections + Wiki editor + Rollup (markdown editor `@uiw/react-md-editor`).
- `ui-ux-designer` (review) — проверка соответствия mockup'у, accessibility, mobile responsive.
- `test-generator` — component tests.

**Deliverable:**
- `/tasktotime` route работает (старый `/crm/tasks` пока не трогаем)
- 10 views рендерят реальные данные из `tasktotime_tasks`
- Drawer с 4 секциями (Работа/Деньги/Контекст/Wiki)
- Mobile responsive iPhone SE / iPad / Pixel Fold
- 9 critical mockup gaps закрыты (см. [spec/06-ui-ux/mockup-notes.md](spec/06-ui-ux/mockup-notes.md))

**Деплой:** ты, `firebase deploy --only hosting`. **Manual UAT от тебя.**

---

### Шаг 5: Telegram bot (3 дня) — **HIGH RISK**

**Цель:** bot читает обе коллекции (legacy + new), пишет только в new.

**Агенты:**
- `code-explorer` — тщательный re-audit всех handler'ов (CLAUDE.md §2.2: «без unit тестов»).
- `test-generator` — unit tests для каждого handler (раньше не было!). Минимум 30 тестов суммарно.
- `backend-developer` — переписать `gtdHandler.ts`, `inboxHandler.ts`, `mediaHandler.ts`. **Исправить status drift** в mediaHandler (`'todo'/'in_progress'` → канонические).

**Deliverable:**
- 3 handler файла с tests (`functions/test/telegram/*.test.ts`)
- Dual-read pattern (legacy + new)
- Status drift fix

**Деплой:** ты, осторожно. **48h monitoring + опрос 2-3 бригадиров.** Готов rollback за 5 минут.

---

### Шаг 6: Миграция + Cutover (1 день)

**Когда:** воскресенье 02:00-04:00 EST (по твоему выбору).

**Агенты:**
- `backend-developer` — `scripts/migrate-gtd-to-tasktotime.ts` (idempotent, по [spec/04-storage/migration-mapping.md](spec/04-storage/migration-mapping.md)).
- `backend-developer` — `scripts/verify-tasktotime-migration.ts` (counts equal, sample IDs match).
- `general-purpose` — archive script, переносит `src/components/gtd/`, `tasks*/`, `cockpit/`, `Unified*Page.tsx` в `_archived/`. (Запускается через 2 недели после cutover.)

**Cutover окно (30-60 минут):**
1. T-30 min: Telegram объявление в bot канале
2. T-15 min: ты деплоишь Phase 6 frontend (writers переключаются)
3. T-0: запуск migration script, live monitoring counts
4. T+10: verification script
5. T+15: smoke test (создать задачу через web → bot → cockpit → timer → complete → accept)
6. T+20: hosting deploy, redirect `/crm/tasks` → `/tasktotime`
7. T+30: done

**Rollback:** если что-то идёт не так в T+0..T+10 — `git revert <last-deploy>` + redeploy старого кода за 5 минут. `gtd_tasks` коллекция остаётся как backup ещё 3 месяца.

---

## Timeline

| Шаг | Длительность | Можно параллелить с другими шагами? |
|---|---|---|
| 1. Foundation | 2 дня | — |
| 2. Firestore | 0.5 дня | Параллельно с Шагом 1 |
| 3. Backend | 3-4 дня | После 1+2 |
| 4. Frontend | 5-7 дней | Параллельно с Шагом 3 (ОК со 2-го дня Шага 3) |
| 5. Telegram | 3 дня | После 3 |
| 6. Cutover | 1 день | После 4+5 |

**Итого active work: 14-17 дней календарных** (3-3.5 недели). + 2 недели soak period перед cleanup = ~5 недель до полностью завершённой миграции.

---

## Что я делаю автономно

- Запуск агентов (один или параллельно)
- Сбор результатов
- Создание/правка файлов
- Локальные коммиты в feature branch
- Запуск тестов
- `gh pr create` (PR в main, не merge)
- Iterate если тесты падают

## Что только ты

- Approve / merge PR'ов в `main`
- `firebase deploy --only firestore` (Шаг 2)
- `firebase deploy --only functions` (Шаг 3, 5)
- `firebase deploy --only hosting` (Шаг 4, 6)
- Manual UAT
- Cutover окно (T-0 запуск migration script)
- Координация со внешним AI bot dev'ом если меняем URL

---

## Стартую с Шага 1?

Если ОК — создаю worktree `feature/tasktotime-foundation` и запускаю первых 5 агентов (backend-architect + Explore параллельно, потом backend-developer + test-generator + test-runner).
