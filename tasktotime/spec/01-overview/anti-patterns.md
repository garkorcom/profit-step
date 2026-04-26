---
title: "01.3 Анти-паттерны (жёсткие архитектурные ограничения)"
section: "01-overview"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Жёсткие архитектурные ограничения (анти-паттерны, v0.2)

> Что мы **точно НЕ делаем** в модуле `tasktotime`. Эти ограничения жёсткие — нарушение требует пересогласования с Денисом. Источник: research конкурентов в `docs/RESEARCH_2026-04-25.md`.

После research конкурентов (Notion / ClickUp / Linear / Procore — см. `docs/RESEARCH_2026-04-25.md`) фиксируем правила:

## 1. НЕ делаем 7-уровневую вложенность ClickUp

**Анти-паттерн:** ClickUp = Workspace > Space > Folder > List > Task > Subtask > Checklist (7 уровней). Юзеры не понимают где они в дереве.

**Наше правило:** только **Task → Subtask (1 уровень)**. Глубже — это уже отдельный проект.

См. подробно: [`../08-modules/hierarchy/model.md`](../08-modules/hierarchy/model.md)

## 2. НЕ делаем «swimlane» как отдельную визуализацию

**Анти-паттерн:** в construction Gantt swimlane = group-by row по assignee/crew/phase. Делать отдельный view-таб для каждого разреза = плодим 5 одинаковых табов.

**Наше правило:** реализуем как **dropdown «Group by»** (none / project / room / crew / executor / phase). Не как отдельный view.

См. подробно: [`../08-modules/construction-gantt/group-by.md`](../08-modules/construction-gantt/group-by.md)

## 3. НЕ делаем silent auto-rollup wiki

**Анти-паттерн:** автоматически подменять `parent.wiki.contentMd` агрегатом из subtasks без явного действия юзера.

**Наше правило:** Rollup wiki — **toggle в UI**, юзер явно нажимает «Show aggregated wiki». Не подменяем содержимое автоматически.

См. подробно: [`../08-modules/wiki-rollup/concept.md`](../08-modules/wiki-rollup/concept.md)

## 4. НЕ таскаем >1 graph viz lib в bundle

**Анти-паттерн:** Cytoscape + D3 + GoJS — overkill для DAG-задачи.

**Наше правило:** выбираем **`@xyflow/react` + dagre** для DAG, и **MUI X TreeView** для иерархии. Точка.

**НЕ используем:** Cytoscape.js (overkill, граф-теория не нужна), GoJS (proprietary license), D3-tree (низкоуровневое).

См. подробно: [`../08-modules/graph-dependencies/dag-visualization.md`](../08-modules/graph-dependencies/dag-visualization.md)

## 5. НЕ auto-shift по weather day без подтверждения

**Анти-паттерн:** молча сдвигать outdoor задачи на день вперёд если NOAA говорит «дождь».

**Наше правило:** NOAA говорит дождь → показываем **маркер ☂** на Gantt + **suggest-modal** «сдвинуть на день?». Юзер подтверждает.

См. подробно: [`../08-modules/construction-gantt/weather-day.md`](../08-modules/construction-gantt/weather-day.md)

## 6. НЕ создаём `punch_lists/{id}` отдельную коллекцию

**Анти-паттерн:** делать отдельную сущность для «punch list» (мелкие правки в конце проекта).

**Наше правило:** Punch list item = `Task { category: 'punch', phase: 'closeout' }`. **Полный reuse Task contract** — никакой новой коллекции, никаких отдельных rules / triggers / API.

См. подробно: [`../08-modules/construction-gantt/punch-list.md`](../08-modules/construction-gantt/punch-list.md)

---

**См. также:**
- [Цели модуля](goals.md) — почему мы делаем новый модуль
- [Глоссарий](glossary.md) — определения терминов (swimlane vs group-by, etc.)
- [`../10-decisions/what-not-to-do.md`](../10-decisions/what-not-to-do.md) — что НЕ делаем в первой фазе (другая категория ограничений)
