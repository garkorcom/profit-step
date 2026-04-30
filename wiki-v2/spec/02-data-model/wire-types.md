---
title: 2.3 Wire Types — TypeScript interfaces for REST + Firestore
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: draft (refine during Phase A)
---

# Wire Types

Reference: [sections.md](sections.md) defines section bodies. This file
defines the envelope, REST contract, and Firestore document shapes.

> **Status:** initial outline. Will be refined during Phase A as we write
> actual `domain/` types and `adapters/firestore/` mapping. Treat the
> shapes here as directional, not final.

## Envelope — what a Wiki document looks like

```ts
export type WikiLevel = 'L1' | 'L2' | 'L3';

export type WikiKey =
  | { level: 'L1'; companyId: string; projectId: string }
  | { level: 'L2'; companyId: string; taskId: string }
  | { level: 'L3'; companyId: string };

export interface Wiki {
  id: string;                  // composite key serialised
  level: WikiLevel;
  companyId: string;
  ownerId: string;             // projectId / taskId / companyId per level
  sections: Section[];
  createdAt: number;
  updatedAt: number;
  createdBy: ActorRef;
  archivedAt?: number;
  /** Schema version of the envelope. Bumped on breaking shape changes. */
  envelopeVersion: number;
}
```

`Section` is defined in [sections.md](sections.md).

## REST shapes (preview, may evolve)

### `GET /api/wiki-v2/wikis/:level/:ownerId`

Response:
```ts
{ ok: true, wiki: Wiki } | { ok: false, error: ApiError }
```

### `POST /api/wiki-v2/wikis`

Body:
```ts
{
  level: WikiLevel;
  ownerId: string;       // projectId / taskId / companyId
  initialSections?: Section[];
  idempotencyKey: string;
}
```

### `PATCH /api/wiki-v2/wikis/:wikiId/sections/:key`

Body:
```ts
{
  body: SectionBody;     // typed per section key
  expectedVersion: number; // optimistic concurrency
  reason?: string;
  idempotencyKey: string;
}
```

### `POST /api/wiki-v2/wikis/:wikiId/sections/:key/enhance`

Body:
```ts
{
  style: 'concise' | 'detailed';
  context?: { taskTitle?: string; recentBlockers?: BlockerEntry[] };
  idempotencyKey: string;
}
```

Response (preview):
```ts
{
  ok: true;
  proposedBody: SectionBody;
  rationale: string;
  confidence: number;
  diff: { added: string[]; removed: string[] };
}
```

PM applies via `PATCH` if accepted.

### `POST /api/wiki-v2/wikis/:wikiId/rollup`

Triggers L2 → L3 rollup for a single L2 wiki. Body:
```ts
{
  targetSections: SectionKey[];   // typically ['lessons']
  idempotencyKey: string;
}
```

### `GET /api/wiki-v2/search?q=...`

Query params:
- `q` — natural language query
- `level` — filter by level (default: all)
- `companyId` — automatically scoped by auth, but explicit for admin
- `limit` — default 20

Response:
```ts
{
  ok: true;
  hits: { wikiKey: WikiKey; sectionKey: SectionKey; score: number; snippet: string }[];
  totalAvailable: number;
}
```

## Firestore document shapes (profit-step adapter)

> **Note:** This is profit-step-specific. A Postgres adapter would map
> the same domain types differently. The host contract does not mandate
> Firestore.

### Collection: `wikis_v2`

Document ID: `<level>_<ownerId>` e.g. `L2_dfa3faa1-...`.

```
wikis_v2/{wikiId}
  level: 'L1' | 'L2' | 'L3'
  companyId: string
  ownerId: string
  sections: Section[]          // embedded up to 500KB total
  createdAt: Timestamp
  updatedAt: Timestamp
  createdBy: ActorRef
  envelopeVersion: number
  archivedAt?: Timestamp
```

### Subcollection: `wikis_v2/{wikiId}/section_history`

Section history is per-section (not per-wiki) so we don't blow up
document size on hot-edit sections.

```
wikis_v2/{wikiId}/section_history/{eventId}
  sectionKey: SectionKey
  beforeBody: object | null
  afterBody: object
  actor: ActorRef
  reason?: string
  timestampMs: number
  reversible: boolean
```

### Indexes (planned)

- `wikis_v2`: `(companyId, level, updatedAt DESC)`
- `wikis_v2`: `(companyId, ownerId, level)`
- `section_history`: `(sectionKey, timestampMs DESC)`

Final indexes will be enumerated in
[../04-storage/collections.md](../04-storage/collections.md) once schema is
locked.

## Open questions affecting wire types

- Q5/Q6 from open questions: `clientVisible` granularity changes envelope.
- Q4 from open questions: custom section keys per host changes `SectionKey`
  type from union to extensible.

These are intentionally TBD in the wire types until decisions land.
