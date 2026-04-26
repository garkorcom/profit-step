---
title: "10.1 Open questions (требуют решения Дениса)"
section: "10-decisions"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Открытые вопросы (требуют решения Дениса)

> 16 вопросов из ТЗ, которые требуют решения перед/во время реализации. Каждый — с placeholder для ответа Дениса. После решения — переносить в [`decision-log.md`](decision-log.md).

ТЗ §9.

## Вопросы из v0.1 (1-8)

### #1 — Notes vs Tasks

В системе есть `notes/{id}` — отдельная коллекция с qualityLoop / financials / controllerId. Конвертить notes в tasks (writer пока отсутствует), или Notes остаются отдельной подсистемой? Если конвертить — flow какой (manual button / AI auto-promote / on schedule)?

**Опции:**
- (a) Notes остаются отдельной подсистемой
- (b) Manual button «Convert to task» в Notes UI
- (c) AI auto-promote (через cron — найти notes с action items, создать tasks)
- (d) On schedule — Maintenance cron перевешивает старые notes

**Денис:** _[ожидает ответа]_

---

### #2 — Status drift cleanup

`mediaHandler.ts` пишет статусы `'todo'/'in_progress'`, которых нет в типе. Если строго типизировать — bot падает.

**Опции:**
- (a) Оставить bot писать legacy → translate на bound (proxy layer)
- (b) Заставить bot писать канонические значения (нужно править bot, рискованно — нет тестов)
- (c) Mediahandler пометить как «migrate later»

**Денис:** _[ожидает ответа]_

---

### #3 — Public read rule (Client Portal)

Client Portal сейчас читает `gtd_tasks` напрямую через web SDK (rule `read: if true`). При миграции:

**Опции:**
- (a) Закончить API-only переход → portal через `/api/tasktotime/portal/...` с auth
- (b) Оставить новый rule с client portal scope (но требует identification клиента — JWT?)

Вариант (a) предпочтительнее, но добавляет блокирующее зависимостью.

**Денис:** _[ожидает ответа]_

---

### #4 — Single dev / parallel dev

Миграцию делает один Claude или мульти-агент (Никита/Стёпа)? Если мульти — как координировать: spec в `~/projects/pipeline/{date}/task-tasktotime-{phase}.md`?

**Опции:**
- (a) Single Claude (sequential)
- (b) Никита + Стёпа через pipeline (см. CLAUDE.md §3)
- (c) Hybrid — Claude основная работа, Стёпа QA в parallel

**Денис:** _[ожидает ответа]_

---

### #5 — Production cutover strategy

**Опции:**
- (a) Dual-write период (новая + старая коллекция параллельно X дней)
- (b) Hard cutover в нерабочие часы

**Денис:** _[ожидает ответа]_

---

### #6 — External AI bot (`@crmapiprofit_bot`)

Менять URL контракта (`/api/gtd-tasks/*` → `/api/tasktotime/*`) или держать proxy навечно? Кто координирует со внешним разработчиком?

**Опции:**
- (a) Proxy навсегда (cost: maintenance burden)
- (b) Coordinate с внешним dev → migration с deadline
- (c) Hard cutover — наша responsibility закончилась если они не migrate

**Денис:** _[ожидает ответа]_

---

### #7 — Smart Task Constructor v2 (Motion-style 12 типов)

Оставлять или упрощать? В конструкшн-бизнесе типы могут быть свои (electrical / plumbing / hvac / framing / inspection / paperwork). Если оставлять — как plugin-extensible.

**Опции:**
- (a) Drop полностью
- (b) Заменить на construction-specific 6 типов
- (c) Оставить Motion-style + опционально extend

**Денис:** _[ожидает ответа]_

---

### #8 — Headcount (требование Дениса «сколько людей»)

Это static `requiredHeadcount: number`, или dynamic — связано с количеством `coAssignees`? Если static — что делать когда coAssignees > requiredHeadcount?

**Опции:**
- (a) Static `requiredHeadcount`, coAssignees free-form (over-allocation OK)
- (b) Static `requiredHeadcount`, validation: coAssignees.length ≤ requiredHeadcount
- (c) Dynamic — derived: `requiredHeadcount = max(1, coAssignees.length)`

**Денис:** _[ожидает ответа]_

---

## NEW v0.2 — открытые вопросы по hierarchy/graph/wiki (9-16)

### #9 — Жёсткий 2-level limit

Денис прав что в реальной стройке бывает 3+ уровней («Bathroom remodel» → «Plumbing rough-in» → «Run hot/cold water lines» → «Solder joints»)? Если да — позволяем 3 уровня, или предлагаем оформить как **проект** для глубоких декомпозиций? Решение влияет на сложность tree view и на UX.

**Опции:**
- (a) Strict 2-level (current default), 3+ → конвертировать в project
- (b) 3 levels max
- (c) Unlimited (как ClickUp — anti-pattern)

**Денис:** _[ожидает ответа]_

См.: [`../08-modules/hierarchy/model.md`](../08-modules/hierarchy/model.md)

---

### #10 — Auto-rollup `parent.lifecycle` (Linear-style)

Автоматически менять lifecycle parent'а при изменении subtasks (см. правила в auto-rollup) — или только баннер «5 из 5 subtasks приняты — подписать акт parent?» без auto-update? Auto = меньше кликов, но опаснее.

**Опции:**
- (a) Banner only (default — safer)
- (b) Auto-update for some transitions (e.g. all cancelled → parent cancelled), banner for others
- (c) Full auto-update with undo snackbar

**Денис:** _[ожидает ответа]_

См.: [`../08-modules/hierarchy/auto-rollup.md`](../08-modules/hierarchy/auto-rollup.md)

---

### #11 — Wiki edit permissions

Кто может редактировать wiki? Только assignee и creator? Или вся бригада? Reviewer? Клиент через portal (read-only? edit-suggestions?).

**Опции:**
- (a) Только assignee + creator
- (b) Все members company со scope match
- (c) Tiered: внутри company — все edit; client portal — read-only
- (d) Flexible per-task: setting на task «Wiki edit visibility»

**Денис:** _[ожидает ответа]_

См.: [`../08-modules/wiki/concept.md`](../08-modules/wiki/concept.md)

---

### #12 — Wiki rollup vs PDF export как primary deliverable

Денис чаще хочет rolled-up markdown в UI, или PDF файл для отправки клиенту? Влияет на приоритеты Phase 3 — markdown viewer vs PuppeteerSharp PDF generator.

**Опции:**
- (a) Markdown viewer first (cheaper to implement)
- (b) PDF generator first (если клиенты ожидают PDF)
- (c) Оба parallel (more dev cost)

**Денис:** _[ожидает ответа]_

См.: [`../08-modules/wiki-rollup/concept.md`](../08-modules/wiki-rollup/concept.md)

---

### #13 — Wiki Templates — кто куратор?

Templates (как «Bathroom remodel — full») создают PMs ad-hoc, или мы делаем стартовый набор системой из 20-30 industry-standard templates? Если системные — кто их пишет (мы / Денис / hire content writer)?

**Опции:**
- (a) PMs создают сами per-need (default)
- (b) System-provided 20-30 templates (Денис пишет)
- (c) System-provided 20-30 templates (hire content writer)
- (d) Mixed — basic system templates + PM custom

**Денис:** _[ожидает ответа]_

См.: [`../08-modules/wiki/templates.md`](../08-modules/wiki/templates.md)

---

### #14 — NOAA weather integration — Tampa-only или multi-region?

Сейчас все клиенты в Tampa. Если планируется outside Florida — нужно multi-region weather API. Откладываем или делаем generic?

**Опции:**
- (a) Tampa-only NOAA (US only)
- (b) Generic — поддержка US-wide через NOAA + fallback для other countries
- (c) Defer — weather feature только когда expand outside Tampa

**Денис:** _[ожидает ответа]_

См.: [`../08-modules/construction-gantt/weather-day.md`](../08-modules/construction-gantt/weather-day.md)

---

### #15 — Punch list timing

Денис хочет punch list как category на task — но WHEN punch list automatically становится visible? В Buildertrend он создаётся за неделю до acceptance.

**Опции:**
- (a) Manual creation (visible immediately после создания)
- (b) Auto-suggest «Create punch list» когда parent.lifecycle === 'completed'
- (c) Auto-create empty punch list 7 дней до dueAt (Buildertrend-style)

**Денис:** _[ожидает ответа]_

См.: [`../08-modules/construction-gantt/punch-list.md`](../08-modules/construction-gantt/punch-list.md)

---

### #16 — Mind Map view (DAG) — отдельный таб или внутри Detail page?

Денис изначально хотел «много отображений», но Mind Map потребляет много экрана.

**Опции:**
- (a) Top-level view-таб (`/tasktotime?view=graph`)
- (b) Только Detail page → tab «Зависимости» (mini-graph)
- (c) Both — top-level для project-wide, mini в Detail page

**Денис:** _[ожидает ответа]_

См.: [`../08-modules/graph-dependencies/dag-visualization.md`](../08-modules/graph-dependencies/dag-visualization.md)

---

## Status

После решения Денисом — обновить этот файл (пометить вопрос RESOLVED) + добавить запись в [`decision-log.md`](decision-log.md).

---

**См. также:**
- [What not to do](what-not-to-do.md) — что точно НЕ делаем
- [Decision log](decision-log.md) — template для решений
- [`../README.md`](../README.md) — навигация
