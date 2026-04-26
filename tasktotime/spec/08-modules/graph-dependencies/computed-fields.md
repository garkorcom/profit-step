---
title: "08.graph.3 Computed fields (blocksTaskIds, isCriticalPath, slackMinutes)"
section: "08-modules/graph-dependencies"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Computed fields на triggers

> 3 поля задачи computed автоматически при изменении dependencies или durations: `blocksTaskIds[]` (reverse index), `isCriticalPath` (boolean), `slackMinutes` (float). Trigger `onTaskUpdate` поддерживает их актуальными.

ТЗ §12.3.

## Поля

```typescript
interface Task {
  // ...
  blocksTaskIds?: string[];           // reverse index, computed
  isCriticalPath: boolean;            // computed
  slackMinutes: number;               // computed
}
```

## `blocksTaskIds[]` — reverse index

**Что это:** для `Task X` это **список всех Y которые зависят от X**. То есть «X блокирует кого».

**Где нужно:**
- DAG визуализация — рисуем стрелки от X к Y (visualize edges)
- Cascade auto-shift — когда X.actualEnd меняется, мы знаем кто получит сдвиг (см. [`auto-shift-cascade.md`](auto-shift-cascade.md))
- UI «На эту задачу ссылаются N других»

**Как обновляется:**

```typescript
// onTaskUpdate trigger
async function updateReverseIndex(before: Task, after: Task) {
  const beforeDeps = before.dependsOn?.map(d => d.taskId) ?? [];
  const afterDeps = after.dependsOn?.map(d => d.taskId) ?? [];

  // Removed dependencies
  for (const removedId of beforeDeps.filter(id => !afterDeps.includes(id))) {
    await db.collection('tasktotime_tasks').doc(removedId).update({
      blocksTaskIds: admin.firestore.FieldValue.arrayRemove(after.id)
    });
  }

  // Added dependencies
  for (const addedId of afterDeps.filter(id => !beforeDeps.includes(id))) {
    await db.collection('tasktotime_tasks').doc(addedId).update({
      blocksTaskIds: admin.firestore.FieldValue.arrayUnion(after.id)
    });
  }
}
```

## `isCriticalPath: boolean`

**Что это:** задача на critical path всего проекта. Алгоритм CPM (Critical Path Method) запускается при изменении любой задачи в проекте.

CPM = последовательность задач у которых `slackMinutes === 0`. Если такая задача задержится — задержится весь проект.

**Где нужно:**
- Gantt highlighting (bold red outline)
- Mind Map highlighting
- Алерт PM «critical task in jeopardy»
- Анимация overdue badges с extra urgency

**Performance:**
- Target: < 200ms для 100 задач, < 2s для 1000

## `slackMinutes: number`

**Что это:** float, на сколько минут можно опоздать без сдвига critical path.

- `slack === 0` → critical task
- `slack > 0` → non-critical, у задачи есть запас

**CPM algorithm (псевдокод):**

```typescript
function computeCriticalPath(projectTasks: Task[]) {
  // Forward pass: earliest start/end
  for each task T (topo-sorted from no-deps):
    T.earliestStart = max(T.dependsOn.map(d => getEarliestEnd(d.taskId, d.type, d.lagMinutes)))
    T.earliestEnd = T.earliestStart + T.estimatedDurationMinutes

  // Backward pass: latest start/end
  const projectEnd = max(projectTasks.map(t => t.earliestEnd))
  for each task T (reverse topo-sorted):
    if T.blocksTaskIds.length === 0:
      T.latestEnd = projectEnd
    else:
      T.latestEnd = min(T.blocksTaskIds.map(id => getLatestStart(id, ...)))
    T.latestStart = T.latestEnd - T.estimatedDurationMinutes

  // Slack = latestStart - earliestStart
  for each task T:
    T.slackMinutes = T.latestStart - T.earliestStart
    T.isCriticalPath = (T.slackMinutes === 0)
}
```

## When to recompute

`recomputeCriticalPath` Pub/Sub trigger (см. [`../../05-api/triggers.md`](../../05-api/triggers.md)) запускается когда:
- Любая task в проекте меняет `dependsOn`
- Любая task меняет `estimatedDurationMinutes`
- Любая task меняет `plannedStartAt`

**Debounce:** 5 sec — не чаще чем раз в 5 секунд per project. Если несколько изменений придут в окне 5 sec — один recompute.

## Performance optimization

Для больших проектов:

- **Topological sort** через memoization
- **Project-scoped query** — не сканируем все tasks компании
- **Composite index** `companyId + projectId` (но index возможно уже есть для других queries)
- **Cache** результатов в `_critical_path_cache/{projectId}` document
- **Background job** для проектов > 500 tasks (не in-trigger)

## Edge cases

### Tasks без `projectId`

CPM рассчитывается **per project**. Tasks без `projectId` — пропускаются (или образуют свой «orphan» проект).

### Disconnected graph

Если в проекте 2 несвязанных кластера задач — CPM рассчитывается отдельно для каждого. Каждый имеет свой critical path.

### Cycles (защита)

Cycle detection в API `addDependency` (см. [`cycle-prevention.md`](cycle-prevention.md)). Но защитная проверка в CPM: если cycle обнаружен → log error + skip recompute (не падать в infinite loop).

### Lag minutes

Учитываются в forward/backward pass:
- Negative lag (overlap) уменьшает earliest start dependent task
- Positive lag увеличивает earliest start

### Type SS (Start-to-Start) и FF

Forward pass работает с типами:
- FS: `T.earliestStart = max(predecessor.earliestEnd + lag)`
- SS: `T.earliestStart = max(predecessor.earliestStart + lag)`
- FF: `T.earliestEnd = max(predecessor.earliestEnd + lag)`
- SF: `T.earliestEnd = max(predecessor.earliestStart + lag)`

## UI usage

### Gantt critical path toggle

```typescript
<Gantt tasks={tasks} highlightCriticalPath={true}>
  {tasks.map(t => (
    <GanttBar
      task={t}
      className={t.isCriticalPath ? 'border-2 border-rose-500' : ''}
    />
  ))}
</Gantt>
```

### Mind Map view

Critical path nodes — bold red outline; edges — thick red.

См.: [`dag-visualization.md`](dag-visualization.md)

### Slack visibility

В Detail page — show «Slack: 2 days» chip если `slackMinutes > 0`.

---

**См. также:**
- [Three link types](three-link-types.md)
- [Task dependency interface](task-dependency-interface.md)
- [Auto-shift cascade](auto-shift-cascade.md) — uses blocksTaskIds
- [DAG visualization](dag-visualization.md) — uses isCriticalPath
- [Acceptance criteria](acceptance-criteria.md) — performance criteria
- [`../../05-api/triggers.md`](../../05-api/triggers.md) — recomputeCriticalPath trigger
- [`../construction-gantt/critical-path.md`](../construction-gantt/critical-path.md) — Gantt UI usage
