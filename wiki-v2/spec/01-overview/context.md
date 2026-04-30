---
title: 1.1 Context — why a new wiki module
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Context

## What `wiki-v1` looks like today

Lives inside `tasktotime/`:
- One `wiki` field on each task document.
- One `wiki_history` subcollection per task.
- MDXEditor on the web (lazy-loaded, ~590KB).
- Optimistic concurrency on save (409 conflict UI).
- Markdown content, free-form.
- Attachments uploaded to `companies/{companyId}/tasks/{taskId}/wiki/{filename}`
  (shipped in PR #113, deployed 2026-04-29).
- Standalone view at `/crm/tasktotime/wiki` + Wiki tab in task detail Drawer.

That covers the engineering primitive — "free-form markdown attached to a
task" — and works fine for any solo PM willing to sit at a desk and type.

## Why that's not enough for a construction CRM

profit-step is used by:

- **Денис** (PM, owner) — creates projects, quotes, dispatches brigades,
  closes out projects.
- **Foremen / brigades** — work on site, report progress, hit blockers, take
  photos. Communicate via Telegram bot, NOT the web app.
- **Subcontractors** — get assigned tasks, occasionally read instructions,
  report completion.
- **Clients** — view portal, approve decisions, see photos, pay invoices.
- **AI agents** (Claude, the `@crmapiprofit_bot`, future agents) — answer
  questions, draft documents, decompose estimates.

Each of these audiences interacts with knowledge differently. The current
wiki serves only the desk-bound PM persona well.

## Five concrete business gaps

### Gap 1 — Project information is scattered

Today the answer to "what's the gate code on 412 Main St?" lives in:
- The estimate PDF (if anyone remembered to fill it in)
- A WhatsApp message thread with the client
- Денис's head
- Maybe a contact note

There is no "project knowledge base" page that aggregates client preferences,
permits, gate codes, brigade assignments, baseline photos, materials picked,
and so on. The TZ for this exists in `CLAUDE.md` ("Project Knowledge
Base — централизованное хранилище нефинансовой информации по проекту") but
hasn't been implemented.

### Gap 2 — Capture is hostile to field workers

A foreman in a basement does not type Markdown. The only realistic capture
modes for the field are:

1. **Voice note** — "had to swap the 3/4 PEX for 1/2 because the existing
   manifold ports were 1/2, used 30ft from truck stock, picked up 20ft more
   from Home Depot at 4pm".
2. **Photo** — pic of the rotten subfloor we found.
3. **Receipt photo** — Home Depot purchase that needs to be expensed.

Today none of those land in the wiki. They sit in the Telegram bot history,
sometimes get parsed by `onWorkerBotMessage`, and rarely surface in any
permanent record.

### Gap 3 — Cross-task lookup doesn't exist

Денис is quoting a new bathroom and wants to answer: "what did I quote for
the last three bathroom remodels?" Today he has to click through 3-4
projects, find the relevant tasks, scroll through their wiki/notes manually.
There is no "search across all wikis" anywhere.

This costs measurable time per quote and increases pricing variance —
without quick reference, prices drift over months.

### Gap 4 — Client has no window into the wiki

Decisions about tile, paint, fixtures, layout — the things that DRIVE
construction — happen in WhatsApp messages or in-person conversations.
Almost none of those decisions land in the wiki. When a decision is
challenged later ("I never approved that!"), there's no audit trail.

The portal exists, but it shows numbers (estimate, payments) — not
decisions, not photos, not narrative. Wiki could be the place that fills
that gap, but only if there's a client-facing view mode.

### Gap 5 — Markdown ≠ structure

Today's wiki content is whatever the writer typed. Some tasks have a
`### Materials` heading; many don't. Some list quantities; many don't. Even
finding "all wikis that mention Home Depot" requires full-text search over
unstructured strings — fine for grepping but useless for analytics like
"average Home Depot spend per project".

A schema-driven section model unlocks all of: cross-task analytics, AI
auto-fill, structured client views, and templated input forms.

## What v2 must do that v1 cannot

| Capability | v1 | v2 |
|---|---|---|
| Per-task notes (markdown) | ✅ | ✅ |
| Project-level KB | ❌ | ✅ (L1) |
| Company-wide knowledge | ❌ | ✅ (L3) |
| Voice → wiki | ❌ | ✅ (capture flow) |
| Photo → wiki section | ❌ | ✅ (capture flow) |
| Receipt OCR → Materials | ❌ | ✅ (capture flow) |
| Cross-wiki search | ❌ | ✅ (RAG / Vertex) |
| Section-level analytics | ❌ | ✅ (schema-driven) |
| Client view mode | ❌ | ✅ (perms + portal) |
| Agent-friendly REST | partial | ✅ (per-section CRUD) |
| Portable to other projects | ❌ | ✅ (hexagonal extract) |

## Non-goals (Phase 0)

- Replace `tasktotime/` itself. v2 is the knowledge layer; tasktotime owns
  task lifecycle, scheduling, dependencies.
- Build a CMS. We are not doing rich-text dragon: tables, code blocks,
  embeds beyond what MDXEditor already supports.
- Build a generic note-taking app. Sections are workflow-oriented, not
  free-form folders.
- Replace Telegram bot. Bot gains capture handlers but remains the same bot.

## Reference

- `tasktotime/spec/08-modules/wiki/` — the v1 spec (per-task wiki).
- `tasktotime/spec/08-modules/wiki-rollup/` — partial inspiration for L3
  rollup.
- `CLAUDE.md` "Project Knowledge Base" mention — the L1 origin story.
