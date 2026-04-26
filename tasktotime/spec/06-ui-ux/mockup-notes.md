---
title: "06.3 Заметки по mockup — gap analysis"
section: "06-ui-ux"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-26
version: 0.2
---

# Mockup vs spec — gap analysis

> Cross-reference аудит между HTML mockup (`tasktotime/mockup/index.html`, 3603 строки) и модульным ТЗ (`tasktotime/spec/`, 71 файл). Найденные расхождения — это roadmap для финализации Phase 0 → Phase 1.
>
> **Метод:** прочитан весь mockup (10 views + Drawer с 4 секциями + Wiki) и ключевые spec файлы (UX/data-model/modules). Сравнение field-by-field, button-by-button.

## TL;DR

- **24 gap'а в TZ** — что в mockup есть/решено, но не описано в spec/
- **18 gap'ов в mockup** — что spec обещает, но не реализовано в HTML
- **Critical: 9 gaps** требуют немедленной правки до старта Phase 1 (расхождения в data model + UX расхождения которые меняют контракт)
- **Important: 17 gaps** уточнить до начала имплементации компонентов
- **Nice-to-have: 16 gaps** можно отложить на Phase 2-4

---

## Список A — Gaps в TZ (что доделать в spec/)

### A1. Mock data использует плоские поля (`assignee`, `dueAt`, `client`), spec задаёт вложенные (`assignedTo: UserRef`, `dueAt: Timestamp`, `clientName`)

- **Где в mockup:** `index.html:170-499` (TASKS array). Используются `assignee: 'w1'` (просто id), `coAssignees: ['w8']` (ids), `client: 'Jim Dvorkin'` (string), `dueAt: '2026-04-25T20:00:00-04:00'` (string), `estMinutes`, `actualMinutes`, `costInternal`/`priceClient` — **числа**, не объекты.
- **Что не покрыто в spec:** `02-data-model/task-interface.md` определяет `assignedTo: UserRef`, `dueAt: Timestamp`, `costInternal: Money` (объект). Spec НЕ упоминает плоский DTO для UI.
- **Severity:** critical
- **Что доделать:** в `02-data-model/task-interface.md` добавить раздел «Wire format vs domain model» — UI получает уплощённый DTO (как в mockup), backend хранит rich types. Описать функцию `taskToTaskDto(t: Task): TaskDto` для маппинга. Альтернатива — обновить mockup на rich types (но тогда Денис ревьювил уже плоский — это изменит выглядящие тексты).

### A2. Задачи в mockup имеют поля `code`, `desc`, `blocks`, `dependsOn` (массив id), `deps` — spec оперирует `taskNumber`, `description`, `blocksTaskIds`, `dependsOn: TaskDependency[]`

- **Где в mockup:** `index.html:194-499` — `code: 'T-2026-0042'`, `desc: '...'`, `blocks: ['t3']`, `dependsOn: ['t1']` (массив id, не объектов).
- **Что не покрыто в spec:** `02-data-model/task-interface.md` определяет `taskNumber`, `description`, `blocksTaskIds`, `dependsOn: TaskDependency[]` (объекты с type/lag).
- **Severity:** critical
- **Что доделать:** в spec добавить таблицу маппинга «mockup field → spec field». Уточнить, что `dependsOn` в mockup — упрощение для прототипа; при имплементации использовать `TaskDependency[]` (которое уже описано в `sub-types.md`).

### A3. `TASK_PATCHES` структура не задокументирована — это hack для разделения mock data и hierarchy/wiki/graph patches

- **Где в mockup:** `index.html:509-657` — отдельный объект `TASK_PATCHES = { t1: { parentTaskId, subtaskIds, plannedStartAt, plannedEndAt, ..., wiki }, ... }` затем `TASKS.forEach(t => Object.assign(t, TASK_PATCHES[t.id]))`.
- **Что не покрыто в spec:** spec не упоминает что `plannedEndAt` существует — только `plannedStartAt` + `dueAt`. Mockup использует `plannedEndAt` повсеместно для Gantt.
- **Severity:** critical
- **Что доделать:** в `02-data-model/task-interface.md` добавить поле `plannedEndAt?: Timestamp` (опциональное; если null — fallback на `dueAt`). Это нужно для Plan vs Actual бара в Gantt — в mockup без `plannedEndAt` бар не отрисуется.

### A4. Поля `actualEndAt` и `timerStartedAt` отсутствуют в spec

- **Где в mockup:** `index.html:202-498` — `actualStartAt`, `actualEndAt`, `timerStartedAt: '2026-04-25T15:42:00-04:00'`, `timerRunning: true`. В Gantt: `actualEndAt = null + timerRunning` → бар тянется до now.
- **Что не покрыто в spec:** `task-interface.md` имеет `actualStartAt`, `completedAt`, но не `actualEndAt`. Поле `timerRunning` / `timerStartedAt` нигде не описано.
- **Severity:** critical
- **Что доделать:** в `02-data-model/task-interface.md` явно добавить:
  - `actualEndAt?: Timestamp` (отличается от `completedAt` — может быть pause без complete)
  - `timerRunning: boolean` + `timerStartedAt?: Timestamp` — derived от active work_session, но используется в UI напрямую
  Альтернатива: в `derived-states.md` добавить `is_active` уже есть, но не описано как UI получает `timerStartedAt` для отображения «5h 42m running».

### A5. Поле `bucket` имеет значение `'next'` для большинства задач — bucket логика недоиспользована

- **Где в mockup:** `index.html:198, 219, ..., 502` — почти все задачи `bucket: 'next'`, две `bucket: 'inbox'` (t9, t14), три `bucket: 'archive'` (t8, t11). На Board view бакеты не используются для колонок (только lifecycle).
- **Что не покрыто в spec:** `03-state-machine/bucket.md` описывает 4 bucket'а (`inbox/next/someday/archive`) и говорит что они независимы от lifecycle. Но в `views.md` упомянут bucket как secondary toggle на Board view — в mockup такого toggle нет.
- **Severity:** important
- **Что доделать:** в `06-ui-ux/views.md` Board view секции уточнить: «Toggle bucket-mode в Phase 0 не реализован в mockup; но архитектура должна поддерживать. На MyTasks view группировка по bucket уже планируется». Также в `bucket.md` явно написать что в default Board view используется ТОЛЬКО lifecycle колонки (как в mockup).

### A6. Header содержит элементы которые нигде не специфицированы

- **Где в mockup:** `index.html:715-780` — header с logo (TaskToTime gradient icon), search bar с `⌘K` shortcut hint, filter chips «Все»/«Команда», AI assist кнопка градиент violet-to-indigo, theme toggle (sun/moon), notifications bell с red badge «3», user avatar «Д».
- **Что не покрыто в spec:** ни один spec файл не описывает global header. `principles.md` упоминает FAB и sticky timer, но не header.
- **Severity:** important
- **Что доделать:** создать `06-ui-ux/header.md` или в `views.md` добавить раздел «Global header» — описать:
  - Logo + brand
  - Global search с `⌘K` shortcut
  - Notifications panel (TBD — куда нажимает на «3»)
  - User menu (avatar)
  - Theme toggle (см. §A23)
  - AI assist global button — что происходит при click (в mockup просто toast)

### A7. `coAssignees` / `requiredHeadcount` рендеринг в карточке отличается от описания anatomy

- **Где в mockup:** `index.html:993-994` — `${coAssignees.length > 0 ? '+N' : ''}` и `requiredHeadcount > 1 ? <i>users</i>${headcount}`. Stacked avatars НЕ реализованы.
- **Что не покрыто в spec:** `task-card-anatomy.md:127-129` обещает «assignedTo + 1-2 coAssignees: stacked avatars (overlapping)» и «3+ → stacked + counter +3». В mockup просто число без стэкинга.
- **Severity:** nice-to-have
- **Что доделать:** в `task-card-anatomy.md` секцию «Avatar handling» либо обновить под mockup (text counter «+1») либо явно отметить что в mockup упрощено и в React-компоненте делать stacked. Решить с Денисом: stacked avatars или simple counter.

### A8. Компактные derived badges в карточке — mockup использует «Просрочена», «Под риском», «Ждёт акт», «LIVE» — spec говорит про «Overdue / At risk / Needs acceptance» (английские)

- **Где в mockup:** `index.html:967-970` — все badges на русском.
- **Что не покрыто в spec:** `task-card-anatomy.md:107-120` использует английские labels.
- **Severity:** nice-to-have
- **Что доделать:** в `task-card-anatomy.md` явно указать i18n: labels через i18n keys, а не hardcoded. Либо переключить spec на русские labels (т.к. это рабочий язык Дениса). Решить однозначно.

### A9. Карточка показывает money-чипы «+$100 вовремя» / «−$150 опозд.» — это `bonusOnTime`/`penaltyOverdue`. В spec они не упомянуты в anatomy

- **Где в mockup:** `index.html:1015-1019` — bonus/penalty badges на карточке. Также в Drawer Section 2 (`index.html:3066-3070`) отдельные блоки.
- **Что не покрыто в spec:** `task-card-anatomy.md` не упоминает bonus/penalty badges на compact карточке. `task-interface.md` есть поля но без UI спецификации.
- **Severity:** important
- **Что доделать:** в `task-card-anatomy.md` секцию «Также (если применимо)» добавить bonus/penalty badges как level 1 элемент — они влияют на decision worker'а взять задачу или нет.

### A10. Категория `inspection`/`permit`/`punch`/`work` показывается chip-меткой («INSP», «PERM», «PUNCH») — нигде не описано

- **Где в mockup:** `index.html:1167-1170` (Tree view) и `index.html:2024` (Timeline) — chip-метки `INSP`/`PERM`/`PUNCH`. Цвета: purple/amber/orange.
- **Что не покрыто в spec:** `sub-types.md` определяет `TaskCategory`, но визуальное представление (badge color, abbreviation) нигде не задокументировано.
- **Severity:** important
- **Что доделать:** в `task-card-anatomy.md` или новый файл `category-chips.md` описать визуальное представление каждой категории (color + abbreviation + tooltip). Согласовать с `milestones.md` который описывает diamond visual для inspection/permit в Gantt.

### A11. Tree view counter «3/5» — это `subDone/subTotal`, но spec говорит про `subtaskRollup.completedFraction` + `countByLifecycle.accepted`

- **Где в mockup:** `index.html:1148-1149, 1172` — counter использует только `accepted+completed` как «done». В Tree view — chip `<i>check-square</i> 3/5`.
- **Что не покрыто в spec:** `task-card-anatomy.md:74-77` обещает «accepted / subtasks.length» как counter. `subtaskRollup.completedFraction` — отдельное поле для progress bar.
- **Severity:** nice-to-have
- **Что доделать:** в `task-card-anatomy.md` уточнить — counter в Tree view показывает `(completed+accepted)/total`, а progress bar в `compact-with-progress` показывает `completedFraction`. Это два разных UX элемента, оба нужны.

### A12. Tree view sidebar (counters + filters + actions) полностью не задокументирован

- **Где в mockup:** `index.html:1224-1293` — правый sidebar в Tree view: 4 stat cards (Корневых/Подзадач/Готово/Просроч.), фильтры (Только мои/Скрыть completed/Group by phase), Actions (Раскрыть всё/Свернуть всё/AI разбить), Легенда (lifecycle colors + INSP/PERM/CP chips).
- **Что не покрыто в spec:** `tree-view-ui.md` описывает только дерево и MUI X TreeView. Sidebar с counters не упомянут.
- **Severity:** important
- **Что доделать:** в `08-modules/hierarchy/tree-view-ui.md` добавить раздел «Sidebar (right pane)» — описать stats, filters, actions. Это load-bearing UX.

### A13. Tree view group-by phase toggle — spec не описывает что группировка может быть `client.project` ИЛИ `phase`

- **Где в mockup:** `index.html:1126-1129` — `treeState.groupByPhase` toggle меняет ключ группировки между `${client} · ${project}` и `t.phase`.
- **Что не покрыто в spec:** `tree-view-ui.md` не описывает group-by toggle.
- **Severity:** nice-to-have
- **Что доделать:** в `tree-view-ui.md` секцию «Sidebar» добавить toggle «Group by phase» — описать когда полезно (большой проект с unclear phases).

### A14. Calendar view: backlog sidebar (задачи без `plannedStartAt`) — нигде не описан

- **Где в mockup:** `index.html:1442-1460` — правый sidebar показывает все задачи без `plannedStartAt` для drag-into-calendar.
- **Что не покрыто в spec:** `views.md` Calendar секция упоминает «DnD reschedule» но не Backlog sidebar.
- **Severity:** important
- **Что доделать:** в `views.md` Calendar секцию добавить «Backlog sidebar — задачи без даты, drag-to-schedule».

### A15. Live Ops (WhoDoesWhat) view — детали реализации в mockup не покрыты в spec

- **Где в mockup:** `index.html:1474-1636` — workers группированы по `status` (active/idle/offline), для каждого: avatar с status dot, hours bar (% от 8h target), current task с emerald glow, counters (готово/в плане/всего), кнопка «Написать» (Telegram chat). Header со фильтрами (Вся компания/Моя бригада/По локации) + sort dropdown + 4 summary chips (Активны/Свободны/Активных задач/Просрочены).
- **Что не покрыто в spec:** `views.md:60-66` описывает WhoDoesWhat в 5 строках — нет деталей про status grouping, hours bar, current task glow, counters, Telegram кнопку, summary chips.
- **Severity:** important
- **Что доделать:** в `views.md` секцию WhoDoesWhat расширить или вынести в новый файл `08-modules/live-ops.md`. Описать:
  - Worker status: `active/idle/offline/off-duty` — где это берётся? (work_session activity? presence?)
  - Hours bar: `hoursToday / 480min` — источник данных
  - Current task glow + LIVE badge
  - Action buttons: Telegram chat, write note
  - Summary chips: Active/Idle/Active tasks/Overdue counts

### A16. Dispatch view — Pool/Crew layout детально не описан

- **Где в mockup:** `index.html:1638-1803` — двух-колоночный layout: Pool (задачи к раздаче, группированы по priority с цветными рамками) + Crew (workers с workload bars, expandable details). Кнопка «AI Auto-Dispatch» в header. Каждый worker — `<details>` collapse, показывает workload + tasks + drop zone «Брось сюда задачу».
- **Что не покрыто в spec:** `views.md:69-76` описывает Dispatch как «Mobile-first, sticky timer, quick actions». Это **противоречит** mockup — в mockup Dispatch это **desktop PM tool**, не mobile.
- **Severity:** critical
- **Что доделать:** в `views.md` переписать Dispatch секцию:
  - Use case: PM-инструмент распределения задач (desktop-first)
  - Layout: Pool (left) + Crew (right)
  - Pool: группировка по priority с color coding
  - Crew: workload bars (target 480min), overload chip
  - Actions: drag-from-pool, AI Auto-Dispatch button
  - Mobile? — ясно ответить (mockup не mobile-friendly)
  
  Если Денис подтвердит — Dispatch это desktop PM tool, **отделить** от mobile worker view (которое = MyTasks).

### A17. Timeline (Gantt) — toolbar toggles только частично описаны

- **Где в mockup:** `index.html:2078-2110` — toolbar содержит:
  - Toggle «Baseline (план)» — показывать/скрывать baseline thin bar
  - Toggle «Critical Path» — подсветка CP
  - Toggle «Dependencies» — стрелки между tasks
  - Group-by select: none/project/crew/phase
  - View select: День/Неделя/Месяц
- **Что не покрыто в spec:** `views.md:78-89` упоминает features через ссылки. Group-by `crew` не упомянут в `group-by.md`. Toggle «Baseline» — нет в spec.
- **Severity:** important
- **Что доделать:** в `08-modules/construction-gantt/group-by.md` добавить опцию `crew` (group by assignee). В `plan-vs-actual.md` описать toggle «Baseline» — что делает (скрывает thin grey план-бар, оставляя только actual).

### A18. Timeline legend block — spec не описывает что должна показывать legenda

- **Где в mockup:** `index.html:2113-2137` — legend block с 6 элементами: Baseline / Actual / Overdue (stripes-pattern) / Saved time (sparse stripes) / Milestone diamond / Weather marker. Видна над Gantt.
- **Что не покрыто в spec:** `plan-vs-actual.md` показывает примеры баров но не определяет UI legend.
- **Severity:** nice-to-have
- **Что доделать:** в `plan-vs-actual.md` добавить раздел «Legend» — обязательный block над Gantt с визуальными примерами всех состояний.

### A19. Timeline «Saved time» (stripes-saved) — не упомянут в spec

- **Где в mockup:** `index.html:1923-1929` (mock CSS line 114-122 + render logic) — если `actual.end < plan.end && !ongoing` → отображается stripes-saved zone (пунктирная зелёная штриховка) от actualEnd до planEnd. Tooltip «Saved time: ${minutes} раньше плана».
- **Что не покрыто в spec:** `plan-vs-actual.md:40-51` показывает примеры on-time/late, но НЕ показывает «started on time, ended early» с зелёной штриховкой.
- **Severity:** important
- **Что доделать:** в `plan-vs-actual.md` добавить раздел «Saved time visualization» — описать что есть тип состояния «закончил раньше плана» с зелёной штриховой зоной. Это важно для bonus calculation.

### A20. Graph view: drag-pan и mouse-wheel zoom описаны в xyflow доке, но mockup использует ручной pan/zoom

- **Где в mockup:** `index.html:2384-2432` — кастомный pan/zoom через pointer events, не xyflow. Есть `applyGraphTransform()` функция.
- **Что не покрыто в spec:** `dag-visualization.md` использует `@xyflow/react` который имеет встроенный pan/zoom. Mockup сделан кастомно для прототипа.
- **Severity:** nice-to-have
- **Что доделать:** в `dag-visualization.md` явно отметить «pan/zoom — встроены в xyflow, в React не нужно реимплементировать как в mockup». Это help для разработчиков чтобы они не копировали кастомный код.

### A21. Graph view: mini-map (downscaled overview) и stats overlay (узлы/рёбра/CP count + zoom %) — реализованы в mockup, но детали не в spec

- **Где в mockup:** `index.html:2353-2377` — mini-map в правом нижнем углу (130×90px) с downscaled nodes + viewport indicator. Stats overlay в правом верхнем (узлов/деп/CP/zoom%).
- **Что не покрыто в spec:** `dag-visualization.md:71-73` упоминает mini-map одной строкой. Stats overlay не упомянут.
- **Severity:** nice-to-have
- **Что доделать:** в `dag-visualization.md` добавить раздел «Overlays» — mini-map (140×90px, viewport indicator), stats overlay (counts), zoom controls (fixed top-left).

### A22. Graph view: edge labels с lag (e.g. «FS+2h») — mockup рисует rect+text labels на edges, в spec не описано

- **Где в mockup:** `index.html:2240-2247` — на каждом edge SVG: `<rect>` background + `<text>` label типа `FS+2h`. Виден lag в часах.
- **Что не покрыто в spec:** `dag-visualization.md` описывает edge styles по типам (FS/SS/FF) через `strokeDasharray`, но не label с lag.
- **Severity:** important
- **Что доделать:** в `dag-visualization.md` секцию «Стрелки (Dependencies)» добавить «edge label показывает type + lag»: small rect background + text «FS+2h» / «SS» / «FF+1d». Согласуется с `task-dependency-interface.md` где `lagMinutes` хранится.

### A23. Theme toggle (dark/light) и `localStorage('tt-theme')` — нигде не упомянуто

- **Где в mockup:** `index.html:888-894` — `toggleTheme()`, persistence в `localStorage`, fallback на `prefers-color-scheme`. Все компоненты имеют dark variants.
- **Что не покрыто в spec:** spec упоминает «dark theme» в `task-card-anatomy.md` цветовой таблице, но не описывает global theme toggle.
- **Severity:** nice-to-have
- **Что доделать:** в `06-ui-ux/principles.md` или новом `theming.md` добавить раздел «Dark/light theme» — toggle в header, persistence, fallback на system preference.

### A24. Hotkeys (`Esc` закрывает Drawer, `⌘K` фокусирует поиск) — реализованы в mockup, нет в spec

- **Где в mockup:** `index.html:3525-3534` — keydown listener для ESC и Cmd/Ctrl+K.
- **Что не покрыто в spec:** spec про `principles.md` упоминает «keyboard shortcuts» только в editor (Wiki), но не глобальные.
- **Severity:** nice-to-have
- **Что доделать:** в `principles.md` или новом `keyboard-shortcuts.md` описать global hotkeys: ESC (close drawer/modal), `⌘K`/`Ctrl+K` (focus global search), потенциально `?` (show shortcuts help), `j/k` (navigate up/down в листах).

---

## Список B — Gaps в mockup (что доделать в HTML или отметить как TODO)

### B1. Drag & drop в Board view — нет реальной DnD логики

- **Где в spec:** `views.md:35` обещает «Drag card между колонками = transition action», `principles.md:45` про lifecycle as state machine.
- **Что отсутствует в mockup:** карточка кликабельна (открывает drawer), но drag-drop не реализован.
- **Severity:** important
- **Что делать:** в `mockup-notes.md` отметить TODO для Phase 1. Mock — visual only сейчас, OK.

### B2. Calendar drag-to-reschedule — нет

- **Где в spec:** `views.md:41` обещает «DnD reschedule — drag task на новый день = update plannedStartAt + dueAt».
- **Что отсутствует в mockup:** клики на день и задачи работают, но DnD reschedule только visual.
- **Severity:** important
- **Что делать:** TODO в Phase 1. Mock OK.

### B3. Tree DnD subtask между parents — нет visual affordance

- **Где в spec:** `08-modules/hierarchy/tree-dnd.md` (отдельный файл).
- **Что отсутствует в mockup:** subtasks нельзя перетаскивать между parents. Кнопка «+ Sub» есть на hover, но просто toast.
- **Severity:** important
- **Что делать:** TODO в Phase 1. Опционально: добавить в mockup hover-affordance с курсором grab.

### B4. Drag-to-create dependency в Graph view — нет

- **Где в spec:** `dag-visualization.md:191-205` описывает «Drag-to-create dependency через xyflow Connection mode».
- **Что отсутствует в mockup:** граф в read-only mode. Нельзя соединить два узла.
- **Severity:** nice-to-have (Phase 1+)
- **Что делать:** оставить TODO. Mock не должен реализовывать (xyflow built-in features).

### B5. Wiki AI helper — кнопка «AI: Дополни» только показывает toast

- **Где в spec:** `08-modules/wiki/ai-helper.md` (отдельный файл с диалоговым flow).
- **Что отсутствует в mockup:** `index.html:3394` кнопка приклеена к toast «AI предлагает добавить раздел "Permits & inspections"». Нет UI диффа / preview.
- **Severity:** important
- **Что делать:** в mockup добавить упрощённый AI Helper modal — текст «AI predicted addition» с кнопками Apply/Reject. Phase 1 имплементация — реальный AI flow.

### B6. Wiki templates picker — кнопка только показывает toast

- **Где в spec:** `08-modules/wiki/templates.md` описывает picker UI с категориями.
- **Что отсутствует в mockup:** `index.html:3398-3401` — кнопка «Templates» приклеена к toast «Templates library открыта».
- **Severity:** important
- **Что делать:** добавить в mockup template picker modal — простой list с 5-10 templates (bathroom, kitchen, permit pickup, demo, drywall hang).

### B7. Wiki conflict resolution UI — нет

- **Где в spec:** `editor-ui.md:118-136` описывает «Conflict UI как Notion» (Apply theirs first / Discard mine / Manual merge).
- **Что отсутствует в mockup:** редактор не симулирует concurrent edit.
- **Severity:** nice-to-have
- **Что делать:** оставить TODO — это сложный edge case, Phase 1 имплементация.

### B8. Slash-commands в Wiki editor — нет

- **Где в spec:** `editor-ui.md:140-160` описывает `/photo`, `/checklist`, `/link-task`, `/contact`, `/template`, `/divider`.
- **Что отсутствует в mockup:** редактор — простой `<textarea>`, никаких slash-commands.
- **Severity:** important (для UX контракта)
- **Что делать:** добавить в mockup минимальное demo slash-menu (на `/` показывает popup с командами). Phase 1 — реальный rich editor через `@uiw/react-md-editor`.

### B9. Acceptance form modal — нет

- **Где в spec:** `task-interface.md` поле `acceptance: AcceptanceAct` + lifecycle transition `complete → accepted`.
- **Что отсутствует в mockup:** в Drawer Section 2 (`index.html:3129-3136`) есть placeholder «Открыть форму подписи», который только toast'ит.
- **Severity:** critical
- **Что делать:** добавить в mockup AcceptanceForm modal — поля: signedByName, photos, notes, кнопка «Подписать». Phase 1 — реальная форма + PDF generation. Это ключевой workflow для бизнеса (закрытие проекта).

### B10. Reviewer flow (UI «отправить на ревью») — нет

- **Где в spec:** `task-interface.md` поле `reviewedBy: UserRef`. В `lifecycle.md` transition `started → completed` упомянут, но review-state нет.
- **Что отсутствует в mockup:** reviewer показан только как label в Drawer (Section 3), но нет UI «отправить на проверку».
- **Severity:** important
- **Что делать:** уточнить в spec — `reviewedBy` это noted assignee для проверки или есть отдельный workflow `completed → in_review → accepted`? В mockup пока нет, но если workflow — добавить кнопку в transitions.

### B11. Linked contacts call/sms кнопки — visual only

- **Где в spec:** `task-interface.md` поле `linkedContactIds[]`.
- **Что отсутствует в mockup:** `index.html:3225-3226` — phone и message-circle кнопки без действия (нет `tel:` / `sms:` href).
- **Severity:** nice-to-have
- **Что делать:** в mockup сделать `<a href="tel:${phone}">` чтобы реально работали. Простая правка.

### B12. AI auto-fill flow — нет UI

- **Где в spec:** `07-ai/auto-fill.md` (отдельный файл) — AI заполняет поля при создании task.
- **Что отсутствует в mockup:** Task creation wizard вообще нет в mockup (FAB просто toast'ит).
- **Severity:** critical
- **Что делать:** добавить в mockup модалку Quick Add (3 поля: title, project, dueAt) + AI suggestion дополнить остальные. Phase 1 — реальный AI flow.

### B13. AI decompose-estimate flow — нет UI

- **Где в spec:** `07-ai/decompose-estimate.md` (отдельный файл).
- **Что отсутствует в mockup:** в Tree view `index.html:1274-1276` есть кнопка «AI: Разбить на подзадачи» — только toast.
- **Severity:** important
- **Что делать:** добавить в mockup упрощённый decompose modal — введи описание → AI предлагает 5 подзадач → можно apply.

### B14. AI anomaly detection — нет UI

- **Где в spec:** `07-ai/anomaly-detection.md` (отдельный файл).
- **Что отсутствует в mockup:** нет дашборда / banner с anomalies.
- **Severity:** nice-to-have
- **Что делать:** Phase 4+ feature. Skip в mockup.

### B15. Bonus/penalty cron — UI нет

- **Где в spec:** `07-ai/bonus-penalty-cron.md` (отдельный файл).
- **Что отсутствует в mockup:** Bonus/penalty показаны на карточке и в drawer как fixed суммы — но нет UI как они вычисляются / откуда берутся.
- **Severity:** nice-to-have
- **Что делать:** в spec добавить UI спецификацию для bonus/penalty — где worker видит что заработал/потерял. В mockup — пока OK.

### B16. Auto-shift cascade preview — нет

- **Где в spec:** `08-modules/graph-dependencies/auto-shift-cascade.md`.
- **Что отсутствует в mockup:** при изменении dueAt одной задачи — нет preview модалки «5 задач сдвинутся, ОК?».
- **Severity:** important
- **Что делать:** добавить в mockup модалку с preview (UI тот же что для weather-day). Phase 1 — backend cascade + frontend preview.

### B17. Cycle prevention UI feedback — нет

- **Где в spec:** `08-modules/graph-dependencies/cycle-prevention.md`.
- **Что отсутствует в mockup:** при попытке создать circular dependency нет UI ошибки.
- **Severity:** nice-to-have
- **Что делать:** Phase 1 implementation. Mockup OK.

### B18. Punch list bulk add UI — нет

- **Где в spec:** `08-modules/construction-gantt/punch-list.md:90-101` обещает «Add multiple punch items modal с textarea».
- **Что отсутствует в mockup:** есть punch tasks в данных, но нет UI создания.
- **Severity:** nice-to-have
- **Что делать:** Phase 1. В mockup опционально добавить кнопку «+ Punch» в toolbar Timeline.

---

## Категорированные итоги

### Должны быть в Phase 0 (исправить до Phase 1, blocking):

1. **A1, A2, A3, A4** — синхронизация data model между mockup и spec (`plannedEndAt`, `actualEndAt`, `timerRunning`, плоский DTO vs rich types). **Без этого** разработчик не сможет корректно мапнуть mockup → React component.
2. **A16** — переписать Dispatch view спецификацию: либо это desktop PM tool (как mockup), либо mobile worker view (как `views.md` сейчас). Эти два use case **противоречат** друг другу.
3. **B9** — AcceptanceForm modal в mockup. Это ключевой workflow закрытия проекта — Денис должен ревьювить визуально.
4. **B12** — Task creation wizard в mockup. FAB сейчас только toast'ит. Без формы создания задачи невозможно демо «как пользователь работает».

### Phase 1 (имплементация — детали уточнить):

5. **A5, A6, A7, A9, A10, A12, A14, A15, A17, A18, A19, A22** — пополнить spec-файлы деталями UI элементов (sidebar в Tree, header, badges, group-by `crew`, legend, saved time, edge labels). Это влияет на качество React-имплементации.
6. **B1, B2, B3, B5, B6, B8, B10, B13, B16** — реализовать DnD механики, AI flows, conflict UI, slash-commands, decompose modal, cascade preview. Это backend + frontend работа.

### TODO для Phase 8+ (post-launch):

7. **A11, A13, A20, A21, A23, A24** — мелкие spec улучшения (counters, group-by-phase toggle, theme, hotkeys).
8. **B4, B7, B11, B14, B15, B17, B18** — расширенные сценарии (drag-to-create deps, anomaly UI, cycle prevention feedback, punch bulk add).

---

## Конкретные actions по spec файлам

| Spec файл | Что добавить |
|---|---|
| `02-data-model/task-interface.md` | + `plannedEndAt`, `actualEndAt`, `timerRunning`, `timerStartedAt` (A3, A4) |
| `02-data-model/task-interface.md` | + раздел «Wire format vs domain model» (A1, A2) |
| `03-state-machine/bucket.md` | + уточнение «default Board view = lifecycle колонки, не bucket» (A5) |
| `06-ui-ux/views.md` | + раздел «Global header» (A6) |
| `06-ui-ux/views.md` | + Calendar Backlog sidebar (A14) |
| `06-ui-ux/views.md` | переписать Dispatch секцию (A16) |
| `06-ui-ux/views.md` | + WhoDoesWhat детали или вынос в `08-modules/live-ops.md` (A15) |
| `06-ui-ux/task-card-anatomy.md` | + bonus/penalty badges (A9), category chips (A10), avatar handling clarify (A7), labels i18n (A8), Tree counter clarify (A11) |
| `06-ui-ux/principles.md` | + theme + hotkeys (A23, A24) |
| `08-modules/hierarchy/tree-view-ui.md` | + sidebar (A12), group-by phase toggle (A13) |
| `08-modules/graph-dependencies/dag-visualization.md` | + edge labels FS+lag (A22), mini-map detail (A21), pan/zoom xyflow note (A20) |
| `08-modules/construction-gantt/group-by.md` | + crew group option (A17) |
| `08-modules/construction-gantt/plan-vs-actual.md` | + Saved time visualization (A19), Legend block (A18) |

## Конкретные actions по mockup HTML

| Что добавить в mockup | Reference | Phase |
|---|---|---|
| Quick Add task modal (forms 3 fields + AI suggestions) | B12 | Phase 0 |
| AcceptanceForm modal (signedByName, photos, notes) | B9 | Phase 0 |
| AI Helper modal с diff preview для Wiki | B5 | Phase 1 |
| Templates picker modal (5-10 templates) | B6 | Phase 1 |
| Slash-commands menu mock в Wiki editor | B8 | Phase 1 |
| Auto-shift cascade preview modal | B16 | Phase 1 |
| Decompose-estimate modal (description → 5 subtasks) | B13 | Phase 1 |
| Linked contacts: `tel:` / `sms:` ссылки | B11 | Phase 1 |
| Punch bulk add textarea modal | B18 | Phase 4+ |
| Reviewer flow buttons (если spec будет requesting) | B10 | TBD |

---

## Метаданные аудита

- **Проведён:** 2026-04-26
- **Mockup:** `tasktotime/mockup/index.html` (3603 строки, проанализирован полностью)
- **Spec:** проанализированы ключевые файлы:
  - `02-data-model/task-interface.md`, `sub-types.md`
  - `03-state-machine/lifecycle.md`, `derived-states.md`
  - `06-ui-ux/principles.md`, `views.md`, `task-card-anatomy.md`
  - `08-modules/hierarchy/tree-view-ui.md`
  - `08-modules/graph-dependencies/dag-visualization.md`
  - `08-modules/wiki/editor-ui.md`
  - `08-modules/wiki-rollup/ui.md`
  - `08-modules/construction-gantt/plan-vs-actual.md`, `milestones.md`, `weather-day.md`, `daily-log.md`, `punch-list.md`

---

**См. также:**
- [Views](views.md) — финальный list views, реализуемых в React
- [Principles](principles.md) — UX правила, которые mockup иллюстрирует
- [Task card anatomy](task-card-anatomy.md) — детали как карточка должна выглядеть
- [`../09-folder-structure.md`](../09-folder-structure.md) — где лежат компоненты после миграции
