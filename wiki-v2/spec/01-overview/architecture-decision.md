---
title: 1.3 Architecture Decision — portable hexagonal
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Architecture Decision: portable hexagonal package

## Decision in one paragraph

`wiki-v2` is implemented as a **hexagonal package designed from day one for
extraction into an npm module**. Inside profit-step it lives at the repo
root in `wiki-v2/` (sibling to `tasktotime/`). When a future project (the
"second customer") needs the wiki layer, it imports `@profit-step/wiki-v2`
(or whatever we name the published package), implements ~12 ports, and
ships. No internal refactor is required because the boundary was designed
correctly the first time.

This is the **same architectural choice** Денис made for `tasktotime/` in
April 2026 (see `tasktotime/spec/01-overview/architecture-decision.md`),
extended one step further: **portability is a non-negotiable acceptance
criterion**, enforced by ESLint and unit tests, not just intention.

## Why portable from day one

`tasktotime/` was built hexagonal "in case we need it later". `wiki-v2` is
explicitly built portable because:

1. **Construction is one of N domains where this knowledge model fits.**
   Property management, field service, manufacturing maintenance, medical
   case files — all have the same Project KB / Task wiki / Company knowledge
   triad with multi-modal capture.
2. **Selling the wiki is feasible.** A standalone "construction PM with
   AI-driven knowledge layer" SaaS is a credible product (cf. Procore +
   Notion). Keeping wiki-v2 portable means we can spin it out without
   surgery.
3. **The integration boundary catches bugs.** A wiki adapter that secretly
   needs `tasktotimeApi.getTask()` is a leaky abstraction. Forcing the
   boundary now reveals coupling early.

## What "portable" means concretely

A future host project — let's call it "ProjectB" — must be able to:

```bash
# In ProjectB
npm install @profit-step/wiki-v2
```

Then implement ~12 ports listed in
[host-contract.md](../08-portability/host-contract.md). That's it. Зnown
shapes:

- `AuthPort` — give wiki-v2 a `getCurrentUser()` and `companyOf(user)`.
- `WikiRepositoryPort` — Firestore / Postgres / Mongo, doesn't care.
- `StorageUploadPort` — S3 / GCS / Azure Blob, doesn't care.
- `EmbeddingPort` — Anthropic / OpenAI / Vertex AI, doesn't care.
- `AnthropicEnhancePort` — same idea, swappable LLM provider.
- ...

Inside `wiki-v2/`, the `domain/` and `ports/` directories must have **zero**
imports from:
- `firebase`, `firebase-admin`
- `@mui/material`, any MUI sub-package
- `react`, `react-dom`
- `tasktotime/`
- profit-step-specific source paths (`src/api/...`, `src/firebase/...`)

This is enforced by:
- ESLint `no-restricted-imports` rule
- Unit test that scans `domain/` and `ports/` ASTs and fails if any of those
  imports exist.

## What "hexagonal" looks like for wiki-v2

```
wiki-v2/
│
├── domain/                  ← business logic, pure TypeScript
│   ├── Wiki.ts              ← Wiki entity (id, level, ownerId, sections)
│   ├── Section.ts           ← Section entity + invariants
│   ├── SectionSchema.ts     ← Materials / Decisions / Blockers / Photos / etc.
│   ├── WikiLevel.ts         ← L1 | L2 | L3 enum
│   ├── ValidationErrors.ts  ← typed error union
│   └── policies/            ← business rules (e.g. when can rollup happen?)
│
├── ports/                   ← interfaces only, NO implementations
│   ├── repositories.ts      ← WikiRepositoryPort, SectionRepositoryPort
│   ├── auth.ts              ← AuthPort
│   ├── storage.ts           ← StorageUploadPort
│   ├── ai.ts                ← AnthropicEnhancePort, EmbeddingPort, etc.
│   ├── audit.ts             ← AuditLogPort
│   ├── notify.ts            ← NotifyPort (push / email / telegram)
│   ├── search.ts            ← VectorSearchPort
│   └── ocr.ts               ← OCRPort, VisionTaggingPort
│
├── application/             ← use cases, orchestrate ports + domain
│   ├── CreateWiki.ts
│   ├── PatchSection.ts
│   ├── EnhanceSectionWithAI.ts
│   ├── CaptureFromVoice.ts
│   ├── CaptureFromPhoto.ts
│   ├── CaptureFromReceipt.ts
│   ├── RollupWiki.ts
│   ├── SearchWikis.ts
│   └── PromoteToCompanyKnowledge.ts
│
├── adapters/                ← profit-step concrete implementations
│   ├── firestore/
│   │   ├── FirestoreWikiRepository.ts
│   │   └── FirestoreAuditLogAdapter.ts
│   ├── http/
│   │   ├── createWikiV2Router.ts
│   │   ├── handlers/
│   │   └── schemas.ts
│   ├── anthropic/
│   │   ├── AnthropicEnhanceAdapter.ts
│   │   └── AnthropicEmbeddingAdapter.ts
│   ├── vertex-search/
│   │   └── VertexSearchAdapter.ts
│   ├── google-vision/
│   │   ├── PhotoTaggingAdapter.ts
│   │   └── ReceiptOCRAdapter.ts
│   ├── telegram-capture/
│   │   └── VoiceIntakeAdapter.ts
│   └── storage/
│       └── FirebaseStorageUploadAdapter.ts
│
├── ui/                      ← React, depends on `domain` + ports types only
│   ├── components/
│   │   ├── SectionEditor.tsx
│   │   ├── EnhanceSectionDialog.tsx
│   │   ├── WikiSearchBar.tsx
│   │   ├── ClientViewRenderer.tsx
│   │   └── ...
│   ├── hooks/
│   │   ├── useWiki.ts
│   │   ├── useEnhanceSection.ts
│   │   └── useWikiSearch.ts
│   └── theme/                ← ONLY tokens — no MUI imports leak here
│
├── shared/                  ← types, fixtures, constants used cross-layer
├── tests/
└── spec/                    ← pure docs, this folder
```

Every adapter has a contract test in `tests/adapters/<name>.test.ts` that
verifies the port contract — not the implementation details. That test is
what a future host project copies to verify their swap-out adapter.

## What this costs vs simpler approaches

| Approach | Phase 0+A timeline | Cost of switching adapters | Future host integration |
|---|---|---|---|
| In-line in profit-step (no abstraction) | 1 day saved | Total rewrite | 4-6 weeks |
| Hexagonal in monorepo (this decision) | +0 days vs above (nominal cost) | Swap one file | 1-2 days for ports + ~1 week for adapters |
| Full microservice from day one | +10-14 days (own auth, deploy, network) | N/A | 2-3 days but adds runtime ops cost forever |

The middle column is what we picked for `tasktotime/` and what we re-pick
here. Operational cost is zero (no separate process, no IPC, no separate
deployment), and migration to npm package is a 1-2 day extraction when the
second customer materializes.

## Acceptance criteria for "portable"

A reviewer (human or AI) checks portability by:

1. `grep -r "firebase\|@mui\|react\|tasktotime/" wiki-v2/domain/ wiki-v2/ports/` returns **zero** matches.
2. ESLint `no-restricted-imports` rule is in `wiki-v2/eslint/wiki-v2-portability.js`
   and CI fails on violation.
3. Unit test `tests/portability.test.ts` walks the AST and asserts no
   restricted import.
4. `tests/adapters/*.test.ts` exist for every adapter and verify the port
   contract.
5. README's "What 'portable' means in practice" section matches the actual
   code state.

## Decision finality

This decision is **architectural** — not a feature flag. Reverting it
requires a separate ADR and a different folder structure. Phase 0 documents
do not need separate ADRs to be edited.

Recorded by: Claude Opus 4.7, 2026-04-30, after Денис's instruction
"только в отдельной папке для лёгкой миграции для другого проекта" in the
session that produced this scaffold.
