---
title: 8.1 Host Contract — what a host project must provide
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Host Contract

This is the **single most important file** for portability. It defines
the contract between `wiki-v2` and any host project that wants to use it.

If you're integrating wiki-v2 into a new project (the "second customer"
case), this file is your full integration spec. If you're modifying
wiki-v2 internals, this file is what you must NOT break.

---

## Mental model

`wiki-v2` is a hexagonal package. The "hexagon" is the `domain/` +
`application/` core. The edges of the hexagon are **ports** — typed
interfaces. The host project provides **adapters** — implementations of
those interfaces using whatever underlying tech the host runs (Firestore,
Postgres, S3, OpenAI, etc.).

```
                        ┌─────────────────────────────┐
                        │   wiki-v2 application core  │
   ┌─────────┐          │   (domain + use cases)      │          ┌──────────┐
   │ Auth    │ ───port──┤                             ├──port─── │ Storage  │
   │ adapter │          │                             │          │ adapter  │
   └─────────┘          │                             │          └──────────┘
   ┌─────────┐          │                             │          ┌──────────┐
   │ Repo    │ ───port──┤                             ├──port─── │ AI       │
   │ adapter │          │                             │          │ adapter  │
   └─────────┘          └─────────────────────────────┘          └──────────┘
        ↑                                                              ↑
        │                                                              │
   Host implements                                                Host implements
```

Ports are TypeScript interfaces in `wiki-v2/ports/`. Adapters are concrete
classes anywhere the host project wants. The composition root (where all
adapters get wired into use cases) is host-owned.

---

## The 12 ports

This is a stable interface. Adding a new port is a breaking change for
hosts (they must implement the new one). Renaming a method is a breaking
change.

### 1. `AuthPort`

```ts
export interface AuthPort {
  /** Returns the currently authenticated user, or null. */
  getCurrentUser(): Promise<UserRef | null>;

  /** Returns the company/tenant the user belongs to. */
  companyOf(userRef: UserRef): Promise<CompanyId>;

  /** Returns true if user has the named permission for the given scope. */
  hasPermission(userRef: UserRef, perm: Permission, scope: Scope): Promise<boolean>;
}

interface UserRef { id: string; displayName: string; email?: string }
type CompanyId = string;
type Permission = 'read' | 'write' | 'enhance' | 'rollup' | 'admin';
type Scope = { kind: 'project'; projectId: string }
           | { kind: 'task'; taskId: string }
           | { kind: 'company'; companyId: string };
```

### 2. `WikiRepositoryPort`

```ts
export interface WikiRepositoryPort {
  /** Find one wiki by composite key. */
  findOne(key: WikiKey): Promise<Wiki | null>;

  /** List wikis by level + scope. */
  findMany(filter: WikiFilter): Promise<{ items: Wiki[]; nextCursor: string | null }>;

  /** Create a new wiki document. Idempotent on (level, ownerId). */
  create(input: CreateWikiInput): Promise<Wiki>;

  /** Patch one section atomically. */
  patchSection(input: PatchSectionInput): Promise<Wiki>;

  /** Append a section history entry (for audit / undo). */
  appendHistory(input: HistoryEntryInput): Promise<void>;

  /** Soft-delete (archive) a wiki. */
  archive(key: WikiKey): Promise<void>;
}
```

### 3. `StorageUploadPort`

```ts
export interface StorageUploadPort {
  /** Upload a file blob, return a stable URL the host can resolve. */
  upload(input: {
    file: Blob | Buffer;
    contentType: string;
    pathHint: string; // e.g. "wikis/L2/<taskId>/photos/<filename>"
    sizeMaxBytes?: number;
  }): Promise<{ url: string; storageKey: string }>;

  /** Generate a signed URL for client-side uploads (browser direct). */
  signedUploadUrl(input: {
    pathHint: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<{ uploadUrl: string; resourceUrl: string }>;
}
```

### 4. `EmbeddingPort` (Phase F)

```ts
export interface EmbeddingPort {
  /** Compute embeddings for one or more text chunks. */
  embed(inputs: string[]): Promise<number[][]>;
  /** Vector dimensionality (used to size the index). */
  dimensions(): number;
}
```

### 5. `VectorSearchPort` (Phase F)

```ts
export interface VectorSearchPort {
  upsert(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]): Promise<void>;
  query(vector: number[], opts: { topK: number; filter?: Record<string, unknown> }): Promise<SearchHit[]>;
}
interface SearchHit { id: string; score: number; payload: Record<string, unknown> }
```

### 6. `AnthropicEnhancePort`

Despite the name, this is provider-agnostic. "Anthropic" refers to the
type of capability (LLM-based enhancement) — implementations may use any
model provider.

```ts
export interface AnthropicEnhancePort {
  /** Generate an enhanced section body given current state + task context. */
  enhance(input: {
    section: Section;
    context: EnhanceContext;
    style: 'concise' | 'detailed';
  }): Promise<{ proposedBody: unknown; rationale: string; confidence: number }>;
}
interface EnhanceContext {
  taskTitle?: string;
  taskDescription?: string;
  projectKb?: Section[];
  recentBlockers?: BlockerEntry[];
}
```

### 7. `OCRPort`

```ts
export interface OCRPort {
  /** Extract structured data from a receipt image. */
  parseReceipt(input: { imageUrl: string }): Promise<{
    vendor?: string;
    totalCents?: number;
    items?: { name: string; qty?: number; priceCents?: number }[];
    purchasedAt?: number;
    confidence: number;
  }>;
}
```

### 8. `VisionTaggingPort`

```ts
export interface VisionTaggingPort {
  /** Auto-tag an image — what's in it, room type, defect class. */
  tag(input: { imageUrl: string }): Promise<{
    tags: string[];
    suggestedSectionKey?: SectionKey;
    confidence: number;
  }>;
}
```

### 9. `VoiceTranscriptionPort`

```ts
export interface VoiceTranscriptionPort {
  transcribe(input: {
    audioUrl: string;
    languageHint?: 'ru' | 'en' | string;
  }): Promise<{ text: string; confidence: number; segments?: TranscriptSegment[] }>;
}
interface TranscriptSegment { startMs: number; endMs: number; text: string }
```

### 10. `AuditLogPort`

```ts
export interface AuditLogPort {
  record(event: AuditEvent): Promise<void>;
  list(filter: { wikiKey: WikiKey; sinceMs?: number; limit?: number }): Promise<AuditEvent[]>;
}
interface AuditEvent {
  id: string;
  wikiKey: WikiKey;
  sectionKey: SectionKey;
  actor: ActorRef;
  kind: 'create' | 'patch' | 'enhance' | 'rollup' | 'archive';
  diff?: unknown; // before/after
  timestampMs: number;
  reversible: boolean;
}
```

### 11. `NotifyPort`

```ts
export interface NotifyPort {
  push(input: {
    audience: 'user' | 'role';
    target: string; // userId or role name
    title: string;
    body: string;
    deepLink?: string;
  }): Promise<void>;
}
```

### 12. `ClockPort`

```ts
export interface ClockPort {
  nowMs(): number;
}
```

This is intentionally separate so tests can inject a deterministic clock
and so timestamps are consistent across distributed adapters.

---

## Composition root example

The host wires adapters to use cases at startup:

```ts
import { CreateWiki, PatchSection, EnhanceSectionWithAI } from '@profit-step/wiki-v2/application';
import { FirestoreWikiRepository } from './adapters/FirestoreWikiRepository';
import { FirebaseAuthAdapter } from './adapters/FirebaseAuthAdapter';
import { AnthropicEnhanceAdapter } from './adapters/AnthropicEnhanceAdapter';
// ... etc

export function buildWikiV2() {
  const auth = new FirebaseAuthAdapter();
  const repo = new FirestoreWikiRepository(db);
  const enhancer = new AnthropicEnhanceAdapter(anthropic);
  // ... etc

  return {
    createWiki: new CreateWiki({ auth, repo, audit, clock }),
    patchSection: new PatchSection({ auth, repo, audit, clock }),
    enhanceSection: new EnhanceSectionWithAI({ auth, repo, enhancer, audit, clock }),
    // ...
  };
}
```

`profit-step` will provide a reference set of adapters in
`wiki-v2/adapters/` that hosts can copy or use as a starting point.

---

## Versioning

Ports follow semver. Breaking changes:
- Removing or renaming a port method.
- Adding a required method to a port.
- Changing input/output shape of an existing method.

Non-breaking:
- Adding a new port (host implements when they want to use the related
  feature).
- Adding optional fields to existing types.

The `wiki-v2` package version is bumped when ports change. Hosts pin
exact versions until they update adapters.

---

## What hosts must NOT do

- Import from `wiki-v2/adapters/...` and use those directly. Adapters are
  reference implementations; host-owned adapters live in host code.
- Mutate values returned from `wiki-v2/domain` types. They are immutable.
- Bypass the application layer and call adapters directly from UI. Use
  cases enforce invariants and audit; bypassing them creates corruption.

---

## What hosts MAY do

- Provide additional section keys via `registerSectionKind()` — see
  [sections.md](../02-data-model/sections.md).
- Replace any adapter with their own implementation as long as it
  satisfies the port contract test.
- Embed the UI components into their own routes / layouts. UI consumes
  use cases via React hooks (e.g. `useEnhanceSection`).
- Skip features (e.g. a host that doesn't need cross-wiki search just
  doesn't implement `EmbeddingPort` + `VectorSearchPort` and the
  `SearchWikis` use case throws a clear "not configured" error if used).
