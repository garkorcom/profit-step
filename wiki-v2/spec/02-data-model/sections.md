---
title: 2.2 Section Schema
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Section Schema

A `Wiki` is a list of `Section`s. Each section has a stable schema.
Editors can write free markdown inside `Notes` and `Lessons`, but the
queryable, structured sections (`Materials`, `Decisions`, `Blockers`,
`Photos`) are typed entries.

## Common shape — every Section

```ts
interface Section<T = unknown> {
  /** Stable section identifier within this wiki. e.g. 'materials'. */
  key: SectionKey;

  /** Human label, may be localised. e.g. 'Materials' or 'Materialien'. */
  label: string;

  /** Schema version for migration. Bump on breaking schema changes. */
  schemaVersion: number;

  /** The structured data. Shape depends on `key`. */
  body: T;

  /** ISO timestamp of last write. */
  updatedAt: number;

  /** User or agent who wrote this last. */
  updatedBy: ActorRef;

  /** Visibility for client view. Default: false. */
  clientVisible: boolean;

  /** Marks this section internal-only. NEVER returned in client view. */
  internalOnly: boolean;
}
```

`ActorRef` distinguishes humans from agents:

```ts
type ActorRef =
  | { kind: 'user'; userId: string; displayName: string }
  | { kind: 'agent'; agentId: string; reason: string };
```

The `agent` kind is used for every AI-driven write (enhance, capture,
rollup). Audit log + undo flow uses `agentId` to find recent agent writes.

## Section keys (the canonical set)

```ts
type SectionKey =
  | 'address'        // L1 only
  | 'client'         // L1 only
  | 'brigade'        // L1 only
  | 'permits'        // L1 only
  | 'selections'     // L1 only
  | 'baselinePhotos' // L1 only
  | 'materials'      // L1 + L2 + L3 (catalog at L3)
  | 'decisions'      // L1 + L2
  | 'blockers'       // L2 only
  | 'photos'         // L2 only
  | 'lessons'        // L2 (writes) + L3 (aggregated)
  | 'vendors'        // L3 only
  | 'subcontractors' // L3 only
  | 'procedures'     // L3 only
  | 'pricingRef'     // L3 only
  | 'notes';         // L1 + L2 + L3 (free markdown)
```

Hosts MAY register additional keys via `registerSectionKind()` at startup
(see [host-contract.md](../08-portability/host-contract.md)). The above list
is what profit-step ships.

## Per-section schemas

### `materials`

```ts
interface MaterialsBody {
  items: MaterialEntry[];
}
interface MaterialEntry {
  id: string;                // local uuid
  name: string;              // "1/2 PEX manifold"
  qty?: number;              // 30
  unit?: string;             // "ft"
  vendor?: string;           // "Home Depot"
  costCents?: number;        // 1899 = $18.99
  purchasedAt?: number;      // epoch ms
  receiptUrl?: string;       // FK to Storage
  receiptOcrConfidence?: number; // 0..1, set by OCR adapter
  notes?: string;
  addedBy: ActorRef;
  clientVisible: boolean;
}
```

L3's `materials` carries `vendorPreference` extras (lead time, contact, last
known price band) on each entry — same shape, more optional fields.

### `decisions`

```ts
interface DecisionsBody {
  items: DecisionEntry[];
}
interface DecisionEntry {
  id: string;
  question: string;          // "Tile pattern: herringbone or stacked?"
  options: string[];         // ["herringbone", "stacked"]
  chosen?: string;           // "herringbone"
  rationale?: string;        // free text
  decidedAt?: number;
  decidedBy?: ActorRef;
  approvedByClient?: boolean;
  photoUrls?: string[];      // optional reference photos
  clientVisible: boolean;    // typically true
}
```

### `blockers`

```ts
interface BlockersBody {
  items: BlockerEntry[];
}
interface BlockerEntry {
  id: string;
  issue: string;             // "rotten subfloor under tub"
  blockedAt: number;
  resolvedAt?: number;
  resolution?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  photoUrls?: string[];
  reportedBy: ActorRef;
}
```

A blocker that reaches `severity: 'critical'` triggers a notification to
Денис via `NotifyPort` — but that wiring lives in application layer, not in
the schema.

### `photos`

```ts
interface PhotosBody {
  items: PhotoEntry[];
}
interface PhotoEntry {
  id: string;
  url: string;                  // from StorageUploadPort
  thumbnailUrl?: string;
  takenAt: number;
  takenBy: ActorRef;
  caption?: string;             // human or AI generated
  autoTags?: string[];          // from PhotoTaggingAdapter
  geo?: { lat: number; lon: number };
  clientVisible: boolean;
}
```

### `lessons`

```ts
interface LessonsBody {
  /** Markdown. Headings are recommended (used by L2→L3 rollup). */
  contentMd: string;
  rolledUpToL3At?: number;
}
```

L2 `lessons` is markdown so it's flexible; the rollup to L3 parses headings
to merge into L3's structured `lessons` aggregate.

### `notes`

```ts
interface NotesBody {
  contentMd: string;
}
```

This is the closest to v1 wiki — free markdown. Used for "everything else".

### Address / Client / Brigade / Permits / Selections / BaselinePhotos (L1-only)

See per-section detail in their own files (planned, not yet drafted):

- `spec/02-data-model/sections-l1.md` — TBD.

These are L1-only structured sections following the same `Section<T>`
envelope. Each is a small typed body (10-20 fields).

## Validation rules

Implemented in `domain/SectionValidator.ts`:

1. `key` must be in registered set (fixed list + host extensions).
2. `schemaVersion` must match a known version for that key.
3. `body` must validate against the per-key zod schema.
4. `clientVisible` and `internalOnly` are mutually exclusive — `internalOnly: true`
   forces `clientVisible: false`.
5. `updatedBy.kind === 'agent'` requires non-empty `reason`.
6. Section size limit: 100KB serialized JSON. Anything bigger should be
   split (e.g. don't put 1000 photos in one Photos section — paginate).

## Patch operations

A wiki is patched section-by-section. The host calls
`PATCH /wikis/:id/sections/:key` with the new section body. The application
layer:

1. Loads current section from `WikiRepositoryPort`.
2. Runs validators on incoming body.
3. Computes a diff for audit log.
4. Writes via `WikiRepositoryPort.patchSection(...)`.
5. Emits an audit event via `AuditLogPort`.
6. If `EnhanceSectionWithAI` triggered the patch, marks `updatedBy.kind: 'agent'`.
7. Optional: emits embedding update (Phase F).

This atomic per-section patch is what enables concurrent agent + human
edits without lost-update headaches.

## Schema migrations

When a section's body shape changes:

1. Bump `schemaVersion`.
2. Add a one-shot migration script that reads docs with old version and
   converts.
3. Adapter MUST handle reads of any past version (forward-compatible).

This is per-section, not per-wiki. Hot migrations of millions of docs are
out of scope; the construction CRM has thousands at most.

## Open questions

See [spec/10-decisions/open-questions.md](../10-decisions/open-questions.md):
- Q4: do we allow custom keys per host or lock to the canonical set?
- Q5: how granular is `clientVisible` — section-level or entry-level?
- Q6: should `internalOnly` be a section-level flag or per-entry?
