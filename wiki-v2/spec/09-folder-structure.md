---
title: 9 Folder structure
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Folder structure (Phase A target)

Phase 0 (current) — only `spec/` is populated. Phase A creates the
hexagonal layout below. Implementation lands incrementally; not
everything appears in Phase A.

```
wiki-v2/
│
├── README.md                       ← entry point for any reader
├── INSTRUCTION.md                  ← AI-agent navigation guide
├── TZ_WIKI_V2.md                   ← spec navigation index
├── AGENT_PLAN.md                   ← phased delivery plan (Phase 0..H)
│
├── package.json                    ← (Phase A) for tsc + tests; minimal deps
├── tsconfig.json                   ← (Phase A) extends profit-step root
│
├── eslint/                         ← portability lint rules
│   └── wiki-v2-portability.js      ← no-restricted-imports for forbidden deps
│
├── jest.config.js                  ← (Phase A)
│
├── domain/                         ← pure TS, zero external deps
│   ├── Wiki.ts
│   ├── Section.ts
│   ├── SectionSchema.ts
│   ├── SectionRegistry.ts
│   ├── WikiLevel.ts
│   ├── ActorRef.ts
│   ├── ValidationErrors.ts
│   ├── policies/
│   │   ├── canRollup.ts
│   │   ├── canEnhance.ts
│   │   └── visibilityFilter.ts
│   └── index.ts
│
├── ports/                          ← interface definitions only
│   ├── auth.ts                     ← AuthPort
│   ├── repositories.ts             ← WikiRepositoryPort
│   ├── storage.ts                  ← StorageUploadPort
│   ├── ai.ts                       ← AnthropicEnhancePort, EmbeddingPort
│   ├── audit.ts                    ← AuditLogPort
│   ├── notify.ts                   ← NotifyPort
│   ├── search.ts                   ← VectorSearchPort
│   ├── ocr.ts                      ← OCRPort, VisionTaggingPort
│   ├── voice.ts                    ← VoiceTranscriptionPort
│   ├── clock.ts                    ← ClockPort
│   └── index.ts
│
├── application/                    ← use cases (orchestrate ports + domain)
│   ├── CreateWiki.ts
│   ├── PatchSection.ts
│   ├── EnhanceSectionWithAI.ts
│   ├── CaptureFromVoice.ts
│   ├── CaptureFromPhoto.ts
│   ├── CaptureFromReceipt.ts
│   ├── RollupWiki.ts
│   ├── PromoteToCompanyKnowledge.ts
│   ├── SearchWikis.ts
│   ├── RestoreSection.ts
│   ├── LoadSectionHistory.ts
│   └── index.ts
│
├── adapters/                       ← profit-step concrete implementations
│   ├── firestore/
│   │   ├── FirestoreWikiRepository.ts
│   │   └── FirestoreAuditLogAdapter.ts
│   ├── http/
│   │   ├── createWikiV2Router.ts
│   │   ├── handlers/
│   │   │   ├── getWiki.ts
│   │   │   ├── createWiki.ts
│   │   │   ├── patchSection.ts
│   │   │   ├── enhanceSection.ts
│   │   │   ├── searchWikis.ts
│   │   │   └── ...
│   │   └── schemas.ts              ← request/response zod schemas
│   ├── anthropic/
│   │   ├── AnthropicEnhanceAdapter.ts
│   │   ├── AnthropicEmbeddingAdapter.ts
│   │   └── prompts/
│   │       ├── enhance-materials.txt
│   │       ├── enhance-decisions.txt
│   │       └── ...
│   ├── google-vision/
│   │   ├── PhotoTaggingAdapter.ts
│   │   └── ReceiptOCRAdapter.ts
│   ├── vertex-search/
│   │   └── VertexSearchAdapter.ts
│   ├── telegram-capture/
│   │   └── VoiceIntakeAdapter.ts
│   └── storage/
│       └── FirebaseStorageUploadAdapter.ts
│
├── ui/                             ← React, depends on domain + ports types only
│   ├── components/
│   │   ├── WikiPage.tsx
│   │   ├── SectionEditor.tsx
│   │   ├── SectionEditorMaterials.tsx
│   │   ├── SectionEditorDecisions.tsx
│   │   ├── SectionEditorBlockers.tsx
│   │   ├── SectionEditorPhotos.tsx
│   │   ├── SectionEditorMarkdown.tsx
│   │   ├── EnhanceSectionDialog.tsx
│   │   ├── WikiSearchBar.tsx
│   │   ├── ClientViewRenderer.tsx
│   │   ├── ForemanWikiView.tsx
│   │   ├── InheritedContextBanner.tsx
│   │   └── ...
│   ├── hooks/
│   │   ├── useWiki.ts
│   │   ├── usePatchSection.ts
│   │   ├── useEnhanceSection.ts
│   │   ├── useWikiSearch.ts
│   │   ├── useCaptureVoice.ts
│   │   └── ...
│   ├── theme/
│   │   └── tokens.ts               ← color/spacing tokens, not MUI imports
│   └── index.ts
│
├── shared/
│   ├── fixtures/                   ← realistic mock wikis for tests
│   ├── constants.ts
│   ├── types.ts
│   └── utils/
│
├── tests/
│   ├── domain/                     ← unit tests, pure
│   ├── application/                ← use case tests with port mocks
│   ├── adapters/                   ← contract tests per adapter
│   ├── portability/                ← AST scan, ESLint dry-run
│   └── fixtures/                   ← shared with shared/fixtures
│
└── spec/                           ← THIS folder — pure docs
    ├── 01-overview/
    │   ├── context.md
    │   ├── goals.md
    │   ├── architecture-decision.md
    │   ├── anti-patterns.md
    │   └── glossary.md
    ├── 02-data-model/
    │   ├── three-levels.md
    │   ├── sections.md
    │   └── wire-types.md
    ├── 03-capture-flows/
    │   ├── overview.md
    │   ├── voice-to-section.md
    │   ├── photo-to-section.md
    │   ├── receipt-ocr.md
    │   └── manual-edit.md
    ├── 04-storage/
    │   ├── collections.md
    │   └── migration-from-v1.md
    ├── 05-api/
    │   └── rest-and-callables.md
    ├── 06-ui-ux/
    │   ├── view-modes.md
    │   └── mobile-first-capture.md
    ├── 07-ai-features/
    │   ├── enhance-section.md
    │   ├── rollup.md
    │   └── cross-wiki-search.md
    ├── 08-portability/
    │   ├── host-contract.md
    │   ├── extract-to-npm.md
    │   └── what-not-to-couple.md
    ├── 09-folder-structure.md      ← this file
    └── 10-decisions/
        ├── open-questions.md
        ├── decision-log.md
        └── what-not-to-do.md
```

## Layering rules

- `domain/` imports nothing outside `domain/`.
- `ports/` imports nothing outside `domain/` + `ports/`.
- `application/` imports `domain/` + `ports/`.
- `adapters/` import `ports/` + their respective external libraries
  (Firebase, Anthropic SDK, etc.).
- `ui/` imports `domain/` types + `ports/` types + React + MUI peer deps.
  NEVER imports `adapters/`.
- `shared/` is foundation — anyone may import.

This is enforced by ESLint `no-restricted-imports` per directory.

## Notes for Phase A

- Start with `domain/` + `ports/` + minimal `application/` — get the
  shape right before any adapter exists.
- Add ESLint config + AST test in the same PR to lock portability from
  day one.
- Adapters ship in subsequent PRs (firestore first, then anthropic).
- UI ships once application + adapters are complete (Phase B onward).
