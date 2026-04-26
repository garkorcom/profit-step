---
title: "08.wiki-rollup.3 UI (toggle и export buttons)"
section: "08-modules/wiki-rollup"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Wiki Rollup UI

> Toggle «Show with subtasks» + кнопки экспорта (PDF / Word / Markdown / clipboard / template / акт). Где: Detail page → Tab «Wiki» (parent task only).

ТЗ §14.3.

## Toggle

В верхнем правом углу Wiki tab:

```
┌─────────────────────────────────────────────────┐
│  Wiki — Bathroom remodel                         │
│                                                  │
│  ┌─────────────────────────────────────────────┐│
│  │ [Show with subtasks (5)] [Refresh]          ││  ← toggle
│  ├─────────────────────────────────────────────┤│
│  │                                             ││
│  │  (parent.wiki.contentMd rendered)           ││  ← default view
│  │                                             ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

После click на toggle:

```
┌─────────────────────────────────────────────────┐
│  Wiki — Bathroom remodel — Aggregated            │
│                                                  │
│  ┌─────────────────────────────────────────────┐│
│  │ ◉ With subtasks (5)  [Refresh]              ││  ← toggle ON
│  ├─────────────────────────────────────────────┤│
│  │                                             ││
│  │  (rolled-up wiki rendered)                  ││  ← aggregated view
│  │                                             ││
│  │  Header                                     ││
│  │  Parent context                             ││
│  │  Subtask 1: Demo                            ││
│  │  Subtask 2: Plumbing                        ││
│  │  ...                                        ││
│  │  Итого                                      ││
│  │                                             ││
│  └─────────────────────────────────────────────┘│
│                                                  │
│  [Export PDF] [Markdown] [Word] [Copy]          │  ← export buttons (visible when toggle ON)
│  [Save as template] [Attach to acceptance act]  │
└─────────────────────────────────────────────────┘
```

## Export buttons

### PDF

```
[Export PDF]
   ↓
Server-side rendering via PuppeteerSharp или Cloud Function с puppeteer
   ↓
Returns gs://... URL
   ↓
Browser downloads file
```

Implementation:
```typescript
async function exportPdf(parentTaskId: string) {
  const md = await api.getRolledUpWiki(parentTaskId);
  const pdfUrl = await api.renderMarkdownToPdf(md, {
    title: parent.title,
    style: 'professional'
  });
  window.open(pdfUrl, '_blank');
}
```

### Markdown

```
[Markdown]
   ↓
Download as `.md` file (client-side, no server roundtrip)
```

```typescript
async function exportMarkdown(parentTaskId: string) {
  const md = await api.getRolledUpWiki(parentTaskId);
  download(`${parent.taskNumber}.md`, md, 'text/markdown');
}
```

### Word

```
[Word]
   ↓
Convert Markdown → HTML → DOCX (через библиотеку или Cloud Function)
   ↓
Returns gs://... URL
```

Используем `docx` npm package или server-side `pandoc`.

### Copy to clipboard

```
[Copy]
   ↓
Copy markdown to clipboard
   ↓
Toast «Copied to clipboard»
```

```typescript
async function copyToClipboard(parentTaskId: string) {
  const md = await api.getRolledUpWiki(parentTaskId);
  await navigator.clipboard.writeText(md);
  toast.success('Copied to clipboard');
}
```

### Save as template

```
[Save as template]
   ↓
Modal: name, category, auto-detect variables
   ↓
Creates wikiTemplates/{id} с placeholders
```

См.: [`../wiki/templates.md`](../wiki/templates.md)

```typescript
async function saveAsTemplate(parentTaskId: string) {
  const md = await api.getRolledUpWiki(parentTaskId);
  // Auto-detect: clientName → {{clientName}}, address → {{address}}, etc.
  const { templated, variables } = autoTemplate(md, parent);

  // Show modal for confirmation
  const { name, category } = await showSaveTemplateModal();

  await api.createWikiTemplate({
    name,
    category,
    contentMd: templated,
    variables,
  });

  toast.success(`Template "${name}" saved`);
}
```

### Attach to acceptance act

```
[Attach to acceptance act]
   ↓
Если parent.acceptance exists:
   - Copy rolled-up md в acceptance.notes
   - Generate PDF и attach to acceptance.url (replace existing)
Else:
   - Toast «Sign acceptance act first»
```

```typescript
async function attachToAcceptance(parentTaskId: string) {
  const parent = await api.getTask(parentTaskId);
  if (!parent.acceptance) {
    toast.error('Sign acceptance act first');
    return;
  }

  const md = await api.getRolledUpWiki(parentTaskId);
  const pdfUrl = await api.renderMarkdownToPdf(md, { ... });

  await api.patchTask(parentTaskId, {
    acceptance: {
      ...parent.acceptance,
      notes: md,
      url: pdfUrl,  // replace existing PDF
    }
  });

  toast.success('Attached to acceptance act');
}
```

## Loading state

При click toggle — show loading:

```
┌────────────────────────────┐
│ Building rolled-up wiki... │
│ [spinner]                  │
└────────────────────────────┘
```

Target: <1s для 20 subtasks (acceptance criteria).

## Refresh button

Если subtasks updated since last rollup — refresh button updates view:

```
[Refresh] (updated 30s ago)
```

После click — re-fetch + re-render.

## Mobile

На mobile — кнопки export в bottom sheet:

```
┌─────────────────────────────┐
│   ━━━ (drag handle)         │
│   Export Aggregated Wiki    │
│   ─────────────────────     │
│   📄 PDF                    │
│   📝 Markdown               │
│   📃 Word                   │
│   📋 Copy                   │
│   ─────────────────────     │
│   💾 Save as template       │
│   📎 Attach to acceptance   │
└─────────────────────────────┘
```

## Toggle state persistence

Toggle state не сохраняется per-task — каждый раз default OFF (показываем только parent wiki). Это intentional: rollup это **on-demand action**, не default view.

## Print stylesheet

`@media print` styles для browser print:
- Скрыть navigation, toolbar, side panels
- Большой font для чтения на бумаге
- Page breaks между subtasks (`page-break-before: always` для каждой `### Subtask N`)

## Accessibility

- Toggle — `<button role="switch" aria-checked={...}>`
- Export buttons — clear labels («Export to PDF» не «PDF»)
- Loading state — `<div role="status" aria-live="polite">`

---

**См. также:**
- [Concept](concept.md)
- [Algorithm](algorithm.md)
- [Edge cases](edge-cases.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../wiki/templates.md`](../wiki/templates.md) — Save as template
- [`../../06-ui-ux/mobile-thumb-zone.md`](../../06-ui-ux/mobile-thumb-zone.md) — bottom sheet pattern
