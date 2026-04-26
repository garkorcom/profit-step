---
title: "08.gantt.8 Acceptance criteria (Phase 3)"
section: "08-modules/construction-gantt"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Acceptance criteria — Construction Gantt (Phase 3)

> Конкретные условия для приёмки construction Gantt модуля. Phase 3 = post-MVP.

ТЗ §15.8.

## Чек-лист

- [ ] **Plan vs Actual overlay** рендерится для всех started/completed tasks
- [ ] **Toggle Critical Path** работает (CPM пересчёт < 200ms для 100 задач)
- [ ] **Group-by dropdown** с 6 опциями работает; switching без reload
- [ ] **Milestone diamonds** для inspection/permit
- [ ] **Weather marker ☂** показывается при forecast > 50% rain (mock в dev — реальный NOAA в prod)
- [ ] **Punch list compact row** внизу проекта
- [ ] **Daily Log dot** click open work_sessions modal

## Test cases

### Plan vs Actual rendering

```typescript
test('plan vs actual overlay shown for started task', async () => {
  const task = await createTask({
    plannedStartAt: addDays(today, -5),
    plannedEndAt: today,
    actualStartAt: addDays(today, -3),
    lifecycle: 'started'
  });

  render(<TaskTimeline tasks={[task]} />);

  expect(screen.getByTestId('gantt-plan-bar')).toBeInTheDocument();
  expect(screen.getByTestId('gantt-actual-bar')).toBeInTheDocument();
});
```

### Critical Path performance

```typescript
test('CPM recompute < 200ms for 100 tasks', async () => {
  const tasks = await create100TasksProject();
  const start = performance.now();
  await api.recomputeCriticalPath(tasks[0].projectId);
  expect(performance.now() - start).toBeLessThan(200);
});

test('CPM recompute < 2s for 1000 tasks', async () => {
  const tasks = await create1000TasksProject();
  const start = performance.now();
  await api.recomputeCriticalPath(tasks[0].projectId);
  expect(performance.now() - start).toBeLessThan(2000);
});

test('toggle critical path highlights bars', async () => {
  const tasks = await createSimpleProject();
  await api.recomputeCriticalPath(projectId);

  const { user } = render(<TaskTimeline tasks={tasks} />);
  await user.click(screen.getByRole('button', { name: /critical path/i }));

  const criticalBars = screen.getAllByTestId(/gantt-bar-critical/);
  expect(criticalBars.length).toBeGreaterThan(0);
});
```

### Group-by switching

```typescript
test('group-by dropdown switches without reload', async () => {
  const tasks = await createMixedTasks(5);
  const { user } = render(<TaskTimeline tasks={tasks} />);

  // Default: project
  expect(screen.getByText(/Project:/)).toBeInTheDocument();

  // Switch to phase
  await user.click(screen.getByLabelText(/Group by/i));
  await user.click(screen.getByText('Phase'));

  expect(screen.getByText(/Phase: demo/i)).toBeInTheDocument();
  expect(screen.queryByText(/Project:/)).not.toBeInTheDocument();
});
```

### Milestone diamonds

```typescript
test('inspection task rendered as diamond', async () => {
  const task = await createTask({
    title: 'Plumbing inspection',
    category: 'inspection',
    dueAt: today
  });

  render(<TaskTimeline tasks={[task]} />);

  expect(screen.getByTestId('gantt-milestone-diamond')).toBeInTheDocument();
  expect(screen.queryByTestId('gantt-bar')).not.toBeInTheDocument();
});
```

### Weather marker

```typescript
test('weather marker shown when forecast > 50% rain', async () => {
  const task = await createTask({
    plannedStartAt: today,
    location: { lat: 27.95, lng: -82.46 },  // Tampa
    category: 'work',
    phase: 'rough'
  });

  // Mock weather: 70% rain
  jest.spyOn(weatherService, 'getForecast').mockResolvedValue({
    rainProbability: 70,
    summary: 'Thunderstorms'
  });

  await runWeatherCheckCron();

  render(<TaskTimeline tasks={[task]} />);
  expect(screen.getByText(/☂/)).toBeInTheDocument();
});

test('weather warning modal allows shift +1 day', async () => {
  const task = await createTaskWithWeatherWarning();

  const { user } = render(<TaskTimeline tasks={[task]} />);
  await user.click(screen.getByText(/☂/));

  const modal = screen.getByRole('dialog');
  await user.click(within(modal).getByRole('button', { name: /shift \+1 day/i }));

  const updated = await getTask(task.id);
  expect(updated.plannedStartAt).toBe(addDays(task.plannedStartAt, 1));
});
```

### Punch list

```typescript
test('punch tasks shown in compact row at bottom', async () => {
  const project = await createProject();
  const regular = await createTask({ projectId: project.id, category: 'work' });
  const punch1 = await createTask({ projectId: project.id, category: 'punch', phase: 'closeout' });
  const punch2 = await createTask({ projectId: project.id, category: 'punch', phase: 'closeout' });

  render(<TaskTimeline projectId={project.id} />);

  const punchRow = screen.getByTestId('punch-list-row');
  expect(within(punchRow).getAllByTestId(/gantt-task-punch/)).toHaveLength(2);
  expect(punchRow).toHaveClass('compact');
});

test('hide punch toggle removes punch tasks from view', async () => {
  // ... setup with punch tasks
  const { user } = render(<TaskTimeline />);
  await user.click(screen.getByLabelText(/hide punch/i));
  expect(screen.queryByTestId(/gantt-task-punch/)).not.toBeInTheDocument();
});
```

### Daily Log

```typescript
test('daily log dot shown for day with work_session', async () => {
  const task = await createTask();
  await createWorkSession({ relatedTaskId: task.id, completedAt: today });

  // Wait for trigger to update task.workSessionDays
  await waitForFirestore(2000);

  render(<TaskTimeline tasks={[task]} />);
  expect(screen.getByTestId(`session-dot-${formatDate(today)}`)).toBeInTheDocument();
});

test('click on session dot opens daily log modal', async () => {
  const task = await createTaskWithSession();
  const { user } = render(<TaskTimeline tasks={[task]} />);

  await user.click(screen.getByTestId(/session-dot/));

  expect(screen.getByRole('dialog', { name: /daily log/i })).toBeInTheDocument();
  expect(screen.getByText(task.assignedTo.name)).toBeInTheDocument();
});
```

## Demo scenario для Дениса

1. Open Project «Bathroom remodel» в Timeline view
2. Видеть Plan vs Actual bars для tasks
3. Click [Critical path] toggle — видеть bold red outlines
4. Switch [Group by] dropdown to «Phase» — rows перегруппируются
5. Видеть Milestone diamonds для inspections
6. Видеть ☂ marker над днём дождя — click → modal «Shift +1 day?»
7. Click [Hide punch] — punch list исчезает
8. Click on ● session dot — modal с photos + notes
9. Export PDF Gantt → file download

## Performance benchmarks

| Operation | Target |
|---|---|
| Render 100 tasks Gantt | < 500ms |
| Render 1000 tasks Gantt (virtualized) | < 1s |
| CPM recompute 100 tasks | < 200ms |
| CPM recompute 1000 tasks | < 2s |
| Switch group-by | < 100ms (in-memory regroup) |
| Open daily log modal | < 200ms |
| Weather check API call | < 2s (NOAA latency) |

---

**См. также:**
- [Plan vs actual](plan-vs-actual.md)
- [Critical path](critical-path.md)
- [Group by](group-by.md)
- [Milestones](milestones.md)
- [Weather day](weather-day.md)
- [Punch list](punch-list.md)
- [Daily log](daily-log.md)
- [`../../11-success-metrics.md`](../../11-success-metrics.md)
