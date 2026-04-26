---
title: "08.gantt.3 Group-by вместо Swimlanes"
section: "08-modules/construction-gantt"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Group-by вместо Swimlanes

> **Anti-pattern:** делать «swimlanes by crew» как отдельный view-таб. **Pattern:** dropdown «Group by» в Gantt toolbar. Это даёт одну Gantt view со всеми разрезами — не плодим 5 разных табов.

ТЗ §15.3.

## Anti-pattern

В существующих CRMs часто:
- View «Gantt» — flat
- View «Swimlanes by crew» — отдельный таб с тем же data, но с group rows
- View «Phases» — третий таб с тем же data, но grouped по phase

**Проблема:** 3 отдельных view = 3 codebase копии, 3 set bugs, 3 maintenance burden. Юзер confused — какой view выбрать.

## Pattern: dropdown

**Одна** Gantt view + dropdown «Group by» в toolbar.

```
┌──────────────────────────────────────────────────┐
│  Gantt — Project: Renovation Jim Dvorkin         │
│                                                  │
│  Group by: [Phase ▼]  [Critical path] [Deps]    │  ← dropdown
│                                                  │
│  Phase: Demo                                     │  ← group row
│  ──────────────────────────────────────          │
│    Demo bathroom    ▓▓▓▓                         │
│    Demo kitchen     ▓▓▓▓                         │
│                                                  │
│  Phase: Rough                                    │  ← group row
│  ──────────────────────────────────────          │
│    Plumbing rough        ▓▓▓▓▓▓▓                 │
│    Electrical rough      ▓▓▓▓▓▓                  │
│                                                  │
│  Phase: Finish                                   │
│  ...                                             │
└──────────────────────────────────────────────────┘
```

## Опции dropdown

```
Group by:
  ◉ none (плоский список)
  ○ project (default — все задачи одного проекта вместе)
  ○ room (для remodel — все задачи Bathroom 1 / Kitchen / Master Bedroom)
  ○ crew (или assignedTo — кто что делает) ← это и есть «swimlane by crew»
  ○ phase (demo / rough / finish / closeout)
  ○ category (work / punch / inspection / permit)
```

## Что значит «swimlane by crew» — теперь это `group by crew`

Result: Gantt rows grouped по assignee:

```
Sergey:
  Demo bathroom    ▓▓▓▓
  Plumbing rough            ▓▓▓▓▓▓▓
  Drywall hang                            ▓▓▓▓▓▓

Marcus:
  Demo kitchen    ▓▓▓▓
  Electrical rough          ▓▓▓▓▓▓
  Tile install                                    ▓▓▓▓▓▓▓▓

Bob:
  Inspection prep                                       ▓▓
```

Visually: каждая crew = своя horizontal swimlane.

## Implementation

```typescript
// tasktotime/frontend/components/TaskTimeline/TaskTimeline.tsx

const [groupBy, setGroupBy] = useState<GroupByOption>('project');

const groupedTasks = useMemo(() => groupTasks(tasks, groupBy), [tasks, groupBy]);

return (
  <div>
    <Toolbar>
      <GroupByDropdown value={groupBy} onChange={setGroupBy} />
      <CriticalPathToggle />
      <DependenciesToggle />
    </Toolbar>

    <GanttGrid>
      {groupedTasks.map(group => (
        <GroupRow key={group.key} title={group.label}>
          {group.tasks.map(task => (
            <PlanVsActualBar key={task.id} task={task} />
          ))}
        </GroupRow>
      ))}
    </GanttGrid>
  </div>
);
```

## Group function

```typescript
type GroupByOption = 'none' | 'project' | 'room' | 'crew' | 'phase' | 'category';

function groupTasks(tasks: Task[], by: GroupByOption): Group[] {
  if (by === 'none') return [{ key: 'all', label: '', tasks }];

  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = getGroupKey(task, by);
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, task]);
  }

  return Array.from(groups.entries())
    .map(([key, tasks]) => ({ key, label: getGroupLabel(key, by), tasks }))
    .sort(/* by label or natural order */);
}

function getGroupKey(task: Task, by: GroupByOption): string {
  switch (by) {
    case 'project': return task.projectId ?? 'no-project';
    case 'room': return task.location?.notes ?? 'no-room';
    case 'crew': return task.assignedTo.id;
    case 'phase': return task.phase ?? 'no-phase';
    case 'category': return task.category ?? 'no-category';
    default: return 'all';
  }
}
```

## Switching без reload

Switching между group-by options — instant, без full re-render:
- Tasks data uses subscription, не fetched per-group
- Grouping computed in memory
- Animation transition между layouts smooth (~200ms)

## Per-user persistence

Group-by selection saved per-user в localStorage:
```typescript
useEffect(() => {
  localStorage.setItem(`gantt-groupby-${projectId}`, groupBy);
}, [projectId, groupBy]);

const [groupBy, setGroupBy] = useState(() =>
  localStorage.getItem(`gantt-groupby-${projectId}`) ?? 'project'
);
```

Также shareable через URL query param: `?groupBy=phase`.

## Combine с filters

Group-by works seamlessly с filters:

```
Group by: Phase, Filter: assignee=Sergey

Phase: Demo
  (только Sergey's demo tasks)

Phase: Rough
  (только Sergey's rough tasks)
```

## Empty groups

Если group has 0 tasks (после filter) — collapse или скрыть:
```
Phase: Demo (0 tasks) ← collapsed by default
Phase: Rough (3 tasks)
  ...
```

## Group row interactions

- **Click on group title:** collapse/expand
- **Right-click:** context menu (e.g. «Hide all in this group», «Sum stats»)
- **Drag bar between groups:** updates corresponding field (e.g. drag from one crew row to another → reassign)

## Acceptance

См.: [`acceptance-criteria.md`](acceptance-criteria.md):
- ✓ Group-by dropdown с 6 опциями работает; switching без reload

---

**См. также:**
- [Plan vs actual](plan-vs-actual.md)
- [Critical path](critical-path.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #2 — anti-pattern «swimlane as view»
- [`../../06-ui-ux/views.md`](../../06-ui-ux/views.md) — Timeline view
