---
title: "08.gantt.4 Milestone diamonds"
section: "08-modules/construction-gantt"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Milestone diamonds

> Задачи с `category in ('inspection', 'permit')` или `isMilestone: true` рендерятся не полоской а **ромбом** на Gantt timeline. Это стандарт MS Project / Procore.

ТЗ §15.4.

## Когда рендерится как diamond

```typescript
const isMilestone =
  task.category === 'inspection' ||
  task.category === 'permit' ||
  task.isMilestone === true;  // explicit flag (legacy)
```

## Visual

```
Day 1   Day 2   Day 3   Day 4   Day 5
─────────────────────────────────────
Demo bathroom    ▓▓▓▓
Plumbing rough           ▓▓▓▓▓▓▓
                                  ◆     ← milestone diamond
                            Plumbing inspection
Drywall hang                       ▓▓▓▓▓▓
                                          ◆     ← another milestone
                                    Drywall inspection
Tile install                              ▓▓▓▓▓▓▓
```

## Diamond styling

```css
.gantt-milestone {
  width: 24px;
  height: 24px;
  transform: rotate(45deg);
  background: var(--color);  /* lifecycle-based */
  border: 2px solid var(--color-darker);
}
```

Цвет — по lifecycle (см. [`../../06-ui-ux/task-card-anatomy.md`](../../06-ui-ux/task-card-anatomy.md)):

| Lifecycle | Diamond color |
|---|---|
| `draft` | gray |
| `ready` | blue |
| `started` | green pulsing |
| `completed` | indigo |
| `accepted` | dark green |
| `cancelled` | gray strikethrough |

## Position

Diamond центрируется на `dueAt` date (single point in time, not range).

## Hover

Tooltip:
```
Plumbing inspection
Date: Apr 12, 2026
Status: ready
Inspector: TBD
[Click to open]
```

## Categories

| Category | Use case |
|---|---|
| `inspection` | Plumbing inspection, Electrical inspection, Drywall inspection, Final inspection |
| `permit` | Building permit ready, Plumbing permit issued, Electrical permit issued |

`category` field устанавливается:
- Manually через UI dropdown
- Auto by AI via `decomposeEstimate`
- Auto by template (e.g. «Bathroom remodel» template добавляет 4 inspections)

## Default scope

Standard inspections для остальных проектов:

| Phase | Inspections |
|---|---|
| `rough` | Plumbing rough, Electrical rough, Framing rough, HVAC rough |
| `finish` | Drywall, Insulation, Final electrical, Final plumbing |
| `closeout` | Final inspection (city), Final walkthrough (client) |

Permits typically:
- Building permit (1)
- Plumbing permit (1)
- Electrical permit (1)
- HVAC permit (1, если applicable)

## Click on diamond

Opens task drawer (как regular task). В drawer — special section «Inspection details»:

```
┌────────────────────────────────────┐
│  Plumbing inspection                │
│  Status: ready                      │
│  Date: Apr 12, 2026 9-11am         │
│  Inspector: Tampa Building Dept    │
│  Permit #: BR-2026-0123            │
│                                     │
│  [Reschedule] [Mark passed] [Failed]│
└────────────────────────────────────┘
```

## Failed inspections

Если inspection failed (rejected by city) — `lifecycle = 'blocked'` + `blockedReason: 'Inspection failed: needs repipe'`. UI показывает diamond с red X overlay.

## Difference from milestone bar (legacy)

В существующем `gtd_tasks` есть поле `isMilestone: boolean` который меняет visual в Gantt. В новом модели — это subset of `category`. Migration mapping:

```typescript
if (oldTask.isMilestone === true) {
  newTask.category = 'inspection';  // default; PM can change to 'permit'
}
```

См.: [`../../04-storage/migration-mapping.md`](../../04-storage/migration-mapping.md)

## Acceptance

См.: [`acceptance-criteria.md`](acceptance-criteria.md):
- ✓ Milestone diamonds для inspection/permit

---

**См. также:**
- [Plan vs actual](plan-vs-actual.md)
- [Group by](group-by.md) — group by category показывает все inspections в одной row
- [Acceptance criteria](acceptance-criteria.md)
- [`../../02-data-model/sub-types.md`](../../02-data-model/sub-types.md) — TaskCategory
- [`../../04-storage/migration-mapping.md`](../../04-storage/migration-mapping.md)
