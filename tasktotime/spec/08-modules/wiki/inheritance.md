---
title: "08.wiki.6 Wiki inheritance из parent"
section: "08-modules/wiki"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Wiki inheritance — subtask из parent

> Если subtask имеет `wikiInheritsFromParent: true` (default) — view mode рендерит parent.wiki.contentMd + own.wiki.contentMd как контекст. Это даёт «общий контекст» от parent + специфику subtask.

ТЗ §13.6.

## Поле

```typescript
interface Task {
  // ...
  wiki?: TaskWiki;
  wikiInheritsFromParent: boolean;  // default true для subtask
}
```

## View mode rendering

Если `wikiInheritsFromParent === true` AND `parentTaskId !== null`:

```markdown
{parent.wiki.contentMd}

---

## Subtask: {own.title}

{own.wiki.contentMd}
```

**Псевдокод rendering:**

```typescript
function renderWikiViewMode(task: Task, parent?: Task): string {
  if (task.isSubtask && task.wikiInheritsFromParent && parent?.wiki) {
    return `${parent.wiki.contentMd}\n\n---\n\n## Subtask: ${task.title}\n\n${task.wiki?.contentMd ?? ''}`;
  }
  return task.wiki?.contentMd ?? '';
}
```

## Edit mode

Edit mode редактирует **только `own.wiki`**. Parent wiki не editable отсюда (нужно открыть parent task для его правок).

UI:

```
┌─────────────────────────────────────┐
│  Wiki — Subtask: Demo bathroom      │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ Inherits from parent:         │  │
│  │ "Bathroom remodel..."         │  │  ← read-only preview
│  │ [Open parent to edit]         │  │
│  └───────────────────────────────┘  │
│                                     │
│  Your subtask wiki:                 │  ← editable
│  ┌───────────────────────────────┐  │
│  │ ## Demo notes                 │  │
│  │ - Found rotted joist          │  │
│  │ - Replaced with pressure-treat│  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Toggle

Юзер может отключить inheritance в Detail page:

```
Detail page → Settings → Wiki:
[✓] Inherit from parent's wiki  ← если включено
```

Если отключено (`wikiInheritsFromParent: false`) — view mode показывает только `own.wiki.contentMd`. Parent wiki полностью независим.

## Default

`wikiInheritsFromParent: true` — для всех новых subtasks по умолчанию.

`wikiInheritsFromParent: false` — для root tasks (нет parent для inheritance).

## After reparent

Если subtask перевешивается на нового parent (drag-drop в tree DnD):
- `wikiInheritsFromParent` остаётся as-is
- Inheritance start приходить от **нового** parent (старый wiki не сохраняется)
- `own.wiki.contentMd` сохраняется

См.: [`../hierarchy/tree-dnd.md`](../hierarchy/tree-dnd.md)

## Promote subtask to root

Если subtask становится root (parent removed):
- `wikiInheritsFromParent` остаётся `true` но **не имеет effect** (no parent to inherit from)
- View mode показывает только `own.wiki.contentMd`
- Может быть смущающе — UI suggest «Set wikiInheritsFromParent to false теперь»

## Что про wiki rollup

Wiki rollup (см. [`../wiki-rollup/concept.md`](../wiki-rollup/concept.md)) — это противоположное:
- **Inheritance** — child показывает parent context
- **Rollup** — parent показывает aggregated wikis всех subtasks

Они оба работают, но в разных направлениях.

При **rollup** — если subtask имеет `wikiInheritsFromParent: true`, в rolled-up document не дублируется parent context (иначе recursion). Только `own.wiki.contentMd` идёт в rollup.

См.: [`../wiki-rollup/edge-cases.md`](../wiki-rollup/edge-cases.md)

## AI «Дополни wiki» с inheritance

AI читает **combined view** (parent + own) для context, но suggests только в `own.wiki`.

```typescript
async function suggestForSubtask(subtask: Task) {
  const parent = await getTask(subtask.parentTaskId);
  const combinedContext = renderWikiViewMode(subtask, parent);

  const suggestions = await claude.suggest({
    prompt: `Read this combined wiki context (parent + subtask). Suggest additions to the SUBTASK wiki only:\n\n${combinedContext}`
  });

  return suggestions;
}
```

## Edge cases

### Parent не имеет wiki

Если `parent.wiki === null && wikiInheritsFromParent: true` — view mode показывает только `own.wiki` (как если inheritance disabled).

### Parent.wiki very long (близко к 100KB)

Combined render может быть очень long. UI показывает collapsible section для parent context:

```
┌────────────────────────────────────┐
│ ▼ Parent context (Bathroom remodel)│
│ [collapsed text]                   │
├────────────────────────────────────┤
│ ## Subtask: Demo bathroom          │
│ - Found rotted joist               │
└────────────────────────────────────┘
```

### Parent wiki updated после child created

Inheritance is **dynamic** — child всегда показывает CURRENT parent wiki, не snapshot. Если parent wiki updated — child view auto-refreshes.

### Acceptance с inherited wiki

При signing acceptance act — какой wiki включается в PDF:
- Default: только `own.wiki` (то что юзер редактировал)
- Можно опция «Include parent context» в Sign Acceptance modal

---

**См. также:**
- [Concept](concept.md)
- [Storage](storage.md)
- [Editor UI](editor-ui.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../hierarchy/model.md`](../hierarchy/model.md) — иерархия (база для inheritance)
- [`../hierarchy/tree-dnd.md`](../hierarchy/tree-dnd.md) — что происходит после reparent
- [`../wiki-rollup/concept.md`](../wiki-rollup/concept.md) — противоположное направление (parent showing children)
