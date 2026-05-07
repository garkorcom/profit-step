---
title: 1.2 Goals
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Goals — what wiki-v2 must achieve

## Primary outcomes (acceptance criteria for "v2 is shipped")

1. **PM can stop holding project info in their head.** All client prefs,
   permits, gate codes, brigade contacts live in L1 wiki and are
   findable in <5s from any project page.
2. **Foreman captures field events without typing.** ≥80% of L2 wiki
   writes originate from Telegram bot voice / photo / receipt within 6
   weeks of cutover.
3. **Денис finds prior reference instantly.** Cross-wiki search returns
   relevant hits in <500ms; Денис uses it for ≥1 quote per week.
4. **Client has visibility into decisions.** Portal renders client view
   of L1 + L2 with `Decisions` and `Photos`; Денис ships ≥1 client view
   link per project.
5. **Module is portable.** A second project (real or simulated) can
   integrate wiki-v2 in <1 week by implementing the 12 ports — proven
   by a contract test suite that any host runs against their adapters.

## Secondary outcomes

6. **Consistent structure across tasks.** Every L2 wiki has the same 6
   sections — section-level analytics ("avg Home Depot spend / project")
   becomes feasible.
7. **Audit trail for compliance.** Every wiki edit has an audit event
   reachable in <1 week's effort to extract for an external review.
8. **Agent-friendly REST.** AI agents (Claude, future copilots) read /
   write per-section without rewriting the whole wiki.
9. **Cheaper to run than v1 + manual workarounds.** Cost of capture flows
   (LLM calls, OCR, embeddings) under $50/month at current usage.

## Anti-goals

- **Not a CMS / blog.** No public posts, no SEO, no comments threads
  beyond what's needed for client decision approvals.
- **Not a chat replacement.** WhatsApp / Telegram still exist; wiki is
  the structured record, not the conversation.
- **Not a project management tool.** Tasks, schedules, dependencies live
  in `tasktotime/`. Wiki documents context, not progress.
- **Not a generic note-taking app.** Sections are workflow-typed, not
  free-form folders.

## Measurable success metrics (Phase D+ checkpoints)

| Metric | Target | How measured |
|---|---|---|
| L1 wikis created per active project | 100% | Auto-create on project creation |
| L2 wikis with ≥3 sections filled | 80% within 1 week of task start | Section count query |
| Foreman captures via Telegram | ≥80% of L2 writes | Audit log `actor.kind` |
| Cross-wiki search latency p95 | <500ms | Search adapter telemetry |
| Search usage | ≥1 query / Денис / day | Audit log of `searchWikis` use case |
| Client portal wiki views | ≥1 per project before final invoice | Portal access logs |
| AI helper usage rate | ≥30% of saves are AI-assisted | Audit log `actor.kind === 'agent'` |
| AI helper undo rate | <10% | Audit log + undo events |
| Capture flow false positives (wrong section suggested) | <15% | User correction events |

## Out of scope for v2 first ship

- Real-time collaborative editing (Google Docs style).
- Wiki templates marketplace (community-contributed templates).
- Native mobile apps — Telegram is the mobile path for now.
- Wiki-to-wiki linking with backlinks graph (Roam-style).
- Wiki versioning beyond audit log (no full git-like branch / merge).

These are not "never" — they're "not v1 of v2".
