---
title: "08.graph.7 Acceptance criteria (Phase 3)"
section: "08-modules/graph-dependencies"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Acceptance criteria — Graph & Dependencies (Phase 3)

> Конкретные условия для приёмки модуля dependencies + DAG. Phase 3 = post-MVP, ставится в production после прохождения этих критериев.

ТЗ §12.7.

## Чек-лист

- [ ] **Создание зависимости через UI:** drag from one task card to another (`@xyflow/react` Connection mode)
- [ ] **Cycle detection** blocks invalid links с toast «нельзя создать циклическую зависимость»
- [ ] **DAG view рендерит** 200 узлов < 200ms, 1000 узлов < 2s
- [ ] **Critical path подсвечивается реактивно** при изменении task duration
- [ ] **Auto-shift cascade тестируется** на цепочке 5 задач: A blocks B blocks C... A.duration += 1d → B,C,D,E.plannedStart += 1d (in transaction)

## Test cases

### Performance

```typescript
// tasktotime/tests/integration/dagPerf.test.ts

test('DAG renders 200 nodes < 200ms', async () => {
  const project = await createMockProjectWith200Tasks();
  const start = performance.now();
  render(<TaskGraphView projectId={project.id} />);
  await waitFor(() => screen.getByText('Demo bathroom'));
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(200);
});

test('DAG renders 1000 nodes < 2s', async () => {
  const project = await createMockProjectWith1000Tasks();
  const start = performance.now();
  render(<TaskGraphView projectId={project.id} />);
  await waitFor(() => screen.getByTestId('react-flow-rendered'));
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(2000);
});
```

### Cycle detection

```typescript
test('cycle detection blocks A → B → C → A', async () => {
  const A = await createTask({ title: 'A' });
  const B = await createTask({ title: 'B' });
  const C = await createTask({ title: 'C' });

  await addDependency(A.id, B.id, 'finish_to_start');  // A depends on B
  await addDependency(B.id, C.id, 'finish_to_start');  // B depends on C

  await expect(
    addDependency(C.id, A.id, 'finish_to_start')      // C depends on A — cycle!
  ).rejects.toThrow('Cycle detected');
});
```

### Critical path reactivity

```typescript
test('critical path updates when task duration changes', async () => {
  const project = await createSimpleProject();  // A → B → C → D, all 60 min, A on critical
  expect(await getTask(A.id).then(t => t.isCriticalPath)).toBe(true);

  // Add new task E parallel that's longer
  const E = await createTask({ estimatedDurationMinutes: 120 });
  await addDependency(D.id, E.id, 'finish_to_finish');

  // Wait for recomputeCriticalPath trigger
  await waitForFirestore(2000);

  // Now E is on critical path, A might still be
  expect(await getTask(E.id).then(t => t.isCriticalPath)).toBe(true);
});
```

### Auto-shift cascade

```typescript
test('cascade auto-shift: A → B → C → D → E with A.actualEnd shift', async () => {
  // Build chain
  const A = await createTask({ plannedEndAt: day1, autoShiftEnabled: true });
  const B = await createTask({ plannedStartAt: day2, autoShiftEnabled: true });
  await addDependency(B.id, A.id, 'finish_to_start');
  // ... C, D, E similarly

  // Trigger: A.actualEndAt = day1 + 1d
  await transitionTask(A.id, { action: 'complete' });
  await db.collection('tasktotime_tasks').doc(A.id).update({
    actualEndAt: addDays(day1, 1)
  });

  // Wait for cascade
  await waitForFirestore(3000);

  // All dependent tasks shifted by 1d
  expect(await getTask(B.id).then(t => t.plannedStartAt)).toBe(addDays(day2, 1));
  expect(await getTask(C.id).then(t => t.plannedStartAt)).toBe(addDays(day3, 1));
  expect(await getTask(D.id).then(t => t.plannedStartAt)).toBe(addDays(day4, 1));
  expect(await getTask(E.id).then(t => t.plannedStartAt)).toBe(addDays(day5, 1));
});
```

### Single graph viz lib

```bash
# Verify only one graph lib in package.json
grep -E "(cytoscape|gojs|d3-tree|@xyflow/react)" package.json
# Should show only @xyflow/react and dagre
```

## Demo scenario для Дениса

1. Создать 5 tasks: A, B, C, D, E в проекте
2. В Mind Map view — drag from A's output handle to B's input → create FS dependency
3. Видеть стрелку A → B
4. Continue: A → B → C → D → E
5. Toggle «Critical path» — все 5 highlighted bold red
6. Set A.actualEndAt = +1 day → wait → видеть в timeline что B, C, D, E все сдвинулись
7. Try to create C → A dependency → toast «Cycle detected: C → A → B → C»
8. Filter view by phase — visible узлы уменьшаются
9. Export PNG — file downloaded

## Performance benchmarks

| Operation | Target | Measure |
|---|---|---|
| Render 100 nodes | < 100ms | `performance.now()` before/after |
| Render 200 nodes | < 200ms | same |
| Render 1000 nodes | < 2s | same |
| Add dependency (UI) | < 50ms response | server roundtrip |
| Cycle detection BFS | < 10ms for 100-node graph | unit test |
| CPM recompute | < 200ms for 100 tasks | integration test |
| CPM recompute | < 2s for 1000 tasks | integration test |
| Auto-shift cascade 3 levels | < 1s | integration test |

## Related acceptance

- [`../hierarchy/acceptance-criteria.md`](../hierarchy/acceptance-criteria.md) — иерархия
- [`../wiki/acceptance-criteria.md`](../wiki/acceptance-criteria.md) — wiki
- [`../../11-success-metrics.md`](../../11-success-metrics.md) — общие метрики

---

**См. также:**
- [Three link types](three-link-types.md)
- [Task dependency interface](task-dependency-interface.md)
- [Computed fields](computed-fields.md)
- [Auto-shift cascade](auto-shift-cascade.md)
- [Cycle prevention](cycle-prevention.md)
- [DAG visualization](dag-visualization.md)
- [`../../11-success-metrics.md`](../../11-success-metrics.md)
