---
title: 3.5 Manual edit (web)
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Manual edit (web fallback)

The web editor is the fallback when capture flows aren't available or
when the user (typically Денис) wants direct control.

## Components

- `<SectionEditor>` per-section component. Each section type gets its own
  editor:
  - `materials` / `decisions` / `blockers` / `photos` → typed form
    (table-style for materials, decision-card for decisions, etc).
  - `lessons` / `notes` → MDXEditor (markdown).
- `<WikiPage>` standalone page at `/crm/wiki-v2/{level}/{ownerId}`.
- `<WikiTab>` embeddable in task / project detail drawers.

## Flow

1. User opens wiki page.
2. Picks section to edit.
3. Edits in section-specific form / markdown editor.
4. Save → `PatchSection` use case → optimistic concurrency on
   `expectedVersion`.
5. 409 conflict → reload latest, show diff, let user reapply.

## Differences from v1

- v1 was one MDXEditor for the whole wiki body — single text blob.
- v2 has per-section forms. `MaterialsEditor` is a React-Hook-Form table.
  `DecisionsEditor` is decision-card list. Markdown only inside
  `notes` / `lessons`.
- This makes section-level patch atomic and avoids the "edit whole wiki
  to add one row" problem.

## Voice trigger from web

A `mic` button in each editor header invokes the same voice capture
adapter — with the difference that the user is at a desk and the
suggested section is pre-determined (whichever editor they clicked the
mic in).

## Acceptance criteria (Phase A + B + manual UAT)

- Денис edits 5 different section types, save round-trips work.
- 409 conflict UI works when two tabs edit the same section.
- Voice button on web records → transcribes → fills the editor draft.
- All edits show up in audit log within 1s.
