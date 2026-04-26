---
title: "08.wiki-rollup.5 Acceptance criteria (Phase 3)"
section: "08-modules/wiki-rollup"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Acceptance criteria — Wiki Rollup (Phase 3)

> Конкретные условия для приёмки wiki rollup модуля. Phase 3 = post-MVP.

ТЗ §14.5.

## Чек-лист

- [ ] **Toggle «Aggregated» в wiki-tab** показывает rolled-up content **< 1s** для 20 subtasks
- [ ] **Экспорт в PDF работает** (на проде через PuppeteerSharp или Cloud Function с puppeteer)
- [ ] **Кнопка «Прикрепить к акту»** создаёт PDF + ссылку в `acceptance.url`
- [ ] **Кнопка «Сохранить как template»** создаёт `wikiTemplates/{id}` с placeholders для переменных
- [ ] **Edge cases:** cancelled subtasks показаны но видно что отменены; subtasks без wiki — только title

## Test cases

### Performance

```typescript
// tasktotime/tests/integration/wikiRollupPerf.test.ts

test('rollup builds < 1s for 20 subtasks', async () => {
  const parent = await createParentWith20Subtasks();
  const start = performance.now();
  const rollup = await api.getRolledUpWiki(parent.id);
  const elapsed = performance.now() - start;

  expect(rollup.length).toBeGreaterThan(1000);
  expect(elapsed).toBeLessThan(1000);
});

test('rollup builds < 5s for 100 subtasks', async () => {
  const parent = await createParentWith100Subtasks();
  const start = performance.now();
  const rollup = await api.getRolledUpWiki(parent.id);
  expect(performance.now() - start).toBeLessThan(5000);
});
```

### Toggle UI

```typescript
test('toggle shows aggregated wiki', async () => {
  const parent = await createParentWith5Subtasks();
  render(<WikiTab taskId={parent.id} />);

  // Default: only parent wiki
  expect(screen.getByText(parent.wiki.contentMd.slice(0, 50))).toBeInTheDocument();
  expect(screen.queryByText(/## Подзадачи/)).not.toBeInTheDocument();

  // Toggle
  await user.click(screen.getByRole('switch', { name: /with subtasks/i }));

  // Aggregated view
  await waitFor(() => screen.getByText(/## Подзадачи/));
  expect(screen.getByText(/## Итого/)).toBeInTheDocument();
});
```

### PDF export

```typescript
test('PDF export creates file in storage', async () => {
  const parent = await createParentWith5Subtasks();
  const result = await api.exportRollupPdf(parent.id);

  expect(result.url).toMatch(/^gs:\/\//);
  expect(result.sizeBytes).toBeGreaterThan(0);
});
```

### Attach to acceptance

```typescript
test('attach to acceptance updates acceptance.notes and url', async () => {
  const parent = await createParentWith5Subtasks();
  await transitionTask(parent.id, {
    action: 'accept',
    acceptance: {
      url: 'gs://placeholder',
      signedAt: Timestamp.now(),
      signedBy: 'jim-id',
      signedByName: 'Jim Dvorkin',
    }
  });

  await api.attachRollupToAcceptance(parent.id);

  const updated = await api.getTask(parent.id);
  expect(updated.acceptance!.notes).toContain('## Подзадачи');
  expect(updated.acceptance!.url).not.toBe('gs://placeholder');  // replaced
});
```

### Save as template

```typescript
test('save as template creates wikiTemplate with placeholders', async () => {
  const parent = await createParentWithRolledUpWiki();

  const template = await api.saveRollupAsTemplate(parent.id, {
    name: 'My Bathroom Template',
    category: 'remodel',
    autoDetectVariables: true,
  });

  expect(template.id).toBeTruthy();
  expect(template.contentMd).toContain('{{clientName}}');
  expect(template.variables).toContain('clientName');
});
```

### Edge: cancelled subtask

```typescript
test('cancelled subtask shown with strikethrough', async () => {
  const parent = await createTask({ title: 'Parent' });
  const sub1 = await createTask({ parentTaskId: parent.id, title: 'Sub 1' });
  const sub2 = await createTask({ parentTaskId: parent.id, title: 'Sub 2' });

  await transitionTask(sub2.id, { action: 'cancel', reason: 'Client changed mind' });

  const rollup = await api.getRolledUpWiki(parent.id);

  expect(rollup).toMatch(/### 1\. Sub 1/);
  expect(rollup).toMatch(/~~### 2\. Sub 2~~/);
  expect(rollup).toMatch(/Subtask cancelled/);
});
```

### Edge: subtask без wiki

```typescript
test('subtask without wiki shown with only title + stats', async () => {
  const parent = await createTask({ title: 'Parent' });
  const sub = await createTask({
    parentTaskId: parent.id,
    title: 'Sub no wiki',
    actualDurationMinutes: 240,
    costInternal: { amount: 200, currency: 'USD' },
    // wiki: undefined
  });

  const rollup = await api.getRolledUpWiki(parent.id);

  expect(rollup).toMatch(/### 1\. Sub no wiki/);
  expect(rollup).toMatch(/Hours: 4h/);
  expect(rollup).toMatch(/Cost: \$200/);
  // No wiki content section
});
```

### Edge: inherited wiki

```typescript
test('subtask with inherited wiki shows only own content', async () => {
  const parent = await createTaskWithWiki('# Parent context');
  const sub = await createTaskWithWiki('## My subtask notes', {
    parentTaskId: parent.id,
    wikiInheritsFromParent: true,
  });

  const rollup = await api.getRolledUpWiki(parent.id);

  // Parent context appears once (in parent section), not in subtask section
  const parentMatches = rollup.match(/# Parent context/g);
  expect(parentMatches).toHaveLength(1);
  expect(rollup).toContain('## My subtask notes');
});
```

## Demo scenario для Дениса

1. Создать parent «Bathroom remodel» с 5 subtasks, у каждой wiki
2. Open Detail page → Tab «Wiki»
3. Default view: только parent wiki
4. Click toggle [Show with subtasks (5)]
5. Видеть aggregated view: header → parent context → 5 subtasks → Итого
6. Click [Markdown] → download `.md` file
7. Click [PDF] → download PDF (open в Preview / browser)
8. Click [Save as template] → modal → save → видеть в template library
9. Sign acceptance act для parent
10. Click [Attach to acceptance act] → acceptance.notes updated, acceptance.url updated
11. Cancel one subtask → re-build rollup → видеть strikethrough
12. Удалить wiki у одной subtask → re-build → видеть «(no wiki content)»

## Performance benchmarks

| Operation | Target |
|---|---|
| Build rollup для 5 subtasks | < 200ms |
| Build rollup для 20 subtasks | < 1s |
| Build rollup для 100 subtasks | < 5s |
| Export PDF (20 subtasks, no photos) | < 3s |
| Export PDF (20 subtasks, 50 photos) | < 10s |
| Export Markdown (20 subtasks) | < 500ms |
| Save as template | < 200ms |

---

**См. также:**
- [Concept](concept.md)
- [Algorithm](algorithm.md)
- [UI](ui.md)
- [Edge cases](edge-cases.md)
- [`../wiki/acceptance-criteria.md`](../wiki/acceptance-criteria.md) — separate criteria для core wiki
- [`../../11-success-metrics.md`](../../11-success-metrics.md)
