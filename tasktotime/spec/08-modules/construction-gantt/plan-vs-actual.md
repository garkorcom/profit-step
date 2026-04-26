---
title: "08.gantt.1 Plan vs Actual overlay"
section: "08-modules/construction-gantt"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Plan vs Actual overlay (стандарт индустрии)

> Каждый task в Gantt — две полоски: тонкая baseline (план) внизу + толстая actual overlay сверху. Это паттерн Procore / Buildertrend / Smartsheet / TeamGantt — копируем 1:1, не изобретаем.

ТЗ §15.1.

## Структура

Каждая task в Gantt = **две полоски**:

```
Day 1   Day 2   Day 3   Day 4   Day 5
┌─────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓                     │  ← actual (thick, top)
│ ░░░░░░░░░░░░░░░░░░              │  ← plan baseline (thin, bottom)
└─────────────────────────────────┘
```

Где:
- **Тонкая baseline (план)** внизу — `plannedStartAt → plannedEndAt`
- **Толстая actual overlay** сверху — `actualStartAt → actualEndAt` (или `→ now` если started)

## Цвета

| Что | Light theme | Dark theme |
|---|---|---|
| Plan baseline | `slate-300` | `slate-700` |
| Actual on-time | lifecycle color (см. [`../../06-ui-ux/task-card-anatomy.md`](../../06-ui-ux/task-card-anatomy.md)) | то же |
| Actual overdue | `rose-500` overlay на просроченную часть | то же |

### Visual examples

**On-time completion:**
```
[plan ░░░░░░░░░░░░]
[actual ▓▓▓▓▓▓▓▓▓▓▓]   ← lifecycle color (e.g. green for accepted)
```

**Started late but caught up:**
```
[plan ░░░░░░░░░░░░]
       [actual ▓▓▓▓▓▓▓▓]  ← started later, but ended on time
```

**Overdue (still in progress):**
```
[plan ░░░░░░░░░░░░]
[actual ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓]  ← red overlay на overrun зону
```

**Cancelled:**
```
[plan ▒▒▒▒▒▒▒▒▒▒▒▒]   ← grey strike-through
```

## Almost industry standard

Это **точно как в Procore** (industry leader):
- Same two-bar pattern
- Same color semantics (plan vs actual)
- Same overrun highlight

Это в Buildertrend / Smartsheet / TeamGantt тоже.

**Принцип:** не изобретаем, не делаем «лучше», копируем 1:1. Юзер из other tools сразу узнает паттерн.

## Implementation skeleton

```typescript
// tasktotime/frontend/components/TaskTimeline/PlanVsActualBar.tsx

interface PlanVsActualBarProps {
  task: Task;
  cellWidth: number;
  startDate: Date;
}

export function PlanVsActualBar({ task, cellWidth, startDate }: PlanVsActualBarProps) {
  const planStart = daysFromStart(task.plannedStartAt, startDate);
  const planEnd = daysFromStart(task.plannedEndAt, startDate);
  const actualStart = task.actualStartAt ? daysFromStart(task.actualStartAt, startDate) : null;
  const actualEnd = task.actualEndAt ?? (task.lifecycle === 'started' ? new Date() : null);
  const actualEndDays = actualEnd ? daysFromStart(actualEnd, startDate) : null;

  return (
    <div className="relative h-8">
      {/* Plan bar (thin, bottom) */}
      <div
        className="absolute bottom-0 h-2 rounded bg-slate-300 dark:bg-slate-700"
        style={{
          left: planStart * cellWidth,
          width: (planEnd - planStart) * cellWidth,
        }}
      />

      {/* Actual bar (thick, top) */}
      {actualStart !== null && actualEndDays !== null && (
        <div
          className="absolute top-0 h-4 rounded"
          style={{
            left: actualStart * cellWidth,
            width: (actualEndDays - actualStart) * cellWidth,
            backgroundColor: lifecycleColors[task.lifecycle],
          }}
        >
          {/* Overrun overlay (red) если actual extends beyond plan */}
          {actualEndDays > planEnd && (
            <div
              className="absolute top-0 right-0 h-full bg-rose-500 opacity-70"
              style={{
                width: (actualEndDays - planEnd) * cellWidth,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

## Bar interaction

- **Hover:** tooltip с full info (`Plan: Apr 1-5 (4d), Actual: Apr 1-7 (6d, 50% over)`)
- **Click:** opens task drawer
- **Drag (PM only):** reschedule (update `plannedStartAt`)
- **Resize handle:** изменить duration

## Edge cases

### Task ещё не начата

Если `actualStartAt === null` — actual bar отсутствует, только plan baseline.

### Task started, ещё не ended

Actual bar показывается до `now` (current time):
```
[plan ░░░░░░░░░░░░░░]
[actual ▓▓▓▓▓▓▓▓▓ ↓ now]
```

С animated «in progress» indicator на right edge.

### Task started but planned in future

Воркер начал раньше плана — actual bar starts left of plan baseline. UI показывает «started early» badge.

### Plan bar shorter than actual (started after plan end)

Plan baseline закончилась, actual только начался — visually disjoint:
```
[plan ░░░░░░░░░░░░░░]
                       [actual ▓▓▓▓▓▓▓▓▓▓]
```

UI showsclear indication this task is way overdue.

### Task без `plannedStartAt`

Если `plannedStartAt === null` — нет plan baseline, только actual. UI suggest «Set planned start» action.

## Performance

Для большого Gantt (1000+ tasks):
- Virtualize rows (только visible rows render)
- Cache computed positions per task
- Web Worker для CPM recalc (если на CPU-heavy)

## Acceptance

См.: [`acceptance-criteria.md`](acceptance-criteria.md)

- ✓ Plan vs Actual overlay рендерится для всех started/completed tasks

---

**См. также:**
- [Critical path](critical-path.md)
- [Group by](group-by.md)
- [Milestones](milestones.md)
- [Weather day](weather-day.md)
- [Punch list](punch-list.md)
- [Daily log](daily-log.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../../06-ui-ux/views.md`](../../06-ui-ux/views.md) — Timeline (Gantt) view
- [`../../02-data-model/task-interface.md`](../../02-data-model/task-interface.md) — plannedStartAt, actualStartAt fields
