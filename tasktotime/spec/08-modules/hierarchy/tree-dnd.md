---
title: "08.hierarchy.5 Tree DnD (drag subtask между parent'ами)"
section: "08-modules/hierarchy"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Tree DnD — drag subtask между parents

> В UI можно драгнуть subtask из дерева A в дерево B → меняется `parentTaskId`, оба `subtaskRollup` пересчитываются. Также drag root → subtask и обратно. Запрещены drags создающие cycles.

ТЗ §11.5.

## Поведение

| Drag действие | Результат |
|---|---|
| Drag subtask из tree A в tree B | `subtask.parentTaskId = B.id`, оба rollups пересчитываются |
| Drag root task в subtask-zone parent X | `task.parentTaskId = X.id`, `task.isSubtask = true`, X.subtaskRollup recompute |
| Drag subtask наружу (из tree в root area) | `task.parentTaskId = null`, `task.isSubtask = false`, old parent.subtaskRollup recompute |
| Drag parent в свою subtask | **ЗАПРЕЩЕНО** — cycle prevention в trigger |
| Drag subtask в её собственный sub-subtask (если бы существовал) | N/A — у нас 2 уровня max |

## Cycle prevention

Хотя у нас 2 уровня max, есть теоретический cycle:
- A — root
- B — subtask of A
- Drag A → B's subtask zone — cycle: A.parentTaskId = B → B.parentTaskId = A → infinite

API endpoint `PATCH /api/tasktotime/tasks/:id { parentTaskId: 'new-parent' }`:
- Проверяет: target parent не должен быть subtask текущей task'и
- Проверяет: depth не должен превысить 2

```typescript
async function validateParentChange(taskId: string, newParentId: string) {
  if (newParentId === taskId) {
    throw new HttpsError('failed-precondition', 'Task cannot be its own parent');
  }

  const newParent = await getTask(newParentId);

  if (newParent.isSubtask) {
    throw new HttpsError('failed-precondition', 'Cannot move task under a subtask (2-level depth max)');
  }

  // Check if newParent is a subtask of taskId (would create cycle)
  if (newParent.parentTaskId === taskId) {
    throw new HttpsError('failed-precondition', 'Cycle detected: would create infinite loop');
  }
}
```

## Implementation library

Использовать **react-dnd** или **dnd-kit** (более modern). Hooks-based API:

```typescript
import { useDraggable, useDroppable } from '@dnd-kit/core';

function TaskNode({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: task.id });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: task.id });

  return (
    <div ref={node => { setNodeRef(node); dropRef(node); }} {...attributes} {...listeners}>
      {task.title}
    </div>
  );
}

function TreeRoot() {
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    try {
      await api.patchTask(active.id, { parentTaskId: over.id });
    } catch (e) {
      toast.error(e.message);  // cycle prevented
    }
  };

  return <DndContext onDragEnd={handleDragEnd}>...</DndContext>;
}
```

## Visual feedback

- **Dragging:** ghost copy follows cursor с opacity 50%
- **Hover over valid drop zone:** zone gets highlight border (blue)
- **Hover over invalid (cycle):** zone gets red border + tooltip «Would create cycle»
- **After drop:** smooth animation card flies в new position

## Concurrent edits handling

Если 2 PMs одновременно drag'ают same subtask в разные parents — Firestore write (last-write-wins). UI второго PM показывает refresh hint после server response.

## Side effects on drop

После successful `PATCH parentTaskId`:

1. **`onTaskUpdate` trigger** запускается:
   - Обновляет `oldParent.subtaskIds[]` (remove)
   - Обновляет `newParent.subtaskIds[]` (add)
   - Recompute `oldParent.subtaskRollup`
   - Recompute `newParent.subtaskRollup`
   - Update `task.isSubtask` если был root, теперь subtask (или наоборот)
   - Append history event на task: `{ type: 'reparented', from: oldParentId, to: newParentId, by, at }`

2. **UI realtime update** через subscription — drag'нутая task появляется в new parent's tree, исчезает из old.

## Rollback при error

Optimistic UI update — task сразу появляется в new tree после drop. Если API возвращает error (cycle, RLS) — rollback (task возвращается в old place) + show toast.

## Wiki inheritance после reparent

Если subtask имела `wikiInheritsFromParent: true` — после reparent inheritance меняется на нового parent. Старый wiki content (own.wiki.contentMd) сохраняется — не теряется.

См.: [`../wiki/inheritance.md`](../wiki/inheritance.md)

## Acceptance criteria

См. [`acceptance-criteria.md`](acceptance-criteria.md):
- ✓ Drag-drop рабочий между деревьями
- ✓ Cycle prevention срабатывает с toast
- ✓ Rollups обоих parents пересчитываются атомарно
- ✓ History event записан

---

**См. также:**
- [Model](model.md)
- [Tree view UI](tree-view-ui.md)
- [Subtask rollup aggregate](subtask-rollup-aggregate.md) — что пересчитывается
- [`../wiki/inheritance.md`](../wiki/inheritance.md) — wiki inheritance after reparent
- [`../../05-api/rest-endpoints.md`](../../05-api/rest-endpoints.md) — PATCH endpoint
- [`../../05-api/triggers.md`](../../05-api/triggers.md) — onTaskUpdate
