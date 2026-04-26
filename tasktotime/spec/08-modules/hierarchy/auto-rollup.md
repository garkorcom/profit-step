---
title: "08.hierarchy.2 Auto-rollup статуса (Linear-style)"
section: "08-modules/hierarchy"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Auto-rollup статуса parent'а (Linear-style)

> Триггер `onTaskUpdate` пересчитывает `parent.subtaskRollup` когда subtask меняется. Но **lifecycle parent'а НЕ подменяется молча** — trigger пишет suggested transition в `parent.history`, UI показывает баннер.

ТЗ §11.2.

## Правила суггестии

| Условие на subtasks | Suggested effect на parent.lifecycle |
|---|---|
| Все subtasks в `cancelled` | parent → `cancelled` |
| Все subtasks в `accepted` | parent → `completed` (suggest accept, **не auto-accept** — нужна подпись) |
| Хотя бы 1 в `started` | parent → `started` (если был `ready`) |
| Хотя бы 1 в `blocked` | parent → `blocked` (если был `started/ready`) |
| Все в `draft/ready` | parent остаётся как был |

## Не auto-update, а suggest

**Не подменяем `parent.lifecycle` молча.** Trigger пишет:

1. Suggested transition в `parent.history`:
   ```typescript
   {
     type: 'rollup_suggestion',
     suggestion: 'parent_should_complete',
     reason: 'All 5 subtasks accepted',
     at: now
   }
   ```

2. UI показывает баннер на parent task card / detail page:
   ```
   ┌──────────────────────────────────────┐
   │ ✓ All 5 subtasks accepted            │
   │ Sign acceptance act for parent?      │
   │              [Accept] [Dismiss]      │
   └──────────────────────────────────────┘
   ```

3. PM кликает [Accept] → стандартный transition flow с акт уточнением.

## Почему не auto-update

- **Acceptance требует human подпись** — нельзя автоматически закрыть task без подписи клиента
- **PM может видеть нюансы** — все subtasks accepted ≠ ready to deliver (может быть punch list)
- **Reversal complications** — если parent auto-accepted и тут реopened subtask — что делать?

## Open question

§ Open question #10 в [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md):

«Auto-rollup parent.lifecycle — автоматически менять или только баннер? Auto = меньше кликов, но опаснее.»

Денис должен решить. Default — баннер, не auto-update.

## Trigger implementation

```typescript
// functions/src/triggers/onTaskUpdate.ts (упрощённо)

export const onTaskUpdate = functions.firestore
  .document('tasktotime_tasks/{taskId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as Task;
    const after = change.after.data() as Task;

    // Idempotency: skip if no relevant changes
    if (deepEqual(before.lifecycle, after.lifecycle) && deepEqual(before.subtaskIds, after.subtaskIds)) {
      return null;
    }

    // If lifecycle changed, check if parent needs rollup suggestion
    if (after.parentTaskId && before.lifecycle !== after.lifecycle) {
      await checkParentRollupSuggestion(after.parentTaskId);
    }

    // ... rest of trigger
  });

async function checkParentRollupSuggestion(parentId: string) {
  const subtasks = await getSubtasks(parentId);
  const allCancelled = subtasks.every(s => s.lifecycle === 'cancelled');
  const allAccepted = subtasks.every(s => s.lifecycle === 'accepted');
  const anyStarted = subtasks.some(s => s.lifecycle === 'started');
  const anyBlocked = subtasks.some(s => s.lifecycle === 'blocked');

  let suggestion: string | null = null;
  if (allCancelled) suggestion = 'parent_should_cancel';
  else if (allAccepted) suggestion = 'parent_should_complete_and_accept';
  else if (anyBlocked) suggestion = 'parent_should_block';
  else if (anyStarted) suggestion = 'parent_should_start';

  if (suggestion) {
    await db.collection('tasktotime_tasks').doc(parentId).update({
      history: admin.firestore.FieldValue.arrayUnion({
        type: 'rollup_suggestion',
        suggestion,
        reason: `Subtasks state: ${subtasks.length} total`,
        at: Timestamp.now(),
      })
    });
  }
}
```

## Idempotency

Не писать дублирующиеся suggestions — если последний history event = same suggestion, skip.

```typescript
const lastSuggestion = parent.history
  .reverse()
  .find(e => e.type === 'rollup_suggestion');

if (lastSuggestion?.suggestion === newSuggestion) {
  return; // already suggested, no need to spam
}
```

---

**См. также:**
- [Model](model.md)
- [Subtask rollup aggregate](subtask-rollup-aggregate.md) — computed data
- [Tree view UI](tree-view-ui.md) — как баннер выглядит в UI
- [`../../03-state-machine/transitions.md`](../../03-state-machine/transitions.md) — accept transition
- [`../../05-api/triggers.md`](../../05-api/triggers.md) — onTaskUpdate trigger
- [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md) — open question #10
