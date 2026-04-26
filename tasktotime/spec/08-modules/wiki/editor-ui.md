---
title: "08.wiki.3 Wiki editor UI"
section: "08-modules/wiki"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Wiki editor UI

> Markdown editor с edit/view modes, auto-save 2s, optimistic concurrency UI, slash-commands. Технология: `@uiw/react-md-editor` (production-ready, React 19 compatible) или `tiptap` если нужно богаче WYSIWYG.

ТЗ §13.3.

## Где находится

- **Detail page → Tab «Wiki»** (часть «Контекст» tab)

## Editor library

### Default: `@uiw/react-md-editor`

- Production-ready
- React 19 compatible
- Lightweight (~50KB gzipped)
- Built-in split-view (markdown + preview)
- Drag-drop image support

```typescript
import MDEditor from '@uiw/react-md-editor';

<MDEditor
  value={contentMd}
  onChange={(value) => setContentMd(value ?? '')}
  preview="live"   // edit + preview side-by-side on desktop
  height={500}
/>
```

### Альтернатива: `tiptap` (если нужно WYSIWYG)

Tiptap — более rich WYSIWYG editor, but heavier (~200KB) и более сложная intergation. Используем если `@uiw/react-md-editor` недостаточно (Phase 4+ decision).

## Modes

### Edit mode

Split-view (desktop) / single-column (mobile):

```
┌─────────────────┬─────────────────┐
│  Markdown       │  Preview        │
│  source         │  rendered       │
│                 │                 │
│  ## Scope       │  Scope          │
│  - drywall      │  • drywall      │
│                 │                 │
└─────────────────┴─────────────────┘
```

Mobile — переключение Edit / Preview tabs (single column не помещает оба).

### View mode

Rendered HTML с подсветкой кода и встроенными изображениями:

```
┌─────────────────────────────────┐
│  Scope                          │
│  • drywall (5 sheets)           │
│  • tile (80 sqft)               │
│                                 │
│  [embedded photo]               │
│                                 │
│  Permits                        │
│  Building permit #123 attached  │
│  [PDF link]                     │
└─────────────────────────────────┘
```

Toggle Edit / View в верху редактора.

## Auto-save

**Debounced 2 seconds** после последнего keystroke:

```typescript
const debouncedSave = useDebouncedCallback(async (md) => {
  try {
    await api.patchTask(taskId, {
      wiki: { contentMd: md, version: currentVersion }
    });
    setSaveStatus('saved');
  } catch (e) {
    if (e.code === 'conflict') showConflictUI();
  }
}, 2000);

useEffect(() => {
  setSaveStatus('saving');
  debouncedSave(contentMd);
}, [contentMd]);
```

## Save status indicator

В верху editor:
```
┌────────────────────────────────────────┐
│  Wiki editor                  [Saving] │
│                                        │
│  ...                                   │
└────────────────────────────────────────┘
```

States: `saving` (yellow dot), `saved` (green check, last saved 2s ago), `conflict` (red warning).

## Optimistic concurrency

Если кто-то параллельно изменил — show conflict UI (как Notion):

```
┌──────────────────────────────────────────┐
│ ⚠ Conflict: Sergey saved 30s ago         │
│                                          │
│ Your changes (last 1 min):               │
│ [+] Added "Permits" section              │
│                                          │
│ Their changes:                           │
│ [+] Added "Materials" section            │
│                                          │
│ [Apply theirs first, then mine]          │
│ [Discard mine, take theirs]              │
│ [Manual merge]                           │
└──────────────────────────────────────────┘
```

См.: [`storage.md`](storage.md) для optimistic concurrency mechanics.

## Slash-commands

В editor — слэш-команды для quick insertion:

| Command | Effect |
|---|---|
| `/photo` | Open file picker → upload to Storage → insert `![caption](attachment://id)` markdown |
| `/checklist` | Insert `- [ ] item` markdown |
| `/link-task` | Open task picker → insert `[Task Title](task://task-id)` cross-reference |
| `/contact` | Open contact picker → insert `📞 Marcus: 813-555-1234` |
| `/template` | Open template picker → insert template markdown content |
| `/divider` | Insert `---` markdown |

Implementation:
```typescript
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === '/') {
    showSlashCommandMenu(cursorPosition);
  }
}
```

См.: `tasktotime/frontend/components/TaskWiki/slashCommands.ts`

## Drag-drop images

Drop image on editor → upload to Storage → insert markdown reference + add to `wiki.attachments[]`:

```typescript
async function handleDrop(e: DragEvent) {
  const file = e.dataTransfer.files[0];
  if (!isImage(file)) return;

  const url = await uploadToStorage(file, `tasktotime/${taskId}/wiki/`);
  const attachmentId = nanoid();

  const newAttachment: WikiAttachment = {
    id: attachmentId,
    url,
    type: 'photo',
    uploadedAt: Timestamp.now(),
    uploadedBy: currentUser
  };

  // Update wiki.attachments + insert markdown
  insertAtCursor(`![${file.name}](attachment://${attachmentId})`);
  await api.patchTask(taskId, {
    wiki: {
      ...currentWiki,
      attachments: [...(currentWiki.attachments ?? []), newAttachment]
    }
  });
}
```

## Toolbar

Above editor:
- Edit / View toggle
- Save status indicator
- Templates picker
- AI Helper button (см. [`ai-helper.md`](ai-helper.md))
- Version history button
- Attach file button (alternative to drag-drop)

## Mobile considerations

- Single-column (не split-view)
- Tabs Edit / Preview
- Touch-optimized toolbar (44×44 buttons)
- Slash-commands menu — bottom sheet (см. [`../../06-ui-ux/mobile-thumb-zone.md`](../../06-ui-ux/mobile-thumb-zone.md))
- Voice input button — vocally diktovat в editor

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + S` | Force save (don't wait for debounce) |
| `Cmd/Ctrl + B` | Bold |
| `Cmd/Ctrl + I` | Italic |
| `Cmd/Ctrl + K` | Insert link |
| `Cmd/Ctrl + /` | Toggle slash-command menu |
| `Cmd/Ctrl + Shift + V` | Paste plain text (no formatting) |
| `Cmd/Ctrl + Z` | Undo (in editor only) |

## Acceptance criteria

См.: [`acceptance-criteria.md`](acceptance-criteria.md)

- ✓ Editor загружается < 200ms
- ✓ Auto-save через 2s после keystroke
- ✓ Conflict resolution UI работает
- ✓ Drag-drop photo
- ✓ Slash-commands (минимум /photo, /checklist, /link-task)

---

**См. также:**
- [Concept](concept.md)
- [Storage](storage.md)
- [AI helper](ai-helper.md)
- [Templates](templates.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../../06-ui-ux/mobile-thumb-zone.md`](../../06-ui-ux/mobile-thumb-zone.md)
