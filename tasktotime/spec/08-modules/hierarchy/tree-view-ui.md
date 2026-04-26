---
title: "08.hierarchy.4 Tree view (UI)"
section: "08-modules/hierarchy"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Tree view (UI)

> Иерархическое дерево задач: parent → subtasks. Используется в 3 местах: Detail page sidebar (TOC), Project page (tree всех root tasks проекта), Mind Map mode (отдельный view-таб). Технология: MUI X TreeView + xyflow для DAG режима.

ТЗ §11.4.

## Где показываем

### 1. Detail page sidebar (TOC)

Дерево текущей задачи: parent сверху, subtasks под ним, current task highlighted. Like VS Code Outline.

```
┌─────────────────────────────────────┐
│ Bathroom remodel                    │
│ ├─ Demo bathroom            [DONE]  │
│ ├─ Plumbing rough           [PROG]  │← current
│ ├─ Electrical rough         [PROG]  │
│ ├─ Drywall hang             [READY] │
│ ├─ Tile install             [READY] │
│ └─ Final walkthrough        [DRAFT] │
└─────────────────────────────────────┘
```

Click on item → navigate to that subtask's detail page (без full reload).

### 2. Project page

Дерево всех root tasks проекта с раскрывающимися subtasks.

```
Project: Renovation Jim Dvorkin

▶ Bathroom remodel              [STARTED] 60% [████████░░]
   ├─ Demo bathroom             [DONE]
   ├─ Plumbing rough            [PROG]
   └─ ... (3 more)

▶ Kitchen update                [READY]   0% [░░░░░░░░░░]
   ├─ Demo old kitchen          [DRAFT]
   └─ ... (4 more)

▶ Master bedroom paint          [DONE]  100% [██████████]
```

### 3. Mind Map mode

Отдельный view-таб в `/tasktotime?view=graph` — node-based DAG для всего проекта (см. [`../graph-dependencies/dag-visualization.md`](../graph-dependencies/dag-visualization.md)).

## Технический стек

### MUI X TreeView (`@mui/x-tree-view`)

Для **иерархической вертикальной структуры** (sidebar TOC, project tree). Уже в проекте, **zero bundle cost**.

- **Plain Tree View** (vertical expand/collapse) для статичной иерархии
- **Rich Tree View** с custom renderers для статус-чипов и счётчиков

```typescript
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';

<RichTreeView
  items={treeItems}
  defaultExpandedItems={[currentTaskId, ...ancestorIds]}
  defaultSelectedItems={currentTaskId}
  slots={{
    item: TaskTreeNode,  // custom node renderer
  }}
/>
```

### `@xyflow/react` + dagre

Для **node-based визуализации** (Mind Map view, DAG зависимостей в §12). React 19 совместим.

См.: [`../graph-dependencies/dag-visualization.md`](../graph-dependencies/dag-visualization.md)

### НЕ используем

- ❌ **Cytoscape.js** (overkill, граф-теория не нужна)
- ❌ **GoJS** (proprietary license)
- ❌ **D3-tree** (низкоуровневое, MUI X TreeView достаточно)

## Custom node renderer

```typescript
function TaskTreeNode({ item, ...props }: TreeItemProps) {
  return (
    <TreeItem {...props}>
      <Stack direction="row" alignItems="center" gap={1}>
        <PriorityDot priority={item.priority} />
        <Typography variant="body2">{item.title}</Typography>
        <LifecycleChip lifecycle={item.lifecycle} size="small" />
        {item.subtaskRollup && (
          <Box>
            <ProgressBar value={item.subtaskRollup.completedFraction} />
            <Typography variant="caption">
              {item.subtaskRollup.countByLifecycle.accepted}/{item.subtaskIds.length}
            </Typography>
          </Box>
        )}
      </Stack>
    </TreeItem>
  );
}
```

## Components

```
tasktotime/frontend/components/TaskTree/
├── TaskTree.tsx               (vertical tree, sidebar в Detail page)
├── TaskTreeNode.tsx           (узел с lifecycle chip + counters)
└── ProjectTreePage.tsx        (tree всех root-tasks проекта)
```

## Performance: virtualization

MUI X TreeView не делает virtualization из коробки. Для проектов с >1000 узлов — добавить window-based rendering через `react-window`.

**Acceptance criteria:** tree рендерит **до 1000 узлов без лагов** (см. [`acceptance-criteria.md`](acceptance-criteria.md)).

## Expand/collapse state

Сохраняем в URL (для shareability):
```
/tasktotime/projects/X/tree?expanded=task-1,task-2,task-3
```

Или в localStorage (per user):
```typescript
localStorage.setItem(`tree-expanded-project-${projectId}`, JSON.stringify(expandedIds));
```

## Search в tree

Search bar в верху tree — фильтрует видимые nodes. Раскрывает collapsed parents если match найден глубже.

## Banner для rollup suggestion

См. [`auto-rollup.md`](auto-rollup.md) — баннер в parent card когда все subtasks accepted:

```
┌─────────────────────────────────────────┐
│ Bathroom remodel               [STARTED] │
│                                          │
│ ✓ All 5 subtasks accepted               │
│ Sign acceptance act for parent?         │
│            [Accept] [Dismiss]           │
└─────────────────────────────────────────┘
```

---

**См. также:**
- [Model](model.md)
- [Tree DnD](tree-dnd.md) — drag subtask между parents
- [Subtask rollup aggregate](subtask-rollup-aggregate.md) — данные для display
- [Auto-rollup](auto-rollup.md) — banner для rollup suggestions
- [Acceptance criteria](acceptance-criteria.md)
- [`../graph-dependencies/dag-visualization.md`](../graph-dependencies/dag-visualization.md) — Mind Map mode
- [`../../06-ui-ux/views.md`](../../06-ui-ux/views.md) — Tree view как один из 10 views
