---
title: "07.3 Decompose estimate → tasks"
section: "07-ai"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# AI Decompose estimate → tasks

> `estimates/{id}` → много `tasks{}` с автоматическим bucket assignment, `dependsOn` graph (parallel vs sequential работы). Это Этап 2 SPEC, объединяет старые `projectAutomation` + `clientJourneyTriggers`.

Callable: `decomposeEstimate(estimateId)` (см. [`../05-api/callables.md`](../05-api/callables.md))

## Workflow

```
Estimate created (commercial offer signed by client)
       ↓
PM или automation вызывает decomposeEstimate(estimateId)
       ↓
Claude анализирует estimate items
       ↓
Создаёт root tasks для каждого major scope item
       ↓
Каждый root task получает 3-7 subtasks (зависит от complexity)
       ↓
AI определяет dependencies (sequential vs parallel)
       ↓
Создаёт TaskDependency edges с типом FS / SS / FF
       ↓
Возвращает tasksCreated[] + dependencyGraph[] + suggestedSchedule[]
       ↓
PM ревью в UI (preview/diff)
       ↓
PM apply → tasks становятся `ready`
```

## Input/output

```typescript
// callable signature
decomposeEstimate({ estimateId, dryRun?: boolean }) → {
  tasksCreated: Task[],          // root + subtasks
  dependencyGraph: TaskDependency[],
  totalEstimatedDuration: number,
  suggestedSchedule: Array<{
    taskId: string,
    plannedStart: Timestamp,
    plannedEnd: Timestamp
  }>
}
```

## AI prompt (high-level)

```
You are a construction project planner. Given an estimate with items, decompose into actionable tasks.

For each estimate item:
1. Create a ROOT task (e.g. «Bathroom remodel»)
2. Decompose into 3-7 SUBTASKS (e.g. «Demo», «Plumbing rough», «Drywall», «Tile», «Finish»)
3. Determine dependencies:
   - Sequential (FS): «demo» → «plumbing rough» → «drywall» → «tile» → «finish»
   - Parallel (SS): «electrical rough» can run parallel with «plumbing rough»
   - Synchronous end (FF): «inspection» finishes when «cleanup» finishes
4. Assign phase: demo / rough / finish / closeout
5. Estimate duration based on:
   - Estimate item quantity (sqft, units)
   - Historical data from similar projects (if provided)
   - Industry standards

Return JSON: { rootTasks: [...], subtasks: [...], dependencies: [...] }
```

## Idempotency

Через `sourceEstimateId` field на каждой создаваемой task.

```typescript
// before creating, check
const existing = await db.collection('tasktotime_tasks')
  .where('companyId', '==', companyId)
  .where('sourceEstimateId', '==', estimateId)
  .where('isSubtask', '==', false)  // только root tasks
  .get();

if (!existing.empty) {
  return { tasksCreated: [], message: 'Already decomposed', existingTaskIds: existing.docs.map(d => d.id) };
}
```

Composite index: `companyId + sourceEstimateId + isSubtask` (см. [`../04-storage/indexes.md`](../04-storage/indexes.md))

## Auto-fill для созданных tasks

Каждый task получает:
- `sourceEstimateId` — link обратно к estimate
- `sourceEstimateItemId` — конкретный item который декомпозировался
- `clientId` / `clientName` / `projectId` / `projectName` — из estimate
- `costInternal` / `priceClient` — пропорциональные share от estimate item
- `materials` — из estimate item materials breakdown
- `assignedTo` — AI suggests на основе типа работ + team availability
- `lifecycle: 'draft'` — пока PM не подтвердит

## Hierarchy creation

Root task + subtasks atomically через transaction:

```typescript
await db.runTransaction(async (tx) => {
  const rootRef = db.collection('tasktotime_tasks').doc();
  tx.set(rootRef, { ...rootData, isSubtask: false, subtaskIds: [] });

  for (const subData of subtasks) {
    const subRef = db.collection('tasktotime_tasks').doc();
    tx.set(subRef, { ...subData, parentTaskId: rootRef.id, isSubtask: true });
  }

  // update root.subtaskIds после всех subs
  tx.update(rootRef, { subtaskIds: subRefs.map(r => r.id) });
});
```

## Dependencies creation

После создания tasks (когда есть IDs) — записываем `dependsOn[]`:

```typescript
for (const dep of dependencyGraph) {
  await db.collection('tasktotime_tasks').doc(dep.fromTaskId).update({
    dependsOn: admin.firestore.FieldValue.arrayUnion({
      taskId: dep.toTaskId,
      type: dep.type,
      lagMinutes: dep.lagMinutes ?? 0,
      isHardBlock: dep.isHardBlock ?? true,
      reason: dep.reason ?? `From decomposeEstimate ${estimateId}`,
      createdAt: now,
      createdBy: { id: 'ai-decompose', name: 'AI Decompose Estimate' }
    })
  });
}
```

## Cycle prevention

AI должен валидно генерировать DAG, но дополнительная защита через `DependencyService.validateDependencyGraph()` перед write — если cycle, throw.

См.: [`../08-modules/graph-dependencies/cycle-prevention.md`](../08-modules/graph-dependencies/cycle-prevention.md)

## Suggested schedule

Базовый CPM (Critical Path Method) после построения DAG:
- Forward pass: рассчитать earliest start для каждой task
- Backward pass: latest start
- Critical path: tasks где earliest = latest (slack = 0)

Возвращается как `suggestedSchedule[]` для UI Gantt preview.

## UI preview

PM видит **Mind Map view** созданных tasks с зависимостями (xyflow). Может drag-drop переставить, удалить, добавить tasks. После approve — apply (tasks становятся `ready`).

## Acceptance criteria

См.: [`../08-modules/graph-dependencies/acceptance-criteria.md`](../08-modules/graph-dependencies/acceptance-criteria.md)

---

**См. также:**
- [Integration overview](integration-overview.md)
- [AI safety](ai-safety.md)
- [`../05-api/callables.md`](../05-api/callables.md) — `decomposeEstimate` signature
- [`../08-modules/graph-dependencies/`](../08-modules/graph-dependencies/) — DAG модель
- [`../08-modules/hierarchy/model.md`](../08-modules/hierarchy/model.md) — Task → Subtask
