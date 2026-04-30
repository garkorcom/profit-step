# INSTRUCTION.md — for AI agents working on wiki-v2

If you (Claude / Никита / Стёпа / Cursor agent / future contributor)
are about to touch wiki-v2 — read this file first. It exists to save you
~30 minutes of confused exploration on every fresh session.

---

## What `wiki-v2` is in one paragraph

A portable, hexagonal Knowledge Backbone. Three levels (Project KB / Task
wiki / Company knowledge). Structured sections, not raw markdown. Multi-modal
capture (voice / photo / receipt) is the primary input path; typing is
fallback. AI helpers (`enhance section`, `rollup`, `cross-wiki search`) are
first-class UX, not afterthoughts. Designed from day one to be extracted into
an npm package and dropped into another project.

---

## Where to start (4 minutes)

1. Skim [README.md](README.md) — top of file is enough.
2. Look at [spec/02-data-model/three-levels.md](spec/02-data-model/three-levels.md) — understand L1/L2/L3.
3. Look at [spec/02-data-model/sections.md](spec/02-data-model/sections.md) — understand the section schema.
4. Look at [spec/08-portability/host-contract.md](spec/08-portability/host-contract.md) — understand what's pluggable.

That's enough to start contributing without breaking the architecture.

---

## Where to NOT start

- **Don't** open `adapters/` first. They're profit-step-specific and will
  bias your understanding toward Firebase / MUI specifics.
- **Don't** open the entire `spec/` tree. There are ~25 files; you'll burn
  context. Use the README's "Reading order" table to pick what's relevant
  to your task.
- **Don't** start coding before checking
  [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md).
  Several core decisions are still TBD; if your task touches one, stop and
  ask Denis.

---

## What lives where (when code is added)

```
wiki-v2/
├── domain/                  # Pure TS, zero Firebase/MUI deps. Section
│                            # types, level enum, validation rules.
├── ports/                   # Interfaces the host must satisfy.
├── application/             # Use cases (orchestration). e.g. EnhanceSection,
│                            # RollupWiki, CaptureFromVoice.
├── adapters/
│   ├── firestore/           # profit-step Firestore impl
│   ├── http/                # Express routes
│   ├── anthropic/           # AI helper impl
│   ├── vertex-search/       # cross-wiki search impl
│   └── telegram-capture/    # voice/photo intake from existing bot
├── ui/
│   ├── components/          # React components — depend ONLY on domain types
│   └── hooks/
├── shared/                  # constants, fixtures, utility types
├── tests/
└── spec/                    # this directory — pure docs
```

If you find yourself writing Firebase-specific code in `domain/` —
**stop**. That violates the portability contract. Move it to `adapters/`.

---

## Common task recipes

### "Add a new section type"

1. Define the section schema in
   [spec/02-data-model/sections.md](spec/02-data-model/sections.md) under a
   new heading. Specify fields, required vs optional, examples.
2. Add the type to `domain/SectionSchema.ts` (when code lands).
3. If the section needs AI enhancement support — extend
   [spec/07-ai-features/enhance-section.md](spec/07-ai-features/enhance-section.md)
   with the prompt template.
4. Update [spec/10-decisions/decision-log.md](spec/10-decisions/decision-log.md).

### "Add a new capture flow"

1. Document the flow in `spec/03-capture-flows/<flow-name>.md`.
2. Define the input shape — what the host bot sends in.
3. Define which sections it can write to (validation).
4. Define audit / undo semantics.
5. Implement the application use case in `application/CaptureFromX.ts`.

### "Add a new AI helper"

1. Document in `spec/07-ai-features/<feature>.md` — prompt, input shape,
   structured output, rate limit, audit log shape, undo path.
2. Implement application service `application/EnhanceX.ts`.
3. Implement `adapters/anthropic/EnhanceXAnthropic.ts`.
4. Wire to UI via a port (no direct adapter→UI imports).

### "Migrate from v1 wiki"

DO NOT touch `tasktotime/` v1 wiki code. Migration is a separate one-shot
script — see
[spec/04-storage/migration-from-v1.md](spec/04-storage/migration-from-v1.md).
Migration is idempotent; running it twice is a no-op.

---

## Hard rules

- **`domain/` and `ports/` import nothing from `firebase`, `firebase-admin`,
  `@mui/material`, `react`, or any profit-step-specific path.** Enforced by
  ESLint rule (when added). Breaking this kills portability.
- **Every adapter has a contract test** in `tests/adapters/<name>.test.ts`
  that verifies the port contract, not the implementation details.
- **AI helpers have audit + undo.** Every AI write is reversible from the UI
  for at least 24 hours. Mirror the pattern from
  `tasktotime/AiDecomposeDialog`.
- **Capture flows are idempotent.** A retry of voice/photo upload must not
  duplicate the section entry. Use `idempotencyKey` (mirror tasktotime
  pattern).
- **Section writes are atomic.** Patching `Materials.items[2]` does not
  rewrite the entire section. Required for concurrent agent + human edits.

---

## When in doubt, ask

If a decision is not in [spec/10-decisions/decision-log.md](spec/10-decisions/decision-log.md):

1. First check [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md)
   — it might be there pending an answer.
2. If yes, do not invent a default. Stop and ask Denis.
3. If no, add it to `open-questions.md` with options + your recommendation,
   then ask Denis.

The cost of a wrong architectural default in a portable module compounds —
every other project that ships wiki-v2 inherits it. Slowing down to ask is
correct.
