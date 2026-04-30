---
title: 4.1 Collections, indexes, rules
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (Phase A locks the final schema)
---

# Firestore collections, indexes, rules

> **Profit-step adapter only.** A Postgres host would map differently.

## Collections

### `wikis_v2` — main collection

```
wikis_v2/{wikiId}
  level: 'L1' | 'L2' | 'L3'
  companyId: string
  ownerId: string
  sections: Section[]    // embedded
  createdAt: Timestamp
  updatedAt: Timestamp
  envelopeVersion: number
  archivedAt?: Timestamp
```

`wikiId` format:
- L1: `L1__<projectId>`
- L2: `L2__<taskId>`
- L3: `L3__<companyId>`

This composite-id pattern means `findOne(level, ownerId, companyId)` is a
direct doc lookup, no query.

### `wikis_v2/{wikiId}/section_history` — per-section audit subcollection

```
section_history/{eventId}
  sectionKey: SectionKey
  beforeBody: object | null
  afterBody: object
  actor: ActorRef
  reason?: string
  timestampMs: number
  reversible: boolean
```

### `wikis_v2/{wikiId}/captures` — raw capture inputs

```
captures/{captureId}
  kind: 'voice' | 'photo' | 'receipt'
  storageRef: string         // GCS path to raw blob
  idempotencyKey: string
  createdAt: Timestamp
  ttlAt: Timestamp           // for auto-cleanup
  status: 'pending' | 'confirmed' | 'discarded'
  resolvedSectionKey?: SectionKey
  resolvedEntryId?: string
```

TTL field drives `ttlAt` cleanup (Firestore TTL policies — see Q7).

### `wiki_search_index` — vector index (Phase F, may move to Vertex)

```
wiki_search_index/{indexId}
  wikiId: string
  sectionKey: SectionKey
  contentChunk: string
  embedding: number[]   // Firestore vector field
  companyId: string
  level: WikiLevel
```

## Indexes (planned)

In `firestore.indexes.json`:

- `wikis_v2`: `(companyId ASC, level ASC, updatedAt DESC)` — list tab
  default queries.
- `wikis_v2`: `(companyId ASC, ownerId ASC)` — quick wiki lookup.
- `wikis_v2`: `(companyId ASC, archivedAt ASC)` — find non-archived.
- `section_history`: `(sectionKey ASC, timestampMs DESC)` — audit queries.
- `captures`: `(companyId ASC, status ASC, createdAt DESC)` — pending
  capture inbox per tenant.
- `wiki_search_index`: vector index on `embedding` field — Vertex AI
  Search collection (likely separate from Firestore).

## Security rules

`firestore.rules` block:

```
match /wikis_v2/{wikiId} {
  allow read: if request.auth != null
    && resource.data.companyId == request.auth.token.companyId;
  allow write: if request.auth != null
    && request.resource.data.companyId == request.auth.token.companyId
    && request.resource.data.companyId == resource.data.companyId; // no cross-tenant move

  match /section_history/{eventId} {
    allow read: if request.auth != null
      && get(/databases/$(database)/documents/wikis_v2/$(wikiId)).data.companyId
         == request.auth.token.companyId;
    // Writes ONLY via Cloud Function (no direct client write).
    allow write: if false;
  }

  match /captures/{captureId} {
    // Same tenant pattern; client-side reads OK, writes via Cloud Function.
  }
}
```

Matches the multi-tenant RLS pattern from `tasktotime/spec/04-storage/rules.md`.

## Storage paths

Same convention as Wiki Attachments (PR #113):

```
companies/{companyId}/wikis-v2/{level}/{ownerId}/sections/{sectionKey}/{filename}
```

- L1 photos: `companies/{c}/wikis-v2/L1/{projectId}/sections/baselinePhotos/...`
- L2 photos: `companies/{c}/wikis-v2/L2/{taskId}/sections/photos/...`
- Captures (raw blobs, 90d TTL): `companies/{c}/wikis-v2/captures/{kind}/{idempotencyKey}.{ext}`

Storage rules block mirrors task wiki rules — image/* MIME, 5MB max for
section attachments, larger for raw captures (TBD).

## Migration from v1 — see [migration-from-v1.md](migration-from-v1.md)
