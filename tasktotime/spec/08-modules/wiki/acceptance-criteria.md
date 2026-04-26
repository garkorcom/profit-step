---
title: "08.wiki.7 Acceptance criteria (Phase 3)"
section: "08-modules/wiki"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Acceptance criteria — Wiki (Phase 3)

> Конкретные условия для приёмки wiki модуля. Phase 3 = post-MVP.

ТЗ §13.7.

## Чек-лист

- [ ] **Markdown editor загружается** < 200ms
- [ ] **Auto-save** через 2s после keystroke
- [ ] **Conflict resolution UI** при параллельной правке двумя юзерами
- [ ] **Photo upload drag-drop** в editor → загружается в `files/` + ссылка в markdown
- [ ] **Slash-commands** работают (минимум `/photo`, `/checklist`, `/link-task`)
- [ ] **Versioning:** можно посмотреть историю и откатить
- [ ] **Templates:** при создании task можно выбрать template из библиотеки

## Test cases

### Editor performance

```typescript
test('wiki editor loads < 200ms', async () => {
  const task = await createTaskWithWiki('# Heading\n\nLong content...');
  const start = performance.now();
  render(<WikiEditor taskId={task.id} />);
  await waitFor(() => screen.getByRole('textbox'));
  expect(performance.now() - start).toBeLessThan(200);
});
```

### Auto-save

```typescript
test('auto-save triggers 2s after keystroke', async () => {
  const task = await createTask();
  const { user } = render(<WikiEditor taskId={task.id} />);

  await user.type(screen.getByRole('textbox'), 'Hello');

  // Within 2s — no save
  await wait(1500);
  expect(api.patchTask).not.toHaveBeenCalled();

  // After 2s — save
  await wait(600);
  expect(api.patchTask).toHaveBeenCalledWith(task.id, expect.objectContaining({
    wiki: expect.objectContaining({ contentMd: expect.stringContaining('Hello') })
  }));
});
```

### Conflict resolution

```typescript
test('shows conflict UI when version mismatches', async () => {
  const task = await createTaskWithWiki('Initial', 1);

  // User A edits in browser tab 1
  const tabA = render(<WikiEditor taskId={task.id} />);

  // User B edits in browser tab 2 (or another user)
  await api.patchTask(task.id, {
    wiki: { contentMd: 'B changed', version: 1 }
  });
  // Now stored version is 2

  // User A tries to save (still has version 1)
  await user.type(tabA.getByRole('textbox'), 'A changed');
  await wait(2500);

  // Conflict UI appears
  expect(screen.getByText(/Conflict/)).toBeInTheDocument();
  expect(screen.getByText(/B changed/)).toBeInTheDocument();
});
```

### Photo upload

```typescript
test('drag-drop photo uploads and inserts markdown reference', async () => {
  const task = await createTask();
  const { user } = render(<WikiEditor taskId={task.id} />);

  const file = new File(['photo data'], 'photo.jpg', { type: 'image/jpeg' });
  await user.upload(screen.getByTestId('editor-drop-zone'), file);

  await waitFor(() => {
    expect(screen.getByRole('textbox')).toHaveValue(
      expect.stringMatching(/!\[photo\.jpg\]\(attachment:\/\/[a-z0-9-]+\)/)
    );
  });

  const updated = await getTask(task.id);
  expect(updated.wiki?.attachments).toHaveLength(1);
  expect(updated.wiki?.attachments?.[0]?.url).toMatch(/^gs:\/\//);
});
```

### Slash commands

```typescript
test('/photo opens file picker', async () => {
  const task = await createTask();
  const { user } = render(<WikiEditor taskId={task.id} />);

  await user.type(screen.getByRole('textbox'), '/photo');
  expect(screen.getByLabelText(/Choose file/)).toBeInTheDocument();
});

test('/checklist inserts checklist markdown', async () => {
  const task = await createTask();
  const { user } = render(<WikiEditor taskId={task.id} />);

  await user.type(screen.getByRole('textbox'), '/checklist{enter}');
  expect(screen.getByRole('textbox')).toHaveValue(expect.stringContaining('- [ ] '));
});
```

### Version history & rollback

```typescript
test('can view version history and rollback', async () => {
  const task = await createTaskWithWiki('v1');
  await patchWiki(task.id, 'v2');
  await patchWiki(task.id, 'v3');

  render(<WikiEditor taskId={task.id} />);
  await user.click(screen.getByRole('button', { name: /version history/i }));

  expect(screen.getAllByRole('listitem')).toHaveLength(3);

  await user.click(screen.getByText('v1'));
  await user.click(screen.getByRole('button', { name: /restore/i }));

  expect(screen.getByRole('textbox')).toHaveValue('v1');
});
```

### Template apply

```typescript
test('apply template substitutes variables', async () => {
  const template = await createTemplate('bathroom-template', {
    contentMd: '# {{taskTitle}}\n\nClient: {{clientName}}',
    variables: ['taskTitle', 'clientName']
  });

  const task = await createTask({
    title: 'Bathroom remodel',
    clientName: 'Jim Dvorkin'
  });

  await applyTemplate(task.id, template.id);

  const updated = await getTask(task.id);
  expect(updated.wiki?.contentMd).toContain('# Bathroom remodel');
  expect(updated.wiki?.contentMd).toContain('Client: Jim Dvorkin');
});
```

## Demo scenario для Дениса

1. Создать task «Bathroom remodel»
2. Tab «Wiki» — кликнуть «Apply template» → выбрать «Bathroom remodel — full»
3. Видеть auto-filled wiki с {{clientName}} substituted
4. Edit: type `## My notes` + текст
5. Wait 2s — видеть «Saved» indicator
6. Drag-drop photo в editor — видеть привязка
7. Click «AI Suggest» — видеть AI suggestion modal с diff
8. Apply suggestion → видеть added section
9. Click «Version history» → видеть 3 versions (template, edit, AI)
10. Restore version 2 → wiki возвращается
11. Open same wiki в другом tab + edit → conflict UI

## Performance benchmarks

| Operation | Target |
|---|---|
| Editor initial render | < 200ms |
| Markdown preview update | < 50ms |
| Auto-save save | < 100ms server roundtrip |
| AI suggest modal | < 2s (LLM latency) |
| Template apply | < 100ms |
| Version history load | < 200ms |

---

**См. также:**
- [Concept](concept.md)
- [Storage](storage.md)
- [Editor UI](editor-ui.md)
- [AI helper](ai-helper.md)
- [Templates](templates.md)
- [Inheritance](inheritance.md)
- [`../wiki-rollup/acceptance-criteria.md`](../wiki-rollup/acceptance-criteria.md) — отдельные критерии для rollup
- [`../../11-success-metrics.md`](../../11-success-metrics.md)
