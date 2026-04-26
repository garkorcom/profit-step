---
title: "07.6 Bonus/penalty cron"
section: "07-ai"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Bonus/penalty auto-application

> `overdueEscalation` cron автоматически применяет `bonusOnTime` если `completedAt ≤ dueAt`, или `penaltyOverdue` если `completedAt > dueAt`. Создаёт записи в payroll. Это связано с §7.2 #5 в ТЗ.

## Поля на task

```typescript
interface Task {
  bonusOnTime?: Money;          // = «премия за вовремя» (NEW)
  penaltyOverdue?: Money;       // = «штраф за не вовремя» (NEW)
  // + completedAt, dueAt
}
```

Если оба null — никакой обработки. Денис может задать одно или оба per task.

## Cron schedule

`overdueEscalation` cron — every hour (`30 * * * *`).

См.: [`../05-api/triggers.md`](../05-api/triggers.md)

## Алгоритм

```typescript
async function overdueEscalationCron() {
  const tasks = await db.collection('tasktotime_tasks')
    .where('lifecycle', '==', 'completed')
    .where('completedAt', '!=', null)
    .where('payrollProcessedAt', '==', null)  // ещё не обработан
    .get();

  for (const taskDoc of tasks.docs) {
    const task = taskDoc.data();
    const onTime = task.completedAt <= task.dueAt;

    if (onTime && task.bonusOnTime) {
      await applyBonusOnTime(task);
    } else if (!onTime && task.penaltyOverdue) {
      await applyPenaltyOverdue(task);
    }

    // Mark as processed
    await taskDoc.ref.update({ payrollProcessedAt: Timestamp.now() });
  }
}
```

## `applyBonusOnTime`

```typescript
async function applyBonusOnTime(task: Task) {
  await db.collection('payroll_entries').add({
    companyId: task.companyId,
    userId: task.assignedTo.id,
    taskId: task.id,
    type: 'bonus',
    reason: 'on_time_completion',
    amount: task.bonusOnTime!.amount,
    currency: task.bonusOnTime!.currency,
    appliedAt: Timestamp.now(),
    autoApplied: true,
  });

  // Notify assignee
  await sendTelegram(task.assignedTo.id,
    `🎉 Премия $${task.bonusOnTime!.amount} за вовремя выполненную «${task.title}»`
  );

  // History event
  await taskDoc.ref.update({
    history: admin.firestore.FieldValue.arrayUnion({
      type: 'bonus_applied',
      at: Timestamp.now(),
      amount: task.bonusOnTime!.amount,
    })
  });
}
```

## `applyPenaltyOverdue`

```typescript
async function applyPenaltyOverdue(task: Task) {
  const overdueDays = Math.ceil((task.completedAt - task.dueAt) / (24 * 60 * 60 * 1000));

  await db.collection('payroll_entries').add({
    companyId: task.companyId,
    userId: task.assignedTo.id,
    taskId: task.id,
    type: 'penalty',
    reason: 'overdue_completion',
    amount: -task.penaltyOverdue!.amount,  // negative
    currency: task.penaltyOverdue!.currency,
    overdueDays,
    appliedAt: Timestamp.now(),
    autoApplied: true,
  });

  // Notify assignee + PM
  await sendTelegram(task.assignedTo.id,
    `⚠️ Штраф $${task.penaltyOverdue!.amount} за просрочку «${task.title}» на ${overdueDays} дней`
  );

  await taskDoc.ref.update({
    history: admin.firestore.FieldValue.arrayUnion({
      type: 'penalty_applied',
      at: Timestamp.now(),
      amount: task.penaltyOverdue!.amount,
      overdueDays,
    })
  });
}
```

## Idempotency

`payrollProcessedAt` маркер на task — если уже обработан, skip.

Что если task `complete` → `cancel` через короткое время? cron может не успеть обработать. **Защита:** во `cancel` action — undo payroll entry если был bonus/penalty.

## Edge cases

### Task переоткрыт (started → completed → cancelled → ... → completed снова)

Если cron уже обработал первый `complete` — `payrollProcessedAt` set. При втором `complete` — skip.

**Решение:** при каждом transition `completed`/`cancelled` reset `payrollProcessedAt = null`. Это позволяет cron'у обработать заново.

### Manual override

PM может вручную apply / undo bonus/penalty через Detail page button:
- `POST /api/tasktotime/tasks/:id/bonus { apply: true | false }`
- `POST /api/tasktotime/tasks/:id/penalty { apply: true | false }`

При manual apply — `payrollProcessedAt` set, чтобы cron не дублировал.

### Acceptance vs completion timing

`bonusOnTime` / `penaltyOverdue` срабатывает на `completedAt`, не `acceptedAt`. То есть worker получает бонус когда закончил физически, не когда клиент подписал. Это motivation question — Денис может изменить (open question).

## AI involvement

Никакого AI prompt'а. Чисто mechanical cron.

В будущем — AI suggest bonusOnTime / penaltyOverdue values на новые tasks based on:
- Type работ
- Complexity
- Worker history

Но Phase 3 — manually set Денисом или PM.

## Open question

Денис в требованиях не уточнил:
- Бонус всегда / только если PM подтвердил?
- Штраф всегда / только при «грубой» просрочке (> 1 day)?

Default behavior: применяем всегда если поле задано. Можно отключить через `autoApplyBonusPenalty: false` в company settings.

---

**См. также:**
- [Integration overview](integration-overview.md)
- [Anomaly detection](anomaly-detection.md) — другая «automated payroll» категория
- [`../05-api/triggers.md`](../05-api/triggers.md) — overdueEscalation cron
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — bonusOnTime, penaltyOverdue fields
