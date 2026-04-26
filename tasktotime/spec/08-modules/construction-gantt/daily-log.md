---
title: "08.gantt.7 Daily Log integration (Buildertrend-style)"
section: "08-modules/construction-gantt"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Daily Log integration (Buildertrend-style)

> В Gantt cell для дня где было work_session активность — добавляется точка «●» с цветом по статусу. Click → opens daily log modal: фото, заметки, кто что делал в этот день. Источник данных: `work_sessions` collection.

ТЗ §15.7.

## Visual

```
Day 1   Day 2   Day 3   Day 4   Day 5   Day 6
─────────────────────────────────────────────
Demo bathroom    ▓▓▓▓    ●  ●           ●           ← work_session dots
                                ┊
                              click
                                ▼
Plumbing rough        ▓▓▓▓▓▓▓▓    ●  ●  ●

Drywall hang                              ▓▓▓▓▓▓
                                            ●  ●
```

Каждый ● = одна work_session.

## Color coding

Цвет точки:

| Что | Color |
|---|---|
| Active session (still running) | green pulsing |
| Completed session, no issues | gray |
| Session with «issue» tag | amber |
| Multiple sessions same day | larger dot or count «●3» |

## Click on dot → daily log modal

```
┌──────────────────────────────────────────────┐
│ Daily log — Apr 8, 2026 — Plumbing rough     │
│                                              │
│ Sessions today (2):                          │
│                                              │
│ ┌─ Sergey · 9:00am - 12:30pm (3.5h)          │
│ │  Notes: «Found rotted joist under tub.     │
│ │   Replaced with pressure-treated 2×6.»    │
│ │  Photos: [📷] [📷] [📷]                     │
│ │                                            │
│ ├─ Sergey · 1:30pm - 5:00pm (3.5h)           │
│ │  Notes: «Plumbing rough done. Ready for    │
│ │   inspection tomorrow.»                    │
│ │  Photos: [📷] [📷]                          │
│ │                                            │
│ └─ Total: 7h                                 │
│                                              │
│           [Open in time-tracking]            │
└──────────────────────────────────────────────┘
```

## Источник данных: `work_sessions`

Коллекция `work_sessions` (existing — НЕ трогаем). Query для daily log:

```typescript
async function getDailyLog(taskId: string, date: Date) {
  const sessions = await db.collection('work_sessions')
    .where('relatedTaskId', '==', taskId)
    .where('completedAt', '>=', startOfDay(date))
    .where('completedAt', '<=', endOfDay(date))
    .orderBy('completedAt', 'asc')
    .get();

  return sessions.docs.map(d => d.data());
}
```

## Aggregation

Для Gantt rendering — нужно знать какие days имеют sessions (без fetch всех session details). Aggregation хранится:

**Option A: computed field on task**

```typescript
interface Task {
  // ...
  workSessionDays?: string[];  // ['2026-04-08', '2026-04-09', ...]
  // computed by trigger when work_session.completedAt set
}
```

Trigger `onWorkSessionCompleted` обновляет это поле:
```typescript
const day = formatDate(session.completedAt, 'YYYY-MM-DD');
await taskRef.update({
  workSessionDays: admin.firestore.FieldValue.arrayUnion(day)
});
```

**Option B: separate aggregate collection**

`task_session_agg/{taskId}/{day}` — count sessions per day. Менее efficient, не используем.

## UI rendering

```typescript
function GanttRow({ task, dayWidth, startDate }: GanttRowProps) {
  const sessionDays = task.workSessionDays ?? [];

  return (
    <div className="gantt-row">
      <PlanVsActualBar task={task} />

      {/* Render dots for session days */}
      {sessionDays.map(day => {
        const dayOffset = differenceInDays(parseISO(day), startDate);
        return (
          <button
            key={day}
            className="gantt-session-dot"
            style={{ left: dayOffset * dayWidth + dayWidth / 2 }}
            onClick={() => openDailyLogModal(task.id, day)}
          >
            ●
          </button>
        );
      })}
    </div>
  );
}
```

## Buildertrend reference

Buildertrend daily log feature — industry leader. Что они делают:
- Photos + text notes per day per project
- Weather conditions snapshot
- Personnel on-site (subcontractors)
- Equipment used
- Materials delivered
- Safety incidents

В нашем модуле:
- Photos + notes — есть в work_sessions (existing fields)
- Personnel — `session.userId`
- Materials — через `task.materials[]` updates
- Weather — через weather warning (см. [`weather-day.md`](weather-day.md))
- Safety incidents — TBD (open question)

## Mobile

На mobile — daily log это особенно важно (worker на site вечером loggs day).

В Telegram bot:
```
Worker: /log <photo> Plumbing rough done, ready for inspection
   ↓
Bot creates work_session:
   { relatedTaskId, userId, completedAt, notes, photos }
   ↓
Bot acks: «Logged 30 minutes Plumbing rough»
```

См.: CLAUDE.md §4 (current bot behavior).

## Daily Log как dedicated view

Future enhancement (Phase 4+):
- View `/tasktotime?view=daily-log&date=...&projectId=...`
- Все sessions across all tasks за выбранный day
- Group by project / by worker
- Export PDF day report для клиента

## Acceptance

См.: [`acceptance-criteria.md`](acceptance-criteria.md):
- ✓ Daily Log dot click open work_sessions modal

---

**См. также:**
- [Plan vs actual](plan-vs-actual.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../../04-storage/collections.md`](../../04-storage/collections.md) — work_sessions reference
- [`../../05-api/triggers.md`](../../05-api/triggers.md) — onWorkSessionCompleted trigger
- [`../../05-api/rest-endpoints.md`](../../05-api/rest-endpoints.md) — GET .../sessions endpoint
