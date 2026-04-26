---
title: "08.graph.4 Auto-shift cascade (техническая реализация)"
section: "08-modules/graph-dependencies"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Auto-shift cascade — техническая реализация

> Когда `Task A.actualEndAt > A.plannedEndAt` (закончили позже плана), trigger пересчитывает `plannedStartAt` всех зависимых задач (где `autoShiftEnabled`). Каскадно дальше с rate limit max 3 levels (защита от bomb). Связано с AI-фичей в [`../../07-ai/auto-shift.md`](../../07-ai/auto-shift.md).

ТЗ §12.4.

## Алгоритм

```typescript
async function cascadeAutoShift(triggerTaskId: string, level: number = 1) {
  if (level > 3) {
    // Schedule background job for further levels
    await pubsub.publish('cascade-auto-shift-deep', { taskId: triggerTaskId, level });
    return;
  }

  const trigger = await getTask(triggerTaskId);
  const dependentIds = trigger.blocksTaskIds ?? [];

  await db.runTransaction(async (tx) => {
    for (const depId of dependentIds) {
      const dep = await tx.get(db.collection('tasktotime_tasks').doc(depId));
      const depData = dep.data() as Task;

      if (!depData.autoShiftEnabled) {
        // Just write warning to history, don't shift
        tx.update(dep.ref, {
          history: admin.firestore.FieldValue.arrayUnion({
            type: 'predecessor_overdue_warning',
            predecessorId: triggerTaskId,
            at: Timestamp.now(),
            note: `Predecessor finished ${formatRelative(trigger.actualEndAt, trigger.plannedEndAt)} late, but autoShiftEnabled=false`
          })
        });
        continue;
      }

      // Find the dependency definition (which type, lag)
      const depDef = depData.dependsOn?.find(d => d.taskId === triggerTaskId);
      if (!depDef) continue;

      // Calculate new plannedStartAt based on type
      let newPlannedStart: Timestamp;
      switch (depDef.type) {
        case 'finish_to_start':
          newPlannedStart = addMinutes(trigger.actualEndAt, depDef.lagMinutes ?? 0);
          break;
        case 'start_to_start':
          newPlannedStart = addMinutes(trigger.actualStartAt, depDef.lagMinutes ?? 0);
          break;
        case 'finish_to_finish': {
          const newEnd = addMinutes(trigger.actualEndAt, depDef.lagMinutes ?? 0);
          newPlannedStart = subtractMinutes(newEnd, depData.estimatedDurationMinutes);
          break;
        }
        case 'start_to_finish': {
          const newEnd = addMinutes(trigger.actualStartAt, depDef.lagMinutes ?? 0);
          newPlannedStart = subtractMinutes(newEnd, depData.estimatedDurationMinutes);
          break;
        }
      }

      // Update dependent task
      tx.update(dep.ref, {
        plannedStartAt: newPlannedStart,
        history: admin.firestore.FieldValue.arrayUnion({
          type: 'dependency_shifted',
          predecessorId: triggerTaskId,
          oldPlannedStart: depData.plannedStartAt,
          newPlannedStart,
          reason: `Predecessor finished late by ${formatRelative(trigger.actualEndAt, trigger.plannedEndAt)}`,
          at: Timestamp.now()
        })
      });

      // Notify assignee
      await sendTelegram(depData.assignedTo.id,
        `Задача "${depData.title}" сдвинута на ${formatRelative(newPlannedStart, depData.plannedStartAt)} из-за задержки "${trigger.title}"`
      );
    }
  });

  // Recursively cascade
  for (const depId of dependentIds) {
    await cascadeAutoShift(depId, level + 1);
  }
}
```

## Rate limit max 3 levels

Без rate limit — bug в `dependsOn` graph мог бы каскадить infinite update'ы → 1 trigger создаёт 100 trigger'ов → infinite loop → **$10,000 billing bomb** (CLAUDE.md §2.1).

**Защита:**
- **Max 3 levels** в одной transaction (за один `onTaskUpdate` event)
- Если глубже → создаётся background job через **Pub/Sub** (`cascade-auto-shift-deep` topic)
- Pub/Sub subscriber обрабатывает, добивает остаток

**Тест на цепочке:** A → B → C → D → E.
- Изменение `A.actualEnd` сдвигает B, C, D в одной transaction
- E добивается в следующем background job
- В тестах verify: 5 tasks все сдвинуты, no infinite loop

## `autoShiftEnabled` flag

Per-task setting:

| `autoShiftEnabled` | Поведение |
|---|---|
| `true` (default для AI-generated tasks) | Автоматически сдвигаем |
| `false` (для manually managed) | Только пишем warning в `taskHistory`, PM решает вручную |

Флаг можно изменить в Detail page или bulk через Table view.

## Notifications

Sends:
- **Telegram** assignee'у каждой смещённой задачи: «Задача "Drywall" сдвинута на 1d из-за задержки "Plumbing rough"»
- **In-app notification** в Inbox PM (для overview)

## Idempotency

Не запускать cascade повторно для same trigger event:
- `processedEvents/{eventId}_cascade` маркер 5-min TTL
- Проверка `if (deepEqual(before.actualEndAt, after.actualEndAt)) return null;`

## Edge cases

### Type SS (Start-to-Start)

Реагирует на изменение `actualStartAt`, не `actualEndAt`. Trigger:
```typescript
if (after.actualStartAt !== before.actualStartAt) {
  await cascadeForType('start_to_start', after.id);
}
```

### Type FF (Finish-to-Finish)

`B.plannedEndAt = A.actualEndAt + lag`. Соответственно `B.plannedStartAt = plannedEndAt - estimatedDurationMinutes`.

Если `B.estimatedDurationMinutes` very large, may shift `plannedStartAt` to past — show warning.

### Soft dependencies (`isHardBlock: false`)

Cascade всё ещё происходит (если autoShiftEnabled), но в notification message: «soft dependency, можно игнорировать».

### Cancelled predecessor

Если A → cancelled: dependent B получает warning «зависимость A отменена», но **НЕ сдвиг**. PM решает что делать.

```typescript
if (after.lifecycle === 'cancelled') {
  // Notify dependents but don't shift
  for (const depId of after.blocksTaskIds ?? []) {
    await sendTelegram(...);
  }
}
```

### Concurrent shifts

Если 2 different predecessors сдвигают same dependent:
- Last write wins
- В history events видно последовательность shifts
- PM может откатить через manual edit

## Performance

- Cascade max 3 levels in-transaction (~50 reads/writes worst case for fan-out 5)
- Time: < 1 sec для max cascade
- For 1000+ task projects — background job обрабатывает остаток

---

**См. также:**
- [Three link types](three-link-types.md)
- [Task dependency interface](task-dependency-interface.md)
- [Computed fields](computed-fields.md) — blocksTaskIds used here
- [Cycle prevention](cycle-prevention.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../../07-ai/auto-shift.md`](../../07-ai/auto-shift.md) — semantic AI angle
- [`../../05-api/triggers.md`](../../05-api/triggers.md) — onTaskUpdate trigger
