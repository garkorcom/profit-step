---
title: "08.gantt.2 Critical Path & Dependencies (toggle, не default)"
section: "08-modules/construction-gantt"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Critical Path & Dependencies — toggle, не default

> CPM (Critical Path Method) выделяет цепочку задач которые блокируют общий срок проекта. **По умолчанию OFF** в Gantt (иначе шум). Toggle button «Critical path» в Gantt toolbar. Включён → critical tasks получают bold rose-500 outline.

ТЗ §15.2.

## Что такое CPM

**Critical Path Method** — алгоритм из project management. Находит:
- **Critical tasks** — те у которых `slackMinutes === 0`. Если они задержатся — задержится весь проект.
- **Critical path** — sequence критических задач от start до end проекта.

Computed по DAG зависимостей (см. [`../graph-dependencies/computed-fields.md`](../graph-dependencies/computed-fields.md)).

## Toggle UI

```
┌──────────────────────────────────────────────────┐
│  Gantt — Project: Renovation Jim Dvorkin         │
│                                                  │
│  Group by: [Phase ▼]  [Critical path] [Deps]    │  ← toolbar toggles
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  Apr 1  Apr 5  Apr 10  Apr 15  Apr 20    │    │
│  │  ────────────────────────────────────     │    │
│  │  Demo  ░░░░░░                            │    │  ← non-critical (subtle)
│  │  ▓▓▓▓▓▓▓▓                                │    │
│  │                                          │    │
│  │  Plumbing rough  ░░░░░░░░░░░             │    │  ← non-critical
│  │                  ▓▓▓▓▓▓▓▓▓▓▓             │    │
│  │                                          │    │
│  │  ╔══════════════════════════════════╗   │    │  ← critical task (bold red outline)
│  │  ║ Drywall hang  ░░░░░░░             ║  │    │
│  │  ║                ▓▓▓▓▓▓▓             ║  │    │
│  │  ╚══════════════════════════════════╝   │    │
│  │                                          │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

## Default OFF

**Почему по умолчанию OFF:**
- Bold red outline на 30% задач = visual noise
- Юзер не всегда хочет видеть critical path (PM в день — да, daily worker — нет)
- Toggle позволяет switch on demand

Storage в URL `?criticalPath=true` или localStorage per-user.

## Когда включён

```typescript
{showCriticalPath && (
  <PlanVsActualBar
    task={task}
    className={cn(
      task.isCriticalPath && 'border-2 border-rose-500',
      !task.isCriticalPath && showCriticalPath && 'opacity-50'  // dim non-critical
    )}
  />
)}
```

- **Critical tasks:** **bold rose-500 outline** на bar + dependencies между ними — **толстые красные стрелки**
- **Slack tasks** (`slackMinutes > 0`): **приглушены** (opacity 50%, gray text)

## Toggle «Dependencies» отдельно

Кнопка «Dependencies» отдельно — показать/скрыть стрелки между **всеми** задачами (не только critical):

```
Without [Dependencies] toggle:    With:
┌───────────┐                     ┌───────────┐ ──→ ┌───────────┐
│ Demo      │                     │ Demo      │     │ Plumbing  │
└───────────┘                     └───────────┘     └───────────┘
┌───────────┐                                                    │
│ Plumbing  │                                                    ▼
└───────────┘                                          ┌───────────┐
                                                       │ Drywall   │
                                                       └───────────┘
```

Default OFF (стрелки добавляют noise). Toggle ON для project planning.

## Critical path performance

Recompute trigger `recomputeCriticalPath`:
- Запускается через Pub/Sub когда `dependsOn`, `estimatedDurationMinutes`, `plannedStartAt` меняются на любой задаче проекта
- Debounced 5 sec (не чаще)
- **Target:** < 200ms для 100 задач, < 2s для 1000

См.: [`../graph-dependencies/computed-fields.md`](../graph-dependencies/computed-fields.md)

## Реактивность

Когда juzer меняет `estimatedDurationMinutes` для одной задачи через UI:
1. Optimistic update — UI immediately обновляется
2. PATCH to server
3. Trigger `recomputeCriticalPath` runs in background (~200ms)
4. Subscription updates — `isCriticalPath` обновляется на affected tasks
5. UI re-renders — visual changes (some tasks become critical, others lose it)

## CPM algorithm в production

Находится в `tasktotime/backend/services/CriticalPathService.ts`:

```typescript
export class CriticalPathService {
  async recompute(projectId: string): Promise<void> {
    const tasks = await this.taskRepo.getProjectTasks(projectId);
    const sorted = topoSort(tasks);

    // Forward pass
    for (const task of sorted) {
      task.earliestStart = this.computeEarliestStart(task, tasks);
      task.earliestEnd = task.earliestStart + task.estimatedDurationMinutes;
    }

    // Backward pass
    const projectEnd = Math.max(...sorted.map(t => t.earliestEnd));
    for (const task of sorted.reverse()) {
      task.latestEnd = this.computeLatestEnd(task, tasks, projectEnd);
      task.latestStart = task.latestEnd - task.estimatedDurationMinutes;
    }

    // Slack and critical
    const updates = sorted.map(task => ({
      id: task.id,
      slackMinutes: task.latestStart - task.earliestStart,
      isCriticalPath: (task.latestStart - task.earliestStart) === 0
    }));

    await this.taskRepo.batchUpdate(updates);
  }
}
```

## Visual export

При export PNG / PDF:
- Сохраняется текущее состояние toggles
- Если critical path ON — он включается в export (для презентации клиенту)

## Acceptance

См.: [`acceptance-criteria.md`](acceptance-criteria.md):
- ✓ Toggle Critical Path работает (CPM пересчёт < 200ms для 100 задач)

---

**См. также:**
- [Plan vs actual](plan-vs-actual.md)
- [Group by](group-by.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../graph-dependencies/computed-fields.md`](../graph-dependencies/computed-fields.md) — CPM algorithm details
- [`../../05-api/triggers.md`](../../05-api/triggers.md) — recomputeCriticalPath trigger
