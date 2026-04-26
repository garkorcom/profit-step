---
title: "08.gantt.6 Punch list integration"
section: "08-modules/construction-gantt"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Punch list integration

> `Task { category: 'punch', phase: 'closeout' }` — это «мелкие правки в конце проекта» **без отдельной коллекции**. Полный reuse Task contract. В Gantt отображаются compactly в bottom row проекта.

ТЗ §15.6.

## Anti-pattern

См.: [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #6

**НЕ создаём `punch_lists/{id}` отдельную коллекцию.** Punch list item = `Task { category: 'punch', phase: 'closeout' }`. Полный reuse Task contract — никакой новой коллекции, никаких отдельных rules / triggers / API.

## В Gantt

Отображаются:

### 1. Сгруппированы в bottom row

После всех regular tasks проекта:

```
Project: Bathroom remodel — Jim Dvorkin

Demo bathroom        ▓▓▓▓
Plumbing rough              ▓▓▓▓▓▓▓
Electrical rough            ▓▓▓▓▓▓
Drywall hang                              ▓▓▓▓▓▓
Tile install                                          ▓▓▓▓▓▓▓▓
Final cleanup                                                       ▓▓
─────────────────────────────────────────────────────────────────────────
Punch list (compact)                                                   ▒▒▒▒  ← bottom row
```

### 2. Compact mode

Меньшие полоски (height 12px вместо обычных 24px) чтобы не занимать много места:

```css
.gantt-task--punch {
  height: 12px;
  opacity: 0.7;
}
```

### 3. Filter «Hide punch» в toolbar

```
[Hide punch]
```

Для PM-обзора больших проектов — скрывает punch list rows entirely.

## Когда показывать punch list

**Open question** §15 в [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md):

«Когда punch list automatically становится visible? В Buildertrend он создаётся за неделю до acceptance.»

Default behavior:
- Punch list tasks (`category: 'punch'`) могут быть созданы **в любой момент**
- В Gantt visible как только созданы
- Compact mode применяется automatically

Future enhancement:
- Auto-suggest «Create punch list» когда parent task в `lifecycle: completed`
- Walking inspection — UI helper для quick add multiple punch items

## Создание punch task

UI flow:

```
Detail page parent (e.g. «Bathroom remodel») → button [Add punch item]
   ↓
Quick form:
  - Title: «Touch up paint on door»
  - Assignee: Sergey
  - Due: tomorrow
  - Estimated: 30 min
   ↓
Creates Task { category: 'punch', phase: 'closeout', parentTaskId: 'bathroom-id' }
```

Bulk add:
```
[Add multiple punch items] → modal с textarea:
  Touch up paint on door
  Replace tile in shower corner
  Adjust toilet seat
  ...
   ↓
Creates 3+ tasks with same defaults
```

## Visual differentiation

В Gantt — punch tasks visually different:
- Smaller height
- Lighter color (50% opacity)
- Striped pattern background (CSS `repeating-linear-gradient`)
- Labelled «PUNCH» chip on hover

```css
.gantt-task--punch {
  background: repeating-linear-gradient(
    45deg,
    var(--lifecycle-color),
    var(--lifecycle-color) 5px,
    var(--lifecycle-color-light) 5px,
    var(--lifecycle-color-light) 10px
  );
}
```

## In other views

### Board view

Punch tasks могут быть filtered отдельно:
- Filter «Show only punch» — kanban с only punch tasks
- Filter «Hide punch» — без punch

В default view — punch tasks показываются как normal tasks с category badge «PUNCH».

### Tree view

Если parent имеет 5 regular subtasks + 10 punch items — Tree view показывает punch items:
- В separate group «Punch list» под regular subtasks
- Collapsible by default (юзер может раскрыть)

```
Bathroom remodel
├─ Demo bathroom            [DONE]
├─ Plumbing rough           [DONE]
├─ Drywall hang             [DONE]
├─ Tile install             [DONE]
├─ Final cleanup            [DONE]
└─ ▶ Punch list (8 items)   [3/8 done]    ← collapsible
```

### Table view

Filter column «Category» — sort/filter by punch.

## Acceptance

Punch tasks могут иметь `acceptance` как regular tasks (если требуется client sign-off для each item).

Чаще — все punch items под одним parent acceptance (когда parent.lifecycle → accepted).

## Why this matters

Денис в требованиях:
> «Wallpaper remodel» проект имеет 50+ small fixes в конце. Не хочу делать отдельную систему для них — пусть будут tasks как все остальные.

Solution: `category` field на existing Task. Никакой новой коллекции, никаких новой UI. Простое разделение через filter / category-based styling.

## Open question

§ Open question #15 в [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md): когда punch list автоматически становится visible (Buildertrend behavior — за неделю до acceptance).

Default: visible сразу после создания. Auto-suggest enhancement — Phase 4+.

## Acceptance criteria

См.: [`acceptance-criteria.md`](acceptance-criteria.md):
- ✓ Punch list compact row внизу проекта

---

**См. также:**
- [Plan vs actual](plan-vs-actual.md)
- [Group by](group-by.md) — group by category isolates punch tasks
- [Acceptance criteria](acceptance-criteria.md)
- [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #6 — нет отдельной коллекции
- [`../../02-data-model/sub-types.md`](../../02-data-model/sub-types.md) — TaskCategory
- [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md) #15
