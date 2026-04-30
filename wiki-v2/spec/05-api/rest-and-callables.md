---
title: 5.1 REST + Callables
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase A)
---

# REST + Callable functions

## REST endpoints (`/api/wiki-v2/*`)

Mounted via Express router from `wiki-v2/adapters/http/createWikiV2Router.ts`,
hosted under `agentApi` Cloud Function (same pattern as
`functions/src/tasktotime/http/router.ts`).

| Method | Path | Use case | Notes |
|---|---|---|---|
| GET | `/wikis/:level/:ownerId` | `LoadWiki` | Returns Wiki + sections |
| POST | `/wikis` | `CreateWiki` | Idempotent |
| PATCH | `/wikis/:wikiId/sections/:key` | `PatchSection` | Optimistic concurrency |
| GET | `/wikis/:wikiId/sections/:key/history` | `LoadSectionHistory` | Audit / undo source |
| POST | `/wikis/:wikiId/sections/:key/restore/:eventId` | `RestoreSection` | Undo |
| POST | `/wikis/:wikiId/sections/:key/enhance` | `EnhanceSectionWithAI` | Returns proposal, no write |
| POST | `/wikis/:wikiId/rollup` | `RollupWiki` | L2 → L3 |
| POST | `/wikis/:wikiId/promote` | `PromoteToCompanyKnowledge` | Manual L2 → L3 |
| GET | `/search?q=...` | `SearchWikis` | Cross-wiki RAG |
| POST | `/wikis/:wikiId/captures` | `RegisterCapture` | Bot writes here |

Wire types in [../02-data-model/wire-types.md](../02-data-model/wire-types.md).

## Callable functions

Cloud Functions callables are created for capture flows that originate
from the Telegram bot (where Express-style auth is awkward):

- `captureVoice(input)` — async, returns capture id; bot polls or
  subscribes for the suggested section.
- `capturePhoto(input)`
- `captureReceipt(input)`

These wrap the same use cases as the REST `POST /wikis/:wikiId/captures`
endpoint but with the trigger-friendly callable interface.

## Idempotency

All writes accept `idempotencyKey` (header OR body field). Backend
reserves the key BEFORE mutating and returns the cached outcome on
replay. Mirrors the pattern documented in
`tasktotime/spec/05-api/`.

## Error shape

Standardised across all endpoints:

```ts
{
  ok: false,
  error: {
    code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'STALE_VERSION' | ...
    message: string,
    meta?: { ... }
  }
}
```

`STALE_VERSION` (409) is the optimistic-concurrency conflict — UI handles
by reload + reapply diff.

## Rate limits

- Per-user enhance: 30 / hour
- Per-tenant enhance: 1000 / day
- Per-user search: 100 / hour
- Per-bot capture: unlimited (foreman captures are bursty by nature)

## Auth

All endpoints require `agentApi` middleware: Firebase auth token →
`req.auth = { uid, companyId, ... }`. Cross-tenant requests are rejected
with 404 (not 403 — info disclosure prevention).

## Acceptance criteria (Phase A REST + Phase B enhance)

- All endpoints return 200 / 4xx / 5xx with consistent error shape.
- Idempotency replay works (same key returns cached result).
- Rate limit triggers 429 with `Retry-After`.
- Cross-tenant requests get 404.
- Smoke tests cover happy + 4xx paths for each endpoint.
