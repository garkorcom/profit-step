---
title: 6.1 View modes
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase D + G)
---

# View modes — same data, different presentation

Four view modes render the same wiki sections with different filters and
layouts.

## PM view

**Audience:** Денис and any future PMs.
**Access:** full read + write across all sections + all levels.

Layout:
- Left: tree of all wikis (L1 projects → L2 tasks). L3 in separate tab.
- Right: section list, edit-in-place per section.
- Top: search box (Phase F), AI helper buttons.

Same look-and-feel as v1 standalone wiki, extended with section-typed
editors.

## Foreman view

**Audience:** assigned foreman / brigade lead.
**Access:** read all of L2 of assigned tasks; read filtered L1
(`address` / `brigade` / `permits` / `selections`); no L3.

Layout (mobile-first):
- Top: current task name + lifecycle.
- Cards: `Materials` (checklist style with ✅), `Blockers` (with quick
  "report new" CTA), `Photos` (gallery + camera CTA), `Notes`.
- Inherited L1 banner: collapsed by default, "tap to expand" — shows
  Address, Brigade contacts, current Selections.

Capture flows (voice / photo / receipt) are the primary write path —
foreman doesn't open editor unless they tap "edit" on a section.

## Client view

**Audience:** end client (homeowner).
**Access:** read-only of sections / entries with `clientVisible: true`
AND `internalOnly: false`.
**Where:** rendered inside portal at
`/portal/{companyId}/projects/{projectId}/wiki` and
`/portal/{companyId}/tasks/{taskId}/wiki`.

Layout:
- Hero: project address + Денис's branded header.
- Cards: `Decisions` (with approve/comment if pending), `Photos`
  (timeline gallery), `Selections` (with photos), `Lessons` (only if
  marked client-friendly).
- NO `Materials` (cost-leak), NO `Blockers` by default, NO `Notes`.
- Comments: client can comment on `Decisions` entries (writes to
  `decisions[].clientComment`).

Per Q5, sections / entries can be selectively shown.

## Agent view

**Audience:** AI agents (Claude, future copilots) consuming via REST.
**Access:** structured JSON via `GET /api/wiki-v2/wikis/:level/:ownerId`.
**Format:** machine-readable; no rendering layer.

Agents use this for:
- Pulling task context when generating outputs.
- Cross-wiki search via `GET /search`.
- Section-level edits via `PATCH .../sections/:key` with
  `actor: { kind: 'agent', ... }`.

The same endpoints serve all view modes; "view mode" is a UI concept,
not a separate API.

## Permission matrix (compact)

Per Q5 of [../10-decisions/open-questions.md](../10-decisions/open-questions.md),
visibility is section-level OR per-entry depending on the answer.
Provisional matrix assuming hybrid (Q5 option c):

| Section | PM | Foreman | Client | Agent |
|---|---|---|---|---|
| L1 `address` | RW | R | R | R |
| L1 `client` | RW | R | — | R |
| L1 `brigade` | RW | R | — | R |
| L1 `permits` | RW | R | — | R |
| L1 `selections` | RW | R | R (filtered) | R |
| L1 `baselinePhotos` | RW | R | R | R |
| L2 `materials` | RW | RW (capture-driven) | — | RW |
| L2 `decisions` | RW | R | R (filtered) | RW |
| L2 `blockers` | RW | RW | — | RW |
| L2 `photos` | RW | RW | R (filtered) | RW |
| L2 `lessons` | RW | RW | — | RW |
| L2 `notes` | RW | R | — | RW |
| L3 (any) | RW | — | — | RW |

`R` = read; `RW` = read+write; `—` = denied.

Render layer applies this matrix. Backend enforces via `AuthPort.hasPermission()`.
