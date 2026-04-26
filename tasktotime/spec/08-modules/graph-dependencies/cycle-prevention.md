---
title: "08.graph.5 Cycle prevention"
section: "08-modules/graph-dependencies"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Cycle prevention (BFS алгоритм)

> API endpoint `POST /api/tasktotime/tasks/:id/dependencies` перед записью валидирует через `DependencyService.canAddDependency(fromId, toId)`. Алгоритм: BFS от toId через `blocksTaskIds`. Если встретили fromId — cycle, возвращаем 400. То же для иерархии.

ТЗ §12.5.

## Зачем

Без cycle prevention:
- A.dependsOn = B
- B.dependsOn = A
- → infinite loop в auto-shift cascade
- → CPM никогда не сходится
- → DAG визуализация некрасивая

## Алгоритм (BFS)

```typescript
async function canAddDependency(fromTaskId: string, toTaskId: string): Promise<{ ok: boolean, cyclePath?: string[] }> {
  // From → depends on → To. To eventually leads back to From?
  // BFS from To through blocksTaskIds (forward direction in graph).

  const visited = new Set<string>();
  const queue: Array<{ id: string, path: string[] }> = [{ id: toTaskId, path: [toTaskId] }];

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;

    if (id === fromTaskId) {
      return { ok: false, cyclePath: [...path, fromTaskId] };
    }

    if (visited.has(id)) continue;
    visited.add(id);

    const task = await getTask(id);
    const blocks = task.blocksTaskIds ?? [];

    for (const blockedId of blocks) {
      queue.push({ id: blockedId, path: [...path, blockedId] });
    }
  }

  return { ok: true };
}
```

**Time complexity:** O(V + E) где V = tasks, E = dependencies. Для большинства проектов V < 100, E < 200 → fast (<10ms).

## Использование в API

```typescript
// POST /api/tasktotime/tasks/:id/dependencies
router.post('/:id/dependencies', async (req, res) => {
  const { taskId, type, lagMinutes, isHardBlock, reason } = req.body;
  const fromId = req.params.id;

  // Cycle check
  const check = await canAddDependency(fromId, taskId);
  if (!check.ok) {
    return res.status(400).json({
      error: {
        code: 'cycle_detected',
        message: `Cycle detected: ${check.cyclePath!.join(' → ')}`,
        details: { cyclePath: check.cyclePath }
      }
    });
  }

  // Self-dep check
  if (fromId === taskId) {
    return res.status(400).json({
      error: { code: 'self_dependency', message: 'Task cannot depend on itself' }
    });
  }

  // Add dependency
  await db.collection('tasktotime_tasks').doc(fromId).update({
    dependsOn: admin.firestore.FieldValue.arrayUnion({
      taskId,
      type,
      lagMinutes,
      isHardBlock,
      reason,
      createdAt: Timestamp.now(),
      createdBy: { id: req.auth.uid, name: req.auth.name }
    })
  });

  res.status(200).json({ ok: true });
});
```

## То же для иерархии

`parentTaskId` в свою subtask = cycle:

```typescript
async function canSetParent(taskId: string, newParentId: string): Promise<{ ok: boolean }> {
  if (taskId === newParentId) return { ok: false };

  // newParent shouldn't be a descendant of taskId
  const newParent = await getTask(newParentId);
  if (newParent.parentTaskId === taskId) return { ok: false };

  // (С 2-level limit это всё что нужно проверить)
  return { ok: true };
}
```

См. также: [`../hierarchy/tree-dnd.md`](../hierarchy/tree-dnd.md)

## Edge cases

### Empty graph

`blocksTaskIds` undefined или пустой — никакого cycle быть не может, возвращаем `ok: true`.

### Self-dependency

Очевидный cycle размером 1. Отдельная проверка `fromId === toId`.

### Already exists same dependency

Не cycle, но дубль. API возвращает 200 idempotent (existing dep сохраняется), не создавая duplicate в array.

### Stale `blocksTaskIds`

Если trigger опаздывает обновлять `blocksTaskIds[]` — может cycle быть пропущен. **Защита:**
- Run cycle check в transaction которая reads fresh data
- Или fallback на `dependsOn[]` traversal (более expensive but accurate)

```typescript
async function getOutgoingEdges(taskId: string): Promise<string[]> {
  // Prefer reverse index, but fall back to query
  const task = await getTask(taskId);
  if (task.blocksTaskIds) return task.blocksTaskIds;

  // Fallback: query
  const blocked = await db.collection('tasktotime_tasks')
    .where('dependsOn', 'array-contains-any', [{ taskId, ... }])  // sketchy, depends on Firestore support
    .get();
  return blocked.docs.map(d => d.id);
}
```

В практике — index обновляется через trigger immediately, fallback нужен только в edge case race.

## UI feedback

При попытке создать cycle:

```
┌──────────────────────────────────────────────┐
│ Cannot add dependency:                       │
│ Cycle detected: A → B → C → A                │
│                                  [Got it]    │
└──────────────────────────────────────────────┘
```

В Mind Map editor — visual feedback при drag:
- Hover over valid drop target — green outline
- Hover over cycle-creating target — red outline + tooltip

## Тестирование

```typescript
test('detects 3-cycle: A → B → C → A', async () => {
  const A = await createTask();
  const B = await createTask();
  const C = await createTask();

  await addDependency(A.id, B.id, 'FS');  // A depends on B
  await addDependency(B.id, C.id, 'FS');  // B depends on C

  await expect(addDependency(C.id, A.id, 'FS'))  // C depends on A — cycle!
    .rejects.toThrow('Cycle detected: C → A → B → C');
});
```

---

**См. также:**
- [Three link types](three-link-types.md)
- [Task dependency interface](task-dependency-interface.md)
- [Computed fields](computed-fields.md) — blocksTaskIds used in BFS
- [Auto-shift cascade](auto-shift-cascade.md) — почему важно избежать cycles
- [DAG visualization](dag-visualization.md) — UI feedback при drag
- [`../hierarchy/tree-dnd.md`](../hierarchy/tree-dnd.md) — то же для иерархии
- [`../../05-api/rest-endpoints.md`](../../05-api/rest-endpoints.md) — POST .../dependencies endpoint
