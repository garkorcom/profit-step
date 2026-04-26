---
title: "08.hierarchy.6 Acceptance criteria (Phase 3)"
section: "08-modules/hierarchy"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Acceptance criteria — Hierarchy (Phase 3)

> Конкретные условия, которые должны выполняться для приёмки иерархического модуля. Phase 3 = post-MVP, ставится в production после прохождения этих критериев.

ТЗ §11.6.

## Чек-лист

- [ ] **Создание subtask из parent** — кнопка «+ Добавить подзадачу» в детали parent
- [ ] **Tree view рендерит до 1000 узлов без лагов** (virtualization через MUI X)
- [ ] **Rollup пересчитывается атомарно** (transaction) при изменении subtask
- [ ] **Нельзя создать subtask у subtask** (валидация на API + UI)
- [ ] **Отображение прогресса parent** на основе rollup (3 из 5 subtasks accepted = 60% bar)

## Дополнительные criteria (из других секций)

- [ ] **Tree DnD** работает (см. [`tree-dnd.md`](tree-dnd.md))
- [ ] **Cycle prevention** срабатывает с toast «нельзя создать циклическую зависимость»
- [ ] **Auto-rollup banner** показывается когда все subtasks accepted (см. [`auto-rollup.md`](auto-rollup.md))
- [ ] **Wiki inheritance** работает для subtasks (см. [`../wiki/inheritance.md`](../wiki/inheritance.md))

## Test cases

### Performance

```typescript
// tasktotime/tests/integration/treeViewPerf.test.ts

test('tree view renders 1000 nodes < 200ms', async () => {
  const project = await createMockProjectWith1000Tasks();
  const start = performance.now();
  render(<ProjectTreePage projectId={project.id} />);
  await waitFor(() => screen.getByText('Demo bathroom'));
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(200);
});
```

### Atomic rollup

```typescript
test('subtaskRollup is atomically updated on subtask lifecycle change', async () => {
  const parent = await createTask({ title: 'Parent' });
  const sub1 = await createTask({ title: 'Sub 1', parentTaskId: parent.id });
  const sub2 = await createTask({ title: 'Sub 2', parentTaskId: parent.id });

  await transitionTask(sub1.id, { action: 'complete' });

  const updated = await getTask(parent.id);
  expect(updated.subtaskRollup.countByLifecycle.completed).toBe(1);
  expect(updated.subtaskRollup.completedFraction).toBe(0.5);
});
```

### Validation

```typescript
test('cannot create subtask under a subtask (2-level limit)', async () => {
  const root = await createTask({ title: 'Root' });
  const sub = await createTask({ title: 'Sub', parentTaskId: root.id });

  await expect(
    createTask({ title: 'Sub-sub', parentTaskId: sub.id })
  ).rejects.toThrow('Cannot create subtask under a subtask');
});
```

### Cycle prevention

```typescript
test('cannot move root task under its own subtask', async () => {
  const root = await createTask({ title: 'Root' });
  const sub = await createTask({ title: 'Sub', parentTaskId: root.id });

  await expect(
    patchTask(root.id, { parentTaskId: sub.id })
  ).rejects.toThrow('Cycle detected');
});
```

### Progress bar UI

```typescript
test('parent card shows progress bar based on rollup', async () => {
  const parent = await createTaskWithSubtasksRollup(0.6);  // 60%
  render(<TaskCard task={parent} variant="compact-with-progress" />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
  expect(screen.getByText(/60%/)).toBeInTheDocument();
});
```

## Demo scenario для Дениса

1. Создать root task «Bathroom remodel»
2. Кликнуть «+ Добавить подзадачу» 5 раз — создать 5 subtasks
3. Видеть в Detail page sidebar tree
4. Перетащить subtask из «Bathroom» в новый root «Kitchen» — обе trees update'ются
5. Попробовать создать subtask у subtask — получить toast error
6. Закрыть все 5 subtasks → видеть banner «All 5 accepted, sign parent acceptance?»
7. Подписать acceptance — parent → accepted
8. Открыть Project page — видеть progress bar 100% на parent card

## Дефиниция «без лагов»

- **Initial render:** < 200ms для 1000 nodes
- **Expand/collapse node:** < 16ms (60fps)
- **Drag operation:** smooth, без stutter
- **Search filter:** < 100ms reaction time

## Related acceptance

См. также acceptance criteria других модулей:
- [`../graph-dependencies/acceptance-criteria.md`](../graph-dependencies/acceptance-criteria.md) — DAG dependencies
- [`../wiki/acceptance-criteria.md`](../wiki/acceptance-criteria.md) — wiki
- [`../../11-success-metrics.md`](../../11-success-metrics.md) — общие метрики успеха

---

**См. также:**
- [Model](model.md)
- [Auto-rollup](auto-rollup.md)
- [Subtask rollup aggregate](subtask-rollup-aggregate.md)
- [Tree view UI](tree-view-ui.md)
- [Tree DnD](tree-dnd.md)
- [`../../11-success-metrics.md`](../../11-success-metrics.md)
