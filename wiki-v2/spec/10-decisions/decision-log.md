---
title: 10.2 Decision log
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Decision log

Decisions made by Денис, recorded in chronological order. Each entry has
the format below for traceability.

## Format

```markdown
### Decision N (YYYY-MM-DD): <short title>

**Question:** [reference to open-questions.md, e.g. Q1]

**Decision:** [option a/b/c/... with rationale]

**Rationale:** Why Денис chose this option.

**Implementation impact:**
- Changes to [section] in [spec file]
- New work needed in [module]
- Breaking changes for [API / migration]

**Decided by:** Денис
**Date:** YYYY-MM-DD
**Recorded by:** [Claude Opus / Никита / Стёпа / etc.]
```

---

## Decisions

### Decision 1 (2026-04-30): Portable hexagonal package, separate folder

**Question:** Where should wiki-v2 live? In-tree under `tasktotime/`, or
as a standalone module?

**Decision:** Standalone hexagonal package at repo root in `wiki-v2/`,
designed for npm extraction from day one.

**Rationale:** Денис's request — "только в отдельной папке для лёгкой
миграции для другого проекта". Validates the broader thesis that the
knowledge layer should be portable to a future second customer (different
construction CRM, medical case files, field service, etc.).

**Implementation impact:**
- `wiki-v2/` at repo root, sibling to `tasktotime/`.
- Hard layering: `domain/` + `ports/` + `application/` + `ui/` zero
  external deps; `adapters/` profit-step-specific.
- ESLint rule + AST test enforce portability.
- See [../01-overview/architecture-decision.md](../01-overview/architecture-decision.md) for full doc.

**Decided by:** Денис
**Date:** 2026-04-30
**Recorded by:** Claude Opus 4.7

---

## Process for new decisions

1. Денис answers a question from
   [open-questions.md](open-questions.md).
2. Agent (or Денис) creates new entry here with format above.
3. Agent removes the question from `open-questions.md` (or marks it
   RESOLVED with link to this entry).
4. Agent updates affected spec files.
