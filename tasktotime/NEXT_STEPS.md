# Что дальше — план Phase 0 → Phase 1

**Статус на 2026-04-26:** Phase 0 (документы + mockup) **завершена**. Жду GO на Phase 1.

---

## ⏱️ TL;DR

```
[x] Phase 0: Audit + TZ v0.2 + 71-file spec + 3603-line mockup
[ ] ──── BLOCKER: 6 решений Дениса (см. §1 ниже) ────
[ ] Phase 1: Foundation (types + skeletons + rules) — 2 дня
[ ] Phase 2: Backend (REST + triggers + AI) — 3-4 дня
[ ] Phase 3: Frontend (hooks + components) — 5-7 дней
[ ] Phase 4: Telegram bot migration — 3 дня
[ ] Phase 5: Data migration + cutover — 1 день
[ ] Phase 6: Frontend cutover — внутри Phase 5
[ ] Phase 7: Cleanup (через 2 недели после Phase 5) — 2 дня
```

**Текущий блокер:** не могу стартовать Phase 1 пока ты не решишь 6 вопросов ниже.

**Не блокирующее:** есть 5 параллельных задач которые я могу делать пока ты решаешь — список в §3.

---

## 1. Что нужно от тебя — РЕШЕНИЯ (блокирующие)

Открой `spec/10-decisions/open-questions.md` — там полный список 16 вопросов с опциями. Из них **6 критичных для старта**:

### 1.1. Глубина иерархии — 2 уровня или 3?

ТЗ v0.2 фиксирует 2 уровня (Task → Subtask). Research (Notion / Linear / Asana) подтверждает что глубже путает. Но в стройке бывает: «Bathroom remodel» → «Plumbing rough-in» → «Run hot/cold lines» → «Solder joints» = 4 уровня.

**Опции:**
- (a) Жёстко 2 уровня. Глубокие декомпозиции = создаём отдельный проект. ← рекомендую
- (b) 3 уровня (компромисс)
- (c) Без ограничения, но default UI показывает 2 уровня

### 1.2. Cutover окно — какие выходные?

Phase 5 миграция данных + переключение пользователей. Окно 30-60 минут в воскресенье 02:00-04:00 EST (минимум активности бригадиров).

**Опции (выходные):**
- 17-18 мая 2026 (через 3 недели — реалистично для Phase 1-4)
- 24-25 мая 2026 (Memorial Day weekend — длинные выходные = больше времени на rollback если что)
- 31 мая - 1 июня
- Позже (укажи)

### 1.3. Один Claude или pipeline (Никита/Стёпа)?

Phase 2 (backend) и Phase 3 (frontend) можно делать параллельно через pipeline:
- Я (Claude Code в main worktree) → backend
- Никита (Claude Code Opus, через `/pickup`) → frontend
- Стёпа (Gemini) → tests + UI polish

Это сократит timeline с 5-6 недель до **3 недель active work**.

**Опции:**
- (a) Один я делаю всё последовательно. Медленнее, но проще координация.
- (b) Pipeline через task spec в `~/projects/pipeline/{date}/task-tasktotime-{phase}.md`
- (c) Гибрид — я делаю backend, Никита параллельно frontend, Стёпа QA

### 1.4. External AI bot (`@crmapiprofit_bot`) — что с URL?

Внешний разработчик использует `/api/gtd-tasks/*` endpoints (документация на `https://profit-step.web.app/bot-docs/`). При переходе на `/api/tasktotime/*`:

**Опции:**
- (a) Я держу прокси `/api/gtd-tasks/*` → `/api/tasktotime/*` навсегда. Bot dev ничего не меняет, мы тащим legacy URL forever.
- (b) Прокси на 1-2 месяца grace period, потом deprecate. Я предупреждаю dev'а сейчас, дам новый URL контракт.
- (c) Hard cutover — break URL когда мы закончим Phase 6, dev обновляет одновременно.

### 1.5. Status drift в `mediaHandler.ts` — что с legacy строками?

Telegram `mediaHandler.ts` пишет статусы `'todo'/'in_progress'`, которых нет в новом lifecycle.

**Опции:**
- (a) Translate-on-write — bot пишет legacy, на бэке translate в канонические. Bot не меняем (нет тестов).
- (b) Переписать handler с тестами + миграция значений в DB. Рискованно, но чисто.
- (c) Помечаем как «migrate later» = технический долг.

### 1.6. Wiki rollup — primary deliverable: markdown в UI или PDF файл?

В §13-14 я заложил оба варианта (Markdown view + PDF export). Что чаще нужно практически?

**Опции:**
- (a) Markdown в UI — частая операция. PDF — раз в месяц. → приоритет markdown viewer.
- (b) PDF — Денис чаще шлёт клиенту. → приоритет PuppeteerSharp PDF generator на бэке.
- (c) Оба равны.

---

## 2. Что нужно от тебя — НЕ блокирующее

### 2.1. Глянуть mockup и дать feedback

```bash
open /Users/denysharbuzov/Projects/profit-step/.claude/worktrees/inspiring-spence-90a275/tasktotime/mockup/index.html
```

Все 10 views + Drawer с 4 секциями. Скажи:
- Что нравится / не нравится визуально (цвета / spacing / иконки)
- Какой view самый полезный, какой ненужный
- Чего не хватает (другой view / другая info на карточке)
- Отметить в `spec/06-ui-ux/mockup-notes.md` — там placeholder для твоих заметок

### 2.2. Просмотреть spec/ структуру

```bash
open /Users/denysharbuzov/Projects/profit-step/.claude/worktrees/inspiring-spence-90a275/tasktotime/spec/
```

71 файл в 13 папках. Если что-то нужно перегруппировать / переименовать / разбить ещё мельче — скажи.

### 2.3. Подтвердить scope Phase 1-7

Прочитать `MIGRATION_PLAN.md` целиком (займёт ~20 мин). Если timeline 5-6 недель не подходит — скажи где ужать (можем дропнуть некоторые v0.2 модули типа Mind Map view → отложить до Phase 8 после стабилизации).

---

## 3. Что я могу делать пока ты решаешь (НЕ блокирующее)

Если хочешь, чтобы время не пропадало — могу запустить эти задачи **параллельно**, они не зависят от твоих 6 решений:

### 3.1. Написать `INSTRUCTION.md` для AI агентов

По образцу [tasks/INSTRUCTION.md](../tasks/INSTRUCTION.md). Чтобы будущие Никита/Стёпа/Claude видели контекст модуля без чтения всех 71 файла.

### 3.2. Создать starter-kit Phase 1 на отдельной ветке (без деплоя)

```
git worktree add .claude/worktrees/tasktotime-foundation -b feature/tasktotime-foundation
```

В нём:
- `tasktotime/frontend/types/Task.ts` — interface skeleton
- `tasktotime/frontend/types/lifecycle.ts` — transitions table + tests
- `tasktotime/backend/api/schemas.ts` — Zod schemas (single source)
- `tasktotime/shared/lifecycle.ts` — STATUS_OPTIONS / PRIORITY_OPTIONS / BUCKET_OPTIONS константы

Это можно закоммитить в feature branch без рисков для прода. PR в main делается потом, когда ты дашь GO.

### 3.3. Подготовить тест fixtures

`tasktotime/shared/fixtures/` — реалистичные mock tasks (как в HTML mockup'е, но в TypeScript для unit тестов).

### 3.4. Написать DEVELOPER_ONBOARDING.md

«Как зайти в проект» для будущих Никиты/Стёпы — какие файлы прочитать в каком порядке за первые 90 минут.

### 3.5. Поправить найденные баги в текущем gtd_tasks

В аудите нашёл несколько мелких dead-branch'ей: `'approved'` в `onTaskUpdate.ts:107`, `useGTDTasks` без company-scope. Можно зафиксить **до миграции** — снижает riск во время cutover. PRs маленькие, риск низкий.

---

## 4. Декomposition timeline (после твоих решений)

### Phase 1: Foundation (2 дня)
**Когда стартуем:** сразу после твоих решений §1.
**Что делаем:** types + skeletons + Firestore rules + indexes (без deploy).
**Branch:** `feature/tasktotime-foundation`
**PR:** Маленький — только новые файлы, ничего не ломает.
**Exit:** `npm run build` green, types экспортируются.

### Phase 2: Backend (3-4 дня)
**Параллельно с Phase 3 (если pipeline)** или **после Phase 1 (если соло)**.
**Что делаем:** REST API + 4 triggers + 6 callables + integration tests.
**PR в main:** только после интеграционных тестов в emulators.
**Деплой:** ты, после ревью.

### Phase 3: Frontend (5-7 дней)
**Что делаем:** hooks + 10 views + drawer + connector с Phase 2 API.
**Manual UAT:** ты на staging URL пробуешь все flows.

### Phase 4: Telegram bot (3 дня)
**Highest risk** — daily users, было без тестов.
**Что делаем:** переписать gtd/inbox/media handlers + написать тесты + dual-read во время Phase 5 cutover.

### Phase 5 + 6: Data migration + Cutover (1 день, в чёткое окно)
**Когда:** воскресенье ночью EST по твоему выбору (§1.2).
**Длительность:** 30-60 минут.
**Скрипт:** `scripts/migrate-gtd-to-tasktotime.ts` — idempotent.
**Verification:** counts equal + sample IDs match + lifecycle distribution sane.
**Rollback:** через `git revert` + redeploy за 5 минут (gtd_tasks остаётся как backup).

### Phase 7: Cleanup (через 2 недели после Phase 5)
**Soak period:** 14 дней наблюдения.
**Если без жалоб 14 дней** → удаляем старые файлы (move в `_archived/`).
**gtd_tasks коллекция:** read-only ещё 3 месяца, потом физическое удаление через admin script.

---

## 5. Decision tree (что я делаю при разных твоих ответах)

| Ты говоришь | Я делаю |
|---|---|
| «иди, стартуй Phase 1 как есть» | Создаю starter-kit (см. §3.2), пишу первый PR в main с types + skeletons + rules. Дальше по timeline §4. |
| «сначала параллельные задачи (§3)» | Делаю §3.1, §3.4, §3.5 параллельно. Phase 1 жду пока решишь §1. |
| «изменения в TZ» | Правлю spec/ файлы по твоим заметкам, обновляю TZ_TASKTOTIME.md changelog до v0.3. |
| «mockup надо доработать» | Возвращаю ui-designer'а с конкретным prompt'ом по твоим feedback. |
| «давай вообще другой подход» | Делаем step-back, обсуждаем альтернативы (например: вместо отдельного `tasktotime` модуля — incremental refactor существующего gtd_tasks). |
| «нет, делаем это позже» | Сохраняю состояние, mark Phase 0 done, возвращаемся когда скажешь. |

---

## 6. Что я НЕ буду делать без явного разрешения (CLAUDE.md §10)

- **`firebase deploy --only functions`** — деплой только ты
- **`firebase deploy --only hosting`** — деплой только ты
- **`git push --force` на main** — никогда без явного разрешения
- **Менять `firestore.rules` на проде** — только через PR + твой ревью
- **Удалять данные из gtd_tasks** — backup сохраняется 3 месяца, физическое удаление только с двойным confirmation

---

## 7. Reading order для тебя (если хочешь полный recap)

1. [README.md](README.md) — entry point (3 мин)
2. [NEXT_STEPS.md](NEXT_STEPS.md) — этот файл (5 мин)
3. [spec/README.md](spec/README.md) — навигация по 71-файловому spec (3 мин)
4. [spec/01-overview/context.md](spec/01-overview/context.md) — зачем модуль (5 мин)
5. [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) — 16 вопросов с опциями (15 мин)
6. [mockup/index.html](mockup/index.html) — открой в браузере (10 мин)
7. [MIGRATION_PLAN.md](MIGRATION_PLAN.md) — план миграции (20 мин)

**Итого ~60 минут** для полного контекста. После — отвечай на §1 и я стартую.

---

## 8. Ссылки на ключевые файлы

| Файл | Назначение | Когда трогать |
|---|---|---|
| [README.md](README.md) | Entry point | Не правишь обычно |
| [TZ_TASKTOTIME.md](TZ_TASKTOTIME.md) | Navigation index | Не правишь — превратился в TOC |
| [spec/](spec/) | 71 модульный spec файл | **Здесь редактируешь детали** |
| [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) | 16 вопросов | **Сюда вписываешь решения** |
| [spec/06-ui-ux/mockup-notes.md](spec/06-ui-ux/mockup-notes.md) | Заметки про mockup | **Сюда вписываешь feedback по mockup** |
| [MIGRATION_PLAN.md](MIGRATION_PLAN.md) | План миграции по фазам | Если хочешь сократить scope |
| [AUDIT_SUMMARY.md](AUDIT_SUMMARY.md) | Что было найдено в текущем коде | Read-only, для контекста |
| [docs/RESEARCH_2026-04-25.md](docs/RESEARCH_2026-04-25.md) | Research best practices | Read-only |
| [mockup/index.html](mockup/index.html) | Интерактивный prototype | **Открыть в браузере** |
