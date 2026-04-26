---
title: "08.hierarchy.3 SubtaskRollup (computed aggregate)"
section: "08-modules/hierarchy"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# SubtaskRollup — computed aggregate на parent

> Поле `parent.subtaskRollup` — computed aggregate всех subtasks. Пересчитывается trigger'ом `onTaskUpdate` атомарно (transaction). Используется для прогресс-баров в UI, реальных дедлайнов parent'а, финансовой картинки.

ТЗ §11.3.

## Type

```typescript
interface SubtaskRollup {
  // Computed by onTaskUpdate trigger когда subtask меняется.
  countByLifecycle: Record<TaskLifecycle, number>;  // { ready: 3, started: 1, completed: 2, accepted: 0 }
  totalCostInternal: number;                         // sum of subtask.costInternal
  totalPriceClient: number;
  totalEstimatedMinutes: number;
  totalActualMinutes: number;
  completedFraction: number;                         // 0..1, процент done/accepted
  earliestDueAt?: Timestamp;                         // min(subtask.dueAt) — реальный дедлайн parent'а
  latestCompletedAt?: Timestamp;                     // max(subtask.completedAt)
  blockedCount: number;                              // сколько subtasks в lifecycle='blocked'
}
```

## Использование каждого поля

### `completedFraction` (0..1)

% accepted/done из всех subtasks. Используется для **прогресс-бара** в card:

```
[████████░░] 3/5 accepted (60%)
```

Формула:
```typescript
completedFraction = (countByLifecycle.completed + countByLifecycle.accepted) / totalSubtasks
```

### `earliestDueAt`

`min(subtask.dueAt)` — **реальный дедлайн parent'а**.

Потому что одна просроченная subtask = просроченный parent. Если parent.dueAt = next month, но subtask.dueAt = tomorrow — реально parent в risk сейчас.

UI должен показывать `earliestDueAt` как «effective due», а собственный `parent.dueAt` — как secondary info.

### `totalCostInternal` / `totalPriceClient`

Суммы для финансовой картинки. PM видит на parent card сразу: «Total scope $5,200 internal, $7,800 to client» — без drilling в каждую subtask.

### `totalEstimatedMinutes` / `totalActualMinutes`

План vs факт по времени. Используется в Detail page для variance analysis: «estimated 40h, actual 52h, ratio 1.3».

### `blockedCount`

Алерт PM: «3 subtasks в blocked» — нужно разобраться. Иконка warning на parent card.

### `latestCompletedAt`

Когда finalize parent. Полезно для closeout phase: все subtasks done since X — пора финализировать.

### `countByLifecycle`

Distribution по lifecycle. Используется для:
- Donut chart в Detail page
- Auto-rollup suggestions (см. [`auto-rollup.md`](auto-rollup.md))

## Trigger implementation

```typescript
// functions/src/triggers/onTaskUpdate.ts

async function recomputeSubtaskRollup(parentId: string) {
  await db.runTransaction(async (tx) => {
    const subtasks = await tx.get(
      db.collection('tasktotime_tasks')
        .where('parentTaskId', '==', parentId)
    );

    const rollup: SubtaskRollup = {
      countByLifecycle: { draft: 0, ready: 0, started: 0, blocked: 0, completed: 0, accepted: 0, cancelled: 0 },
      totalCostInternal: 0,
      totalPriceClient: 0,
      totalEstimatedMinutes: 0,
      totalActualMinutes: 0,
      completedFraction: 0,
      blockedCount: 0,
    };

    let earliestDue: Timestamp | undefined;
    let latestCompleted: Timestamp | undefined;
    const totalSubtasks = subtasks.size;

    for (const doc of subtasks.docs) {
      const sub = doc.data() as Task;
      rollup.countByLifecycle[sub.lifecycle]++;
      rollup.totalCostInternal += sub.costInternal.amount;
      rollup.totalPriceClient += sub.priceClient.amount;
      rollup.totalEstimatedMinutes += sub.estimatedDurationMinutes;
      rollup.totalActualMinutes += sub.actualDurationMinutes;
      if (sub.lifecycle === 'blocked') rollup.blockedCount++;

      if (sub.dueAt && (!earliestDue || sub.dueAt < earliestDue)) {
        earliestDue = sub.dueAt;
      }
      if (sub.completedAt && (!latestCompleted || sub.completedAt > latestCompleted)) {
        latestCompleted = sub.completedAt;
      }
    }

    rollup.completedFraction = totalSubtasks === 0
      ? 0
      : (rollup.countByLifecycle.completed + rollup.countByLifecycle.accepted) / totalSubtasks;
    if (earliestDue) rollup.earliestDueAt = earliestDue;
    if (latestCompleted) rollup.latestCompletedAt = latestCompleted;

    tx.update(db.collection('tasktotime_tasks').doc(parentId), {
      subtaskRollup: rollup,
    });
  });
}
```

## Idempotency

`if (deepEqual(before.subtaskRollup, newRollup)) return;` — не писать если ничего не поменялось.

Это предотвращает бесконечный loop: write rollup → triggers onTaskUpdate → recompute rollup → write same value → ...

## Performance

Для parent с 50 subtasks — recompute занимает ~500ms (50 reads + 1 write в transaction). Acceptable.

Для parent с 1000+ subtasks (теоретически) — это batched job, не in-transaction. Но default expectation: <50 subtasks per parent.

## Когда пересчитывается

Когда любое из этих поле любой subtask меняется:
- `lifecycle`
- `costInternal.amount`, `priceClient.amount`
- `estimatedDurationMinutes`, `actualDurationMinutes`
- `dueAt`, `completedAt`

Watched fields list определены в `onTaskUpdate` trigger — оптимизация чтобы не делать full recompute на любое изменение.

---

**См. также:**
- [Model](model.md)
- [Auto-rollup](auto-rollup.md) — suggested transitions parent'а на основе rollup
- [Tree view UI](tree-view-ui.md) — где отображается rollup
- [`../../02-data-model/sub-types.md`](../../02-data-model/sub-types.md) — SubtaskRollup type
- [`../../05-api/triggers.md`](../../05-api/triggers.md) — onTaskUpdate trigger
- [`../../06-ui-ux/task-card-anatomy.md`](../../06-ui-ux/task-card-anatomy.md) — compact-with-progress variant
