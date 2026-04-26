---
title: "06.1 UX-принципы (5 правил для дизайна)"
section: "06-ui-ux"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# UX-принципы (5 правил для дизайна)

> Из аудита `ui-ux-designer`. Эти 5 правил — фундамент всего UI модуля. Любое design-решение должно соответствовать им. Если нарушает — обсудить с Денисом перед реализацией.

## 1. One source of truth, multiple projections

**Правило:** одна `<TaskCard>` для всех контекстов (board, calendar, table, dashboard widget, client portal — каждый только меняет `variant`). Один `useTasks()` хук с projections (groupByStatus, groupByDate, groupByLocation). Один STATUS_OPTIONS (нет дублей).

**Обоснование:**
В существующем коде есть 4+ дублей: `<GTDTaskCard>`, `<TaskSquare>`, `<TaskTile>`, custom card в каждом widget'е. Каждая отображает по-своему — visual drift, баги в одной не починены в других, разные status colors. Это **design debt**, который мы с самого начала избегаем.

**Как реализуем:**
- `<TaskCard variant="compact" | "full" | "compact-with-progress">`
- `<TaskCard size="sm" | "md" | "lg">`
- `<TaskCard inContext="board" | "calendar" | "portal" | "dashboard">` (для conditional features)
- `useTasks(filter)` returns `{ tasks, byStatus, byDate, byLocation, byAssignee }` — все projections доступны

**Примеры в коде:**
- `tasktotime/frontend/components/TaskCard/TaskCard.tsx` — единственный
- `tasktotime/frontend/hooks/useTasks.ts` — единственный subscription hook

## 2. Front-load the contract

**Правило:** в первые 200ms взгляда — title, assignee, dueAt, location, lifecycle badge. Created-by, history, materials list, attachments — во второй ступени (раскрытие/Detail page). Cockpit = подробная страница, не заместитель карточки.

**Обоснование:**
Карточка задачи в kanban — это **триггер для решения**: «начать ли мне эту задачу?» За 200ms взгляда юзер должен понять самое важное. Если ему нужно искать assignee в 3-й строке мелким шрифтом — fail.

**Иерархия информации:**

| Уровень | Что показываем | Где |
|---|---|---|
| 1 (immediate, < 200ms) | title, lifecycle chip, assignee avatar, dueAt, priority dot | Карточка верх |
| 2 (на hover / expand) | description, location, материалы count, контакты | Карточка раскрытие |
| 3 (Detail page) | history, attachments, wiki, dependencies, payments | Отдельная страница |

**Примеры:**
- На kanban карточке НЕ показываем `createdAt` или `createdBy.name` — это второстепенно
- На kanban карточке показываем `dueAt` явно (с цветом overdue если применимо)

## 3. Lifecycle as state machine, не label

**Правило:** разделить `lifecycle` (state machine с правилами) и `bucket` (организационный тэг). Visual: lifecycle показывается как chip с цветом действия; bucket — как secondary label.

**Обоснование:**
Денис в требованиях смешивал «начата / закончена / просрочена / выполнена» — это разные категории:
- «начата», «закончена», «выполнена» — lifecycle states
- «просрочена» — derived state (computed)

Если в UI показывать всё как один chip — путаница. Юзер думает «просрочена» это финальное состояние, не понимает что задача в `started + overdue badge`.

**Как реализуем:**
- Lifecycle chip — primary visual, всегда виден
- Bucket — small label справа сверху (опционально)
- Derived states (overdue, at-risk, active, needs_acceptance) — additional badges рядом с lifecycle chip

См.: [`../03-state-machine/lifecycle.md`](../03-state-machine/lifecycle.md), [`../03-state-machine/derived-states.md`](../03-state-machine/derived-states.md)

## 4. AI-assisted, но reversible

**Правило:** все AI мутации — preview/diff перед применением. Snackbar «AI добавил 3 материала и сместил дедлайн → Undo» (4 секунды). TaskHistoryTimeline показывает AI-events отдельным иконом с возможностью откатить именно это действие.

**Обоснование:**
AI может ошибаться — особенно `modifyTask` команды («сдвинь на завтра»), `decomposeEstimate` (создаёт subtasks). Если применять silently — юзер не знает что произошло, не доверяет.

**Как реализуем:**
- Все AI mutations имеют `dryRun: true` режим — возвращают proposed changes без apply
- UI показывает diff (как Git diff): что было / что будет
- После подтверждения — snackbar с Undo 4s
- В `taskHistory[]` — AI events помечены иконкой Robot, с reasoning от AI (`changeSummary`)

См.: [`../07-ai/ai-safety.md`](../07-ai/ai-safety.md)

## 5. Mobile-first thumb zone

**Правило:** bottom 1/3 — primary actions (FAB, sticky timer). Bottom sheet pattern для secondary (как iOS Stocks). Touch targets ≥44×44 везде. Tabs Detail page → группировка в 3 секции (Работа / Деньги / Контекст), не 7.

**Обоснование:**
Воркер на стройке держит телефон одной рукой (вторая в перчатке / держит инструмент). Большой палец достаёт только до bottom 1/3 экрана. Кнопки в top bar — недоступны без перехвата.

**Как реализуем:**
- FAB (floating action button) с primary action — bottom right, в zone большого пальца
- Sticky timer — bottom row на active task page
- Bottom sheet модалки (slide up from bottom) для secondary (фильтры, sort options)
- Touch target min 44×44 px (Apple HIG)
- Tabs Detail page = 3 секции, не 7+:
  - **Работа** — журнал + таймер + checklist
  - **Деньги** — estimate + материалы + процентовка + payments
  - **Контекст** — история + контакты + чертежи + wiki

См.: [`mobile-thumb-zone.md`](mobile-thumb-zone.md)

---

**См. также:**
- [Views](views.md) — 10 views, каждый соответствует этим принципам
- [Mobile thumb zone](mobile-thumb-zone.md) — детально про mobile UX
- [Task card anatomy](task-card-anatomy.md) — что обязано показывать на карточке
- [`../03-state-machine/derived-states.md`](../03-state-machine/derived-states.md) — derived badges
- [`../07-ai/ai-safety.md`](../07-ai/ai-safety.md) — AI reversible safety
