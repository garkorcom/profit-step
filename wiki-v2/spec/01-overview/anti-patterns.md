---
title: 1.4 Anti-patterns — what wiki-v2 must NOT do
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Anti-patterns

Hard rules that any contributor (human or AI) must respect. Breaking these
breaks the architecture or business value of wiki-v2.

## Architecture anti-patterns

1. **`domain/` or `ports/` importing Firebase / MUI / React.** Kills
   portability. Enforced by ESLint + AST test.
2. **Adapter calling another adapter directly.** Adapters depend on ports
   and domain only — never on each other.
3. **UI calling adapters directly.** UI consumes use cases via React hooks.
   Bypassing them skips audit + invariants.
4. **Synchronous LLM calls in REST handlers.** Enhance / rollup are async
   workflows. Fast path returns 202 with a job id; UI polls or subscribes.
5. **Single huge `Wiki` document with all sections inline > 500KB.**
   Sections >100KB must be paginated; sections with thousands of items
   must split.

## Data model anti-patterns

6. **Free-form section keys.** The canonical set is fixed (or extended via
   `registerSectionKind`). No "let's just call it `notes2`" inline.
7. **Storing client-private data in `internalOnly` sections without an
   audit log entry.** Client visibility flips must be audited.
8. **Mixing different ownership scopes in one wiki.** One wiki belongs to
   one owner (project / task / company). No "this section is project-wide
   but lives in a task wiki" hacks.
9. **Mutating a section body in place.** All section writes go through
   `PatchSection` use case which produces an audit event.

## Capture flow anti-patterns

10. **Auto-applying high-confidence captures without confirmation in v1.**
    See open question Q11. Default to "ask first"; loosen later.
11. **Discarding raw audio / photo on capture failure.** Keep the input
    blob 90 days for debugging (see Q7).
12. **Capture flows that bypass the `AuditLogPort`.** Every capture event
    is auditable.

## AI feature anti-patterns

13. **AI helpers without rate limits.** A buggy retry loop can drain
    Anthropic credits in minutes. Enforce per-user + per-tenant limits.
14. **AI helpers without undo.** Undo is a user-facing button, not an admin
    SQL hack.
15. **AI helpers writing without `actor.kind: 'agent'` flag.** Pollutes
    audit log; user can't tell what was AI-generated.
16. **AI prompts that include the entire L3 wiki.** Token blow-up. Use
    EmbeddingPort + nearest-neighbour to select relevant context.

## Portability anti-patterns

17. **Hardcoding profit-step paths in `wiki-v2/ui/components/`.** UI
    consumes config via props, not by importing `src/firebase/...`.
18. **Adapters in `wiki-v2/adapters/` that hosts cannot replace.** Every
    adapter has a port; if you wrote an adapter without a port, fix the
    port first.
19. **Test fixtures that depend on profit-step's seeded data.** Tests use
    `wiki-v2/shared/fixtures/` only.

## UX anti-patterns

20. **Foreman-facing UI in English-only.** Multi-language toggle on UI
    text strings is required (RU + EN minimum).
21. **Client view that leaks `internalOnly` content.** Render layer
    explicitly filters.
22. **Edit conflicts that drop the local draft.** 409 conflict UI must
    let the user reload the latest and re-apply their diff.

## Process anti-patterns

23. **Skipping the open-questions doc.** When you hit a decision point,
    you write it down in `open-questions.md` and ask. You do not invent
    a default.
24. **PR without spec update.** New section keys, new capture flows, new
    AI helpers all require a spec doc update in the same PR.
25. **Implementing Phase B before Phase A is shipped.** Phase order
    matters; ports + domain types come first.
