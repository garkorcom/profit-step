---
title: "08.wiki.2 Wiki storage"
section: "08-modules/wiki"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Wiki storage — embed на Task до 100KB

> TaskWiki хранится **embed на Task** до 100KB markdown. Если больше — attachments отдельно. Старые версии (>10) — в subcollection `tasktotime_tasks/{taskId}/wiki_history/{versionId}`. Optimistic concurrency через `version` поле.

ТЗ §13.2.

## TypeScript model

```typescript
interface TaskWiki {
  contentMd: string;              // Markdown source, max 100KB
  updatedAt: Timestamp;
  updatedBy: UserRef;
  version: number;                // increments per save
  versionHistory?: WikiVersion[]; // last 10 inline; older в subcollection
  attachments?: WikiAttachment[]; // photos / pdfs / drawings
  templateId?: string;
}

interface WikiVersion {
  version: number;
  contentMd: string;
  updatedAt: Timestamp;
  updatedBy: UserRef;
  changeSummary?: string;             // optional 1-line summary
}

interface WikiAttachment {
  id: string;
  url: string;
  type: 'photo' | 'pdf' | 'drawing' | 'invoice';
  caption?: string;
  uploadedAt: Timestamp;
  uploadedBy: UserRef;
}
```

## Где хранится

### Inline на task (до 100KB)

```typescript
// tasktotime_tasks/{taskId}
{
  // ... other Task fields
  wiki: {
    contentMd: '...',         // markdown text
    updatedAt: Timestamp,
    updatedBy: { id, name },
    version: 5,
    versionHistory: [          // last 10 inline
      { version: 4, contentMd: '...', updatedAt, updatedBy, changeSummary: 'Added permits section' },
      { version: 3, ... },
      // ... up to 10
    ],
    attachments: [
      { id: '...', url: 'gs://...', type: 'photo', caption: 'Existing tile' }
    ],
    templateId: 'bathroom-remodel-checklist'
  }
}
```

### Subcollection для старых версий

`tasktotime_tasks/{taskId}/wiki_history/{versionId}` — старые версии (>10).

```typescript
// tasktotime_tasks/abc-123/wiki_history/version-3
{
  version: 3,
  contentMd: '...',
  updatedAt: Timestamp,
  updatedBy: { id, name },
  changeSummary: '...'
}
```

## Limits

- **`contentMd`** — max 100KB (≈ 100,000 ASCII chars)
- **`versionHistory`** — last 10 inline. Older — moved to subcollection by `onWikiUpdate` trigger.
- **`attachments`** — max 50 attachments inline (links, не файлы — файлы в Storage)

## Почему 100KB

Firestore document limit — 1MB. Wiki = одно из больших полей на task. 100KB даёт place для:
- ~50 sections markdown text
- ~50 attachments references
- остальные task fields (description, history, materials, etc.)

Если wiki > 100KB — split: основной контент остаётся, дополнения в attachments как PDFs.

## Optimistic concurrency

`version` field инкрементируется при каждом save. Client при PATCH должен передать current `version`:

```typescript
PATCH /api/tasktotime/tasks/:id
{
  wiki: {
    contentMd: 'new content',
    version: 5  // current version client knows
  }
}
```

Server check:
```typescript
if (currentTask.wiki.version !== request.wiki.version) {
  return 409 Conflict { latestVersion, lastUpdatedBy };
}
// Apply update with version + 1
```

UI показывает **conflict UI** (как Notion):
```
┌──────────────────────────────────────────────┐
│ ⚠ Conflict: Sergey edited wiki 30s ago       │
│                                              │
│ Your changes:        Their changes:          │
│ [diff view]          [diff view]             │
│                                              │
│ [Take mine] [Take theirs] [Merge manually]   │
└──────────────────────────────────────────────┘
```

## Trigger: `onWikiUpdate`

См.: [`../../05-api/triggers.md`](../../05-api/triggers.md)

```typescript
export const onWikiUpdate = functions.firestore
  .document('tasktotime_tasks/{taskId}')
  .onUpdate(async (change) => {
    const before = change.before.data() as Task;
    const after = change.after.data() as Task;

    if (before.wiki?.contentMd === after.wiki?.contentMd) return null;  // no change
    if (!after.wiki) return null;

    // 1. Append previous version to versionHistory inline
    const prevVersion: WikiVersion = {
      version: before.wiki.version,
      contentMd: before.wiki.contentMd,
      updatedAt: before.wiki.updatedAt,
      updatedBy: before.wiki.updatedBy,
    };

    const newHistory = [...(after.wiki.versionHistory ?? []), prevVersion];

    // 2. If > 10 — move oldest to subcollection
    if (newHistory.length > 10) {
      const oldestVersion = newHistory.shift()!;
      await change.after.ref.collection('wiki_history').doc(`v${oldestVersion.version}`).set(oldestVersion);
    }

    // 3. Update task with trimmed history
    await change.after.ref.update({
      'wiki.versionHistory': newHistory,
    });

    // 4. Invalidate parent rollup cache (если parent has rollup cache)
    if (after.parentTaskId) {
      // ... invalidate parent.wikiRollupCache
    }
  });
```

## Attachments storage

Attachment files лежат в Firebase Storage:
```
gs://profit-step.appspot.com/tasktotime/{taskId}/wiki/{attachmentId}.{ext}
```

Метаданные — в `wiki.attachments[]`:
```typescript
{
  id: 'attachment-id',
  url: 'gs://...',
  type: 'photo',
  caption: 'Existing tile before demo',
  uploadedAt: Timestamp,
  uploadedBy: { id, name }
}
```

Reference в markdown:
```markdown
![Existing tile](attachment://attachment-id)
```

При rendering → resolve через attachments lookup, render `<img src={url}>`.

## Backups

`wiki_history` subcollection не deleted (audit trail). Если task soft-deleted (`archivedAt`) — wiki сохраняется.

Hard delete (admin only) удаляет также wiki_history subcollection через explicit script.

---

**См. также:**
- [Concept](concept.md)
- [Editor UI](editor-ui.md) — как пишется
- [AI helper](ai-helper.md)
- [Templates](templates.md)
- [Inheritance](inheritance.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../../02-data-model/sub-types.md`](../../02-data-model/sub-types.md) — TaskWiki, WikiVersion, WikiAttachment
- [`../../05-api/triggers.md`](../../05-api/triggers.md) — onWikiUpdate trigger
- [`../../04-storage/collections.md`](../../04-storage/collections.md) — wiki_history subcollection
