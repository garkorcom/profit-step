---
title: "08.graph.1 Три типа связей"
section: "08-modules/graph-dependencies"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Три типа связей между задачами

> Иерархия / зависимости / cross-reference — это **три разных типа связей**, не одно. Каждый имеет свою семантику, поле, и visual представление. Путать их = путать UX (юзер не знает что блокирует, что просто связано).

ТЗ §12.1.

## Таблица типов

| Тип | Поле | Семантика | Visual |
|---|---|---|---|
| **Иерархия** (parent-child) | `parentTaskId / subtaskIds[]` | Task состоит из subtasks (см. §11) | Tree (вертикальное дерево) |
| **Зависимости** (blocking) | `dependsOn[] / blocksTaskIds[]` | Task A не может стартовать пока B не закончен | DAG (стрелки) |
| **Cross-reference** (see also) | `linkedTaskIds[]` | Связаны по контексту, не блокируют | Punctuated lines, для backlinks |

## Иерархия

**Семантика:** Task A *состоит* из Task B (B is a part of A).

- Поле: `parentTaskId` (на child), `subtaskIds[]` (на parent, computed)
- Visual: вертикальное дерево с indent
- Effect: parent.subtaskRollup пересчитывается; lifecycle suggestions
- См.: [`../hierarchy/model.md`](../hierarchy/model.md)

**Use case:** «Bathroom remodel» состоит из «Demo», «Plumbing rough», «Drywall», ...

## Зависимости (blocking)

**Семантика:** Task A *должен ждать* Task B (B blocks A).

- Поле: `dependsOn[]` (на A — на кого ссылается), `blocksTaskIds[]` (на B — кого блокирует, computed)
- Visual: DAG с направленными стрелками
- Effect: cascade auto-shift; cycle prevention; critical path computation
- 4 типа (FS / SS / FF / SF) — см. [`task-dependency-interface.md`](task-dependency-interface.md)
- См.: [`auto-shift-cascade.md`](auto-shift-cascade.md), [`dag-visualization.md`](dag-visualization.md)

**Use case:** «Drywall hang» (A) зависит от «Plumbing rough» (B) — drywall можно начать только после plumbing rough done.

## Cross-reference (see also)

**Семантика:** Task A и Task B *связаны по контексту*, но не блокируют друг друга.

- Поле: `linkedTaskIds[]` (двунаправленный — обе стороны)
- Visual: punctuated lines (тонкие пунктирные стрелки) или только текстовое «See also»
- Effect: backlinks в Detail page; backreferences («2 other tasks reference this»)

**Use case:** «Demo bathroom» (A) ссылается на «Demo bathroom — neighboring unit» (B) — оба связаны контекстом (одно здание, похожие материалы), но не блокируют. Worker может посмотреть как делал в B и применить опыт.

## Когда использовать какую

```
Q: «Это subtask?»
   ├ Да → parentTaskId (Иерархия)
   └ Нет → следующий вопрос

Q: «Эта задача БЛОКИРУЕТ ту? Нельзя начать пока та не done?»
   ├ Да → dependsOn[] (Зависимости)
   └ Нет → следующий вопрос

Q: «Связаны контекстом, посмотреть/учесть, но не блокирует?»
   └ Да → linkedTaskIds[] (Cross-reference)
```

## Anti-pattern: использовать иерархию вместо зависимостей

**Неправильно:** делать «Plumbing rough» subtask «Drywall hang» только потому что они sequential.

**Правильно:** оба — root tasks или subtasks одного parent «Bathroom remodel». Связь через `dependsOn` (FS): Drywall.dependsOn = [{ taskId: PlumbingRough.id, type: 'FS' }].

**Почему:** иерархия = структура (что чем состоит), зависимости = sequencing (что после чего).

## Anti-pattern: использовать зависимости вместо cross-reference

**Неправильно:** добавлять `dependsOn` для задач которые «связаны но не блокируют» — приведёт к ложным cascade auto-shift, false critical path.

**Правильно:** для «see also» использовать `linkedTaskIds[]` — без cascade, без блокировок.

## Visual hierarchy

В UI Detail page → tab «Контекст»:

```
Иерархия:
  Parent: Bathroom remodel
  ↓
  Subtasks (4): Demo, Plumbing, Drywall, Tile

Зависимости:
  Blocks: Demo bathroom (FS, lag 0)
  Blocked by: nothing

Связано:
  See also: Demo bathroom — neighboring unit
```

Каждая секция отдельно. Юзер сразу понимает что есть что.

---

**См. также:**
- [Task dependency interface](task-dependency-interface.md) — детали `dependsOn` model
- [Computed fields](computed-fields.md) — `blocksTaskIds`, `isCriticalPath`
- [Auto-shift cascade](auto-shift-cascade.md)
- [Cycle prevention](cycle-prevention.md)
- [DAG visualization](dag-visualization.md)
- [`../hierarchy/model.md`](../hierarchy/model.md) — иерархия (другой тип связи)
- [`../../02-data-model/task-interface.md`](../../02-data-model/task-interface.md) — все 3 поля на Task
