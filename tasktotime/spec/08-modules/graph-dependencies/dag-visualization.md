---
title: "08.graph.6 DAG visualization (Mind Map view)"
section: "08-modules/graph-dependencies"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# DAG visualization (Mind Map view)

> Node-based DAG зависимостей через `@xyflow/react` + dagre auto-layout. View-таб `/tasktotime?view=graph`. Также в Detail page → tab «Зависимости». Critical path highlighting, mini-map, toolbar.

ТЗ §12.6.

## Где показываем

- **View-таб:** `/tasktotime?view=graph` — DAG для всего проекта
- **Detail page → tab «Зависимости»** — mini-DAG вокруг текущей задачи (radius 2)

## Технология

### `@xyflow/react` + dagre auto-layout

- React 19 совместим
- Modern API (xyflow = renamed reactflow)
- Built-in zoom, pan, mini-map, controls
- Plugin для auto-layout (dagre)

### НЕ используем

- ❌ Cytoscape.js (overkill, граф-теория не нужна)
- ❌ GoJS (proprietary license, $$$)
- ❌ D3-tree (низкоуровневое, много boilerplate)

См.: [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #4

## Что показываем

### Узлы (Tasks)

- **Size proportional to `estimatedDurationMinutes`** — большие задачи большие узлы (visual cue для prioritization)
- **Цвет узла = lifecycle** (см. цветовую палитру в [`../../06-ui-ux/task-card-anatomy.md`](../../06-ui-ux/task-card-anatomy.md))
- **Border:**
  - `isCriticalPath: true` → bold red outline (rose-500)
  - Иначе → subtle gray outline

### Стрелки (Dependencies)

- **Тип FS** (finish-to-start) — solid line
- **Тип SS** (start-to-start) — dashed line
- **Тип FF** (finish-to-finish) — dotted line
- **Тип SF** (start-to-finish) — dashed-dotted (или color difference)

### Critical path highlight

- Bold red stroke на edges critical path
- Non-critical edges — тонкие серые
- Toggle button «Show critical path» в toolbar (default ON в Mind Map view, OFF в Gantt)

### Hover на узел

- Popup с card preview (compact variant)
- Same `<TaskCard>` component reused (DRY)

### Click на узел

- Открытие drawer (как везде)
- Detail page открывается без full reload

### Минимап в углу

- xyflow built-in MiniMap component
- Color-coded по lifecycle для quick navigation

### Toolbar

- Filter by phase (`demo` / `rough` / `finish` / `closeout`)
- Filter by category (`work` / `punch` / `inspection` / `permit`)
- Filter by assignee
- Toggle critical path
- Export PNG (для документации, презентаций)
- Search (find task by title in graph)

## Implementation skeleton

```typescript
// tasktotime/frontend/components/TaskGraph/TaskGraphView.tsx

import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState } from '@xyflow/react';
import dagre from 'dagre';

export function TaskGraphView({ projectId }: { projectId: string }) {
  const { tasks } = useTasks({ projectId });
  const initialNodes = tasksToNodes(tasks);
  const initialEdges = tasksToEdges(tasks);

  // Auto-layout via dagre
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => dagreLayout(initialNodes, initialEdges),
    [tasks]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={{ taskNode: TaskNode }}
      edgeTypes={{ dependencyEdge: DependencyEdge }}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap nodeColor={(n) => lifecycleColors[n.data.lifecycle]} />
    </ReactFlow>
  );
}

function tasksToNodes(tasks: Task[]): Node[] {
  return tasks.map(t => ({
    id: t.id,
    type: 'taskNode',
    data: t,
    position: { x: 0, y: 0 },  // dagre will compute
  }));
}

function tasksToEdges(tasks: Task[]): Edge[] {
  return tasks.flatMap(t =>
    (t.dependsOn ?? []).map(dep => ({
      id: `${t.id}-${dep.taskId}`,
      source: dep.taskId,
      target: t.id,
      type: 'dependencyEdge',
      data: dep,
      animated: t.isCriticalPath,
      style: edgeStyleByType[dep.type],
    }))
  );
}
```

## Custom node component

```typescript
// tasktotime/frontend/components/TaskGraph/TaskNode.tsx

import { Handle, Position } from '@xyflow/react';

export function TaskNode({ data }: { data: Task }) {
  const sizeMultiplier = Math.log10(data.estimatedDurationMinutes) / 2;  // 0.5 - 2x
  const isCritical = data.isCriticalPath;

  return (
    <div
      style={{
        backgroundColor: lifecycleColors[data.lifecycle],
        border: isCritical ? '3px solid rose' : '1px solid gray',
        padding: 12 * sizeMultiplier,
        borderRadius: 8,
        minWidth: 150 * sizeMultiplier,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <strong>{data.title}</strong>
      <div>{formatDuration(data.estimatedDurationMinutes)}</div>
      <LifecycleChip lifecycle={data.lifecycle} size="small" />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

## Custom edge с types FS/SS/FF/SF

```typescript
// tasktotime/frontend/components/TaskGraph/DependencyEdge.tsx

const edgeStyleByType = {
  finish_to_start: { strokeDasharray: 'none' },           // solid
  start_to_start: { strokeDasharray: '5 5' },             // dashed
  finish_to_finish: { strokeDasharray: '2 2' },           // dotted
  start_to_finish: { strokeDasharray: '5 2 1 2' },        // dashed-dotted
};
```

## Drag-to-create dependency

Используем xyflow Connection mode. Юзер drags from one node's output handle to another's input handle → creates edge.

```typescript
const onConnect = useCallback(async (connection) => {
  try {
    await api.addDependency(connection.source, connection.target, 'finish_to_start');
    // Refresh edges
  } catch (e) {
    if (e.code === 'cycle_detected') {
      toast.error(`Cannot add: ${e.message}`);
    }
  }
}, []);
```

## Performance

**Acceptance criteria** (см. [`acceptance-criteria.md`](acceptance-criteria.md)):
- 200 узлов < 200ms
- 1000 узлов < 2s

xyflow handles рендер реасонабельно well. Для очень больших графов — virtualization через viewport culling (только видимые nodes рендерятся).

## Filter behavior

При применении filter (e.g. phase=rough) — node count уменьшается, dagre re-runs layout. Анимация transition smooth.

## Export PNG

Built-in xyflow API:
```typescript
import { toPng } from 'html-to-image';

const exportPng = async () => {
  const png = await toPng(reactFlowRef.current);
  download(png, `project-${projectId}-dag.png`);
};
```

---

**См. также:**
- [Three link types](three-link-types.md)
- [Task dependency interface](task-dependency-interface.md) — types FS/SS/FF/SF
- [Computed fields](computed-fields.md) — isCriticalPath used here
- [Cycle prevention](cycle-prevention.md) — UI feedback при cycle
- [Acceptance criteria](acceptance-criteria.md) — performance criteria
- [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) — единственный graph viz lib
- [`../../06-ui-ux/views.md`](../../06-ui-ux/views.md) — Graph view
- [`../hierarchy/tree-view-ui.md`](../hierarchy/tree-view-ui.md) — different lib для tree
