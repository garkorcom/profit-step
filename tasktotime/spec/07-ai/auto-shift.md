---
title: "07.4 Auto-shift cascade"
section: "07-ai"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# AI Auto-shift dependencies cascade

> Когда `Task A.completedAt` пишется (т.е. A закончилось позже плана), `Task B.plannedStartAt` автосдвигается если `B.dependsOn[A]` и `B.autoShiftEnabled`. Это связано с §7.2 #3 в ТЗ + §12.4 cascade. Защищено rate limit max 3 levels.

См. также техническую реализацию: [`../08-modules/graph-dependencies/auto-shift-cascade.md`](../08-modules/graph-dependencies/auto-shift-cascade.md)

## Trigger

`onTaskUpdate` Cloud Function:

```
if (after.actualEndAt > after.plannedEndAt) {
  // Закончили позже плана
  await cascadeAutoShift(after.id);
}
```

## Алгоритм

1. Trigger `onTaskUpdate` фильтрует `Task[].dependsOn[].taskId === A.id && autoShiftEnabled === true`
2. Для каждой dependent task пересчитывает `plannedStartAt` исходя из `dependency.type` и `lagMinutes`
3. Каскадно дальше — но с **rate limit max 3 levels** в одной транзакции (защита от bomb)
4. Пишет `taskHistory[]` event `dependency_shifted` с reason
5. Sends Telegram notification assignee'у каждой смещённой задачи

## Rate limit (защита от bomb)

Без rate limit — bug в `dependsOn` graph мог бы каскадить infinite update'ы → 1 trigger создаёт 100 trigger'ов → infinite loop → $10,000 billing bomb.

**Защита:**

- **Max 3 levels** в одной transaction (за один `onTaskUpdate` event)
- Если глубже → создаётся background job через Pub/Sub, который добивает остаток
- Тест на цепочке: A → B → C → D → E. Изменение A.actualEnd сдвигает B, C, D в одной transaction; E добивается в следующем background job.

## `autoShiftEnabled` flag

Per-task setting:

| `autoShiftEnabled` | Поведение |
|---|---|
| `true` (default для AI-generated) | Автоматически сдвигаем |
| `false` (для manually managed) | Только пишем warning в `taskHistory` («предшественник опоздал на 1d, plannedStart НЕ обновлён»). PM решает вручную через UI |

Флаг можно изменить в Detail page, или bulk через Table view.

## Notification

Sends:
- **Telegram** assignee'у: «Задача "Drywall" сдвинута на 1d из-за задержки "Plumbing rough"»
- **In-app notification** в Inbox PM

## Edge cases

### Lag minutes

Если `dependency.lagMinutes > 0` (запланированная задержка после A.end):
- B.plannedStartAt = A.actualEndAt + lagMinutes

Если `lagMinutes < 0` (можно начать раньше окончания A — overlap):
- B.plannedStartAt = A.actualEndAt + lagMinutes (т.е. earlier)

### Type SS (Start-to-Start)

Если `dependency.type === 'start_to_start'`:
- Не реагирует на `actualEndAt`. Реагирует на `actualStartAt`.
- B.plannedStartAt = A.actualStartAt + lagMinutes

### Type FF (Finish-to-Finish)

`B.plannedEndAt = A.actualEndAt + lagMinutes`. Соответственно `B.plannedStartAt = plannedEndAt - estimatedDurationMinutes`.

### Soft dependencies (`isHardBlock: false`)

Cascade всё ещё происходит (если autoShiftEnabled), но в notification message: «soft dependency, можно игнорировать».

### Cancelled predecessor

Если A → cancelled: dependent B получает warning «зависимость A отменена», но НЕ сдвиг. PM решает что делать.

## AI involvement

Чисто mechanical — никакого AI prompt'а. Просто trigger logic.

Однако AI может suggest disable `autoShiftEnabled` для задач которые часто меняются (через `anomaly detection` — см. [`anomaly-detection.md`](anomaly-detection.md)): «эта задача 5 раз сдвигалась за неделю — может, отключить autoShift?»

---

**См. также:**
- [Integration overview](integration-overview.md)
- [Anomaly detection](anomaly-detection.md) — связанная фича
- [`../08-modules/graph-dependencies/auto-shift-cascade.md`](../08-modules/graph-dependencies/auto-shift-cascade.md) — техническая реализация
- [`../08-modules/graph-dependencies/task-dependency-interface.md`](../08-modules/graph-dependencies/task-dependency-interface.md) — TaskDependency model
- [`../05-api/triggers.md`](../05-api/triggers.md) — onTaskUpdate trigger
