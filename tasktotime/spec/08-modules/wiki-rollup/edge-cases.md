---
title: "08.wiki-rollup.4 Edge cases"
section: "08-modules/wiki-rollup"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Wiki Rollup — edge cases

> Что делать с отсутствующими wiki, отменёнными subtasks, inherited wiki, большими attachments, параллельными правками. Каждый case описан с expected behavior.

ТЗ §14.4.

## Edge cases

### 1. Subtask без wiki

**Что:** subtask существует, но `wiki === null` (юзер не написал ничего).

**Behavior:**
- В rolled-up output появляется section с **только title + stats** (assignee, hours, cost)
- Без wiki content section пустая

```markdown
### 3. Electrical rough-in

**Status:** accepted · **Assignee:** Bob · **Hours:** 6h · **Cost:** $300

(no wiki content)

---
```

Это intentional — показываем что задача **существовала** даже без wiki, для completeness audit.

### 2. Cancelled subtasks

**Что:** subtask имеет `lifecycle === 'cancelled'`.

**Behavior:**
- Показывается в rolled-up document
- С `~~strikethrough~~` форматирование
- С пометкой «*(Subtask cancelled)*»
- Включается для audit trail

```markdown
### 4. ~~Floor heating install~~

~~**Status:** cancelled · **Assignee:** Sergey · **Hours:** 0h · **Cost:** $0~~

*(Subtask cancelled — client decided no floor heating)*

---
```

**Зачем включать:** клиент видит что было запланировано, что было отменено и почему. Прозрачность.

### 3. Subtask с inherited wiki (`wikiInheritsFromParent: true`)

**Что:** subtask имеет inherited wiki от parent.

**Behavior:**
- Рендерится **только её собственная часть** (`own.wiki.contentMd`)
- БЕЗ дублирования parent context (иначе recursion: parent context → in subtask → parent context...)

```typescript
function extractOwnContent(subtaskWikiContentMd: string): string {
  // Inherited wiki view rendering looks like:
  //   {parent.contentMd}
  //   ---
  //   ## Subtask: {own.title}
  //   {own.contentMd}
  //
  // For rollup we want only the {own.contentMd} part.
  // Stored field is just `own.contentMd` (parent prefix is rendered at view-time).
  // So this function is identity — just return contentMd.
  return subtaskWikiContentMd;
}
```

### 4. Большие attachments

**Что:** subtask wiki содержит много photos / drawings / pdfs.

**Behavior:**
- Attachments **НЕ инлайнятся** в rolled-up md, **только ссылки**
- Файл с 100 фотками выйдет в **200KB markdown** без images
- Но в **50MB PDF** при экспорте — flag warning UI:

```
┌────────────────────────────────────┐
│ ⚠ This export will include 100      │
│ photos and may be ~50MB.            │
│                                    │
│ Continue?                          │
│            [Cancel] [Yes]          │
└────────────────────────────────────┘
```

При export PDF — есть option «Include attachments» (default ON).

### 5. Параллельные правки subtasks во время rollup

**Что:** PM открыл rollup view; в этот момент worker на site обновляет wiki одной из subtasks.

**Behavior:**
- Rollup рассчитывается **со snapshot timestamp**
- В верху rolled-up document — `_Generated at: Apr 25, 2026 14:30 EDT_`
- Refresh button «Update (3 changes since last build)» — count changes since snapshot
- При click refresh — rebuild с current data

```markdown
# T-2026-0042 — Bathroom remodel

_Generated at: Apr 25, 2026 14:30 EDT_

[content...]
```

### 6. Empty parent (no subtasks)

**Что:** parent task, но `subtaskIds.length === 0`.

**Behavior:**
- Rolled-up document содержит только parent header + parent.wiki + Итого с zeros
- Toggle в UI всё равно работает, но useless
- Можно скрывать toggle если no subtasks: `{subtaskIds.length > 0 && <Toggle />}`

### 7. Subtask с очень длинным wiki (>50KB)

**Что:** одна subtask имеет огромный wiki.

**Behavior:**
- Включается полностью в rolled-up document
- Если total rolled-up > 100KB — warning:

```
┌────────────────────────────────────┐
│ ⚠ Rolled-up wiki is 120KB.          │
│ Some markdown viewers may not render│
│ correctly.                         │
│                                    │
│ Tip: split into separate documents │
│ per subtask for export.            │
└────────────────────────────────────┘
```

### 8. Subtask deleted (soft-delete)

**Что:** subtask имеет `archivedAt !== null`.

**Behavior:**
- По default — **скрывается** из rollup (soft-deleted)
- Toggle option «Include archived subtasks» в UI для admin / audit purposes

### 9. Subtask с `clientVisible: false`

**Что:** subtask hidden от клиента (internal-only).

**Behavior:**
- Если export для клиента (через client portal) — **скрывается**
- Если PM просматривает — показывается с пометкой «*(Internal only)*»

```typescript
// API endpoint
GET /api/tasktotime/tasks/:id/wiki/rollup?audience=client | internal

// Server filters subtasks based on audience
```

### 10. Rollup с recursive parent (если когда-то 3 уровня появятся)

**Что:** теоретически (open question #9), если 3-level будет разрешено — нужен рекурсивный rollup.

**Behavior (для текущей 2-level):**
- НЕ обрабатываем — у нас max 2 уровня
- При validation: `parent.isSubtask === false` (root) — иначе ничего не делаем

**Если когда-то 3-level разрешено:**
- Recursive build: rolled-up из subtasks может включать их собственные subtasks
- Indented headings (#### для уровень 3)

### 11. Очень большой проект (1000+ subtasks)

**Что:** нереальный объём для одного rolled-up document.

**Behavior:**
- Server-side compute через Cloud Function (не client-side)
- Pagination: «Показать 50 из 1000» в UI
- Export PDF: split на multiple files (Volume 1, Volume 2, ...)

### 12. Locale / language

**Что:** parent wiki на русском, subtask wiki на английском.

**Behavior:**
- Mixed content — отрисовывается as-is, без translate
- AI Helper может suggest «Translate all to one language»

---

**См. также:**
- [Concept](concept.md)
- [Algorithm](algorithm.md)
- [UI](ui.md) — error states / warnings
- [Acceptance criteria](acceptance-criteria.md)
- [`../wiki/inheritance.md`](../wiki/inheritance.md) — inherited wiki handling
