---
title: 4.2 Migration from v1 wiki
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (will be authored in detail before cutover, Q9)
---

# Migration from v1 (tasktotime/wiki) to v2

## Source

`tasktotime_tasks` documents — `wiki: { contentMd, version, updatedAt, ... }`
field, plus per-task `wiki_history` subcollection.

## Target

`wikis_v2/L2__{taskId}` documents.

## Mapping

For each task with `wiki.contentMd` non-empty:

```
{
  level: 'L2',
  companyId: <task.companyId>,
  ownerId: <task.id>,
  sections: [
    {
      key: 'notes',
      label: 'Notes',
      schemaVersion: 1,
      body: { contentMd: <task.wiki.contentMd> },
      updatedAt: <task.wiki.updatedAt>,
      updatedBy: <task.wiki.updatedBy ?? task.updatedBy>,
      clientVisible: false,
      internalOnly: false
    }
  ],
  createdAt: <task.wiki.createdAt ?? task.createdAt>,
  updatedAt: <task.wiki.updatedAt ?? task.updatedAt>,
  envelopeVersion: 1,
  createdBy: <task.createdBy>,
}
```

All v1 markdown lands as a single `notes` section. Splitting into typed
sections (`materials`, `decisions`, etc.) is a Phase E follow-up — AI parses
each `notes` body and proposes a split for PM review.

## History

For each `wiki_history/{eventId}` doc:

```
wikis_v2/L2__{taskId}/section_history/{eventId}
  sectionKey: 'notes'
  beforeBody: { contentMd: <history.beforeContentMd> }
  afterBody: { contentMd: <history.afterContentMd> }
  actor: <history.actor>
  timestampMs: <history.timestamp>
  reversible: true
```

## Script

`scripts/migrate-wiki-v1-to-v2.ts`:
- Idempotent (re-running is a no-op via `migrationStatus` field on each
  v1 task wiki doc).
- Batch via Firestore batched writes (500 / batch — Firestore limit).
- `--dry-run` (default), `--yes` to apply, `--company-id <id>` to limit
  per-tenant.
- Mirror `scripts/backfill-tasktotime-priority-and-titleLowercase.ts`
  conventions (see CLAUDE.md §6).

## Cutover plan

Per Q9 in [../10-decisions/open-questions.md](../10-decisions/open-questions.md):

1. **T-30:** Telegram announcement — "wiki upgrade in 30 minutes,
   read-only window".
2. **T-15:** Feature-flag flips read-path to v2 reading from v2 docs.
   Writers still go to v1 (compat window).
3. **T-0:** Run migration script.
4. **T+10:** Verification script: `count(v1 with wiki.contentMd) ==
   count(v2 L2 docs)` per tenant.
5. **T+15:** Smoke test — Денис edits one wiki, sees it round-trip.
6. **T+20:** Feature-flag flips writers to v2.
7. **T+30:** Done. v1 wiki field is read-only legacy.

After 90 days of stability: archive v1 fields (set them to empty), keep
backup snapshots.

## Rollback

- Within T+0..T+10: revert feature-flag for writers, ignore v2 docs.
- After T+20: revert hosting deploy + run reverse-migration script
  (writes v2 sections back to v1 markdown). Reverse-migration is best-
  effort — typed sections may not round-trip 1:1.

## Acceptance

- All non-empty v1 wikis represented as v2 L2 wikis with `notes` section.
- Section history preserved.
- Counts match.
- 24h post-cutover: no spike in error rate.
