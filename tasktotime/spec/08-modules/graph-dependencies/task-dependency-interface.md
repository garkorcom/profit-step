---
title: "08.graph.2 TaskDependency interface (4 типа FS/SS/FF/SF)"
section: "08-modules/graph-dependencies"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# TaskDependency interface — полная модель

> Полная модель `TaskDependency` с 4 типами зависимостей по PMI / Procore / MS Project стандарту: FS / SS / FF / SF. Plus поле lag (позитив/негатив), isHardBlock (жёсткая vs soft), reason (human-readable).

ТЗ §12.2.

## Полный TypeScript

```typescript
interface TaskDependency {
  taskId: string;                                     // на кого ссылаемся
  type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
  lagMinutes?: number;                                // позитив = задержка после, негатив = можно начать раньше
  isHardBlock: boolean;                               // true → нельзя start пока predecessor не done; false → soft warning
  reason?: string;                                    // human-readable: «нужен permit перед demolition»
  createdAt: Timestamp;
  createdBy: UserRef;
}
```

## 4 типа (PMI / Procore / MS Project standard)

### Finish-to-Start (FS) — самый частый

«Закончил drywall → начал painting»

- Painting **start** триггерится при Drywall **finish**
- 80% всех зависимостей в строительстве — FS
- В UI default тип

```
[Drywall ████████]
                  └─FS─→ [Painting ████]
```

### Start-to-Start (SS) — параллельные работы

«Электрик начал → плотник начал»

- Carpenter **start** триггерится при Electrician **start**
- Используется для координации параллельных бригад
- Часто с `lagMinutes` для offset

```
[Electrician  ██████████]
[Carpenter    ██████████]
       SS
```

### Finish-to-Finish (FF) — синхронное окончание

«Inspection и cleanup кончаются вместе»

- Inspection **finish** триггерится при Cleanup **finish**
- Используется для closeout phase
- Реже чем FS/SS

```
[Inspection  ██████████]
[Cleanup     ████████  ]
                       FF
```

### Start-to-Finish (SF) — редкий, для shift-handoff

«Новая смена начала → старая закончила»

- Old shift **finish** триггерится при New shift **start**
- В construction почти не используется
- Скорее для 24/7 операций

## Поле `lagMinutes`

| Значение | Семантика |
|---|---|
| `null` или `0` | Нет offset, immediate transition |
| `> 0` (позитив) | Задержка после (B start = A end + lag) |
| `< 0` (негатив) | Можно начать раньше (overlap, e.g. B can start 30 min before A ends) |

**Пример с positive lag:**
- Concrete pour (A) → Concrete cure (FS, lag = 24 hours)
- B.start = A.end + 24h (бетон должен застыть)

**Пример с negative lag (overlap):**
- Drywall hang (A) → Drywall mud (FS, lag = -120 min)
- B можно начать за 2 часа до конца A (mud начинают пока ещё hanging)

## Поле `isHardBlock`

| Значение | Семантика |
|---|---|
| `true` (default) | Нельзя `start` B пока A не `completed`. API возвращает 400. |
| `false` | Soft warning — UI показывает «warning, predecessor not done» но позволяет start |

**Когда `false`:** оптимистичный schedule, гибкость. Например, «Wallpaper hang» зависит от «Wall paint dry» (FF), но если paint ещё не fully dry — можно начать аккуратно.

## Поле `reason`

Human-readable обоснование. Critical для team coordination:

```
{
  taskId: 'permit-task-id',
  type: 'finish_to_start',
  reason: 'Нужен building permit от city перед demolition',
  isHardBlock: true,
  lagMinutes: 0,
  ...
}
```

В UI показывается как hint при hover на edge в Mind Map view.

## Полное использование

```typescript
const drywallTask: Task = {
  id: 'drywall-id',
  title: 'Drywall hang',
  // ...
  dependsOn: [
    {
      taskId: 'plumbing-rough-id',
      type: 'finish_to_start',
      lagMinutes: 0,
      isHardBlock: true,
      reason: 'Plumbing rough must be inspected before walls go up',
      createdAt: Timestamp.now(),
      createdBy: { id: 'pm-1', name: 'Denis' }
    },
    {
      taskId: 'electrical-rough-id',
      type: 'finish_to_start',
      lagMinutes: 0,
      isHardBlock: true,
      reason: 'Electrical rough must be inspected before walls go up',
      createdAt: Timestamp.now(),
      createdBy: { id: 'pm-1', name: 'Denis' }
    }
  ]
};
```

## Reverse index `blocksTaskIds[]`

Computed на trigger:

```typescript
// На plumbing-rough-id task
{
  blocksTaskIds: ['drywall-id']  // computed reverse index
}
```

Используется для:
- DAG визуализации (рисуем стрелки от blocker'а)
- Cascade auto-shift (см. [`auto-shift-cascade.md`](auto-shift-cascade.md))
- UI «На эту задачу ссылаются 3 другие»

## Validation на API

```typescript
// POST /api/tasktotime/tasks/:id/dependencies
function validateDependency(taskId: string, dep: TaskDependency) {
  // Cycle check
  if (await wouldCreateCycle(taskId, dep.taskId)) {
    throw new HttpsError('failed-precondition', `Cycle detected: ${dep.taskId} → ... → ${taskId}`);
  }

  // Self-dependency
  if (taskId === dep.taskId) {
    throw new HttpsError('failed-precondition', 'Task cannot depend on itself');
  }

  // Type validation
  if (!['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'].includes(dep.type)) {
    throw new HttpsError('invalid-argument', `Invalid type: ${dep.type}`);
  }
}
```

См.: [`cycle-prevention.md`](cycle-prevention.md)

---

**См. также:**
- [Three link types](three-link-types.md) — обзор всех типов связей
- [Computed fields](computed-fields.md) — blocksTaskIds, isCriticalPath, slackMinutes
- [Auto-shift cascade](auto-shift-cascade.md)
- [Cycle prevention](cycle-prevention.md)
- [DAG visualization](dag-visualization.md)
- [`../../02-data-model/sub-types.md`](../../02-data-model/sub-types.md) — TaskDependency type
