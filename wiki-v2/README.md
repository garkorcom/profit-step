# wiki-v2 — portable Knowledge Backbone

**Status:** Phase 0 — TZ in progress. Zero code. Decisions pending.

`wiki-v2` is the upcoming replacement for the per-task markdown wiki currently
shipped inside `tasktotime/`. It is designed from day one as a **portable,
hexagonal package** that can be lifted out of profit-step and dropped into any
other project (a future construction CRM, a different vertical, a separate
SaaS) with a small adapter layer.

If you are an AI agent picking this up — read [INSTRUCTION.md](INSTRUCTION.md)
first. It tells you which files to load in which order so you don't waste
context budget on the entire 25-file spec.

---

## Why a new wiki module

The v1 wiki (under `tasktotime/`) treats wiki as "free-form markdown attached
to one task". That's an engineering primitive, not a business tool. Real PM
workflows surface five gaps:

1. **Information about a project is scattered** — client preferences, permits,
   gate codes, brigade contacts live in ten places.
2. **Capture is painful** — a foreman in the basement does not type Markdown.
   He dictates / sends a photo via Telegram. v1 wiki is not connected to that
   flow.
3. **Lookup doesn't exist** — "what did I quote for a similar bathroom in
   March?" requires manual scrolling.
4. **Client has no window** — selections discussed in WhatsApp never land in
   wiki.
5. **Markdown ≠ structure** — searching "materials" across all tasks is
   impossible because every task writes them differently.

`wiki-v2` is a tier-aware, schema-driven, multi-modal-capture knowledge layer
with first-class AI helpers and cross-project search.

See [spec/01-overview/context.md](spec/01-overview/context.md) for the full
breakdown.

---

## Three core ideas

1. **Three levels of knowledge** — Project KB (L1), Task wiki (L2),
   Company-wide knowledge (L3). Same data model, different scope.
2. **Structured sections instead of raw markdown** — `Materials`, `Decisions`,
   `Blockers`, `Photos`, `Lessons`, `Notes`. Each is queryable.
3. **Multi-modal capture is primary** — voice → AI → section, photo → tag →
   section, receipt → OCR → Materials entry. Typing is the fallback, not the
   default.

---

## What "portable" means in practice

The module is structured so that:

- `domain/` has **zero** dependencies on Firebase, MUI, React, profit-step
  types. Pure TypeScript.
- `ports/` defines interfaces the host project must satisfy
  (`AuthPort`, `StoragePort`, `EmbeddingPort`, etc.). About 12 ports total.
- `adapters/` ships profit-step-specific implementations. A future host
  swaps these with their own adapters.
- `ui/` consumes only `domain` + `ports` types. Theme tokens are injected, not
  hardcoded.

The full migration recipe is in
[spec/08-portability/extract-to-npm.md](spec/08-portability/extract-to-npm.md).
The host integration contract — what the host project must implement to use
wiki-v2 — is in
[spec/08-portability/host-contract.md](spec/08-portability/host-contract.md).

---

## Reading order (TL;DR)

| Order | File | Time | Why |
|---|---|---|---|
| 1 | [README.md](README.md) | 3 min | This file |
| 2 | [INSTRUCTION.md](INSTRUCTION.md) | 5 min | How to navigate (AI-friendly) |
| 3 | [TZ_WIKI_V2.md](TZ_WIKI_V2.md) | 5 min | Spec navigation index |
| 4 | [spec/01-overview/context.md](spec/01-overview/context.md) | 5 min | Why v2 |
| 5 | [spec/01-overview/architecture-decision.md](spec/01-overview/architecture-decision.md) | 8 min | Hexagonal portable |
| 6 | [spec/02-data-model/three-levels.md](spec/02-data-model/three-levels.md) | 5 min | L1/L2/L3 |
| 7 | [spec/02-data-model/sections.md](spec/02-data-model/sections.md) | 8 min | Section schema |
| 8 | [spec/08-portability/host-contract.md](spec/08-portability/host-contract.md) | 10 min | Integration boundary |
| 9 | [AGENT_PLAN.md](AGENT_PLAN.md) | 8 min | Phased delivery plan |
| 10 | [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) | 10 min | What needs Denis input |

**Total ~65 min** for full context. Most agents need only steps 1-5 to start
contributing.

---

## Status & owner

- **Owner:** Denis (sitemiami.com@gmail.com)
- **Phase 0 (current):** TZ documents only. No implementation, no migration.
- **Blockers:** ~12 open questions in
  [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md).
- **Next:** Phase A (data model + ports skeleton). See
  [AGENT_PLAN.md](AGENT_PLAN.md).

---

## What this is NOT

- Not a replacement for `tasktotime` itself — that owns task lifecycle,
  scheduling, dependencies. wiki-v2 is the knowledge layer that complements
  it.
- Not yet code — Phase 0 ships TZ only. Implementation starts after Denis
  signs off on the decisions doc.
- Not coupled to construction — the data model, sections, and capture flows
  are domain-neutral. A medical practice management app could ship wiki-v2
  with a different section preset.
