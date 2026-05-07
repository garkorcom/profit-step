---
title: 7.2 Rollup L2 → L3
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase E)
---

# Rollup — L2 task lessons → L3 company knowledge

When a task is accepted (lifecycle `accepted`), key sections from L2 get
promoted to L3 so they accumulate as institutional memory.

## Sections promoted

Default set:
- `lessons` — markdown content merged into L3 `lessons` aggregate.
- `materials` — vendor / cost data merged into L3 `pricingRef` and L3
  `vendors` aggregate.

Per Q10, promotion is **review-gated** by default — Денис clicks
"Promote to company knowledge" rather than auto-promote on every
acceptance.

## Pipeline

`application/RollupWiki.ts`:

1. Load L2 wiki by task id.
2. Load existing L3 wiki for company.
3. For each promoted section:
   - Call AI to merge new entries with existing L3 content
     (deduplication, summarisation).
   - Produce a proposal (preview).
4. PM reviews preview, clicks Apply → `PatchSection` on L3 with
   `actor: { kind: 'agent', agentId: 'rollup' }`.
5. Mark L2 section `rolledUpToL3At: <timestamp>` so we don't promote it
   twice.

## AI merge prompt (sketch)

```
You are merging task-specific knowledge into a company-wide knowledge
base.

Existing L3 {sectionKey} content:
{existingL3Body}

New L2 task knowledge to merge:
{newL2Body}

Task context: {taskTitle}, project {projectName}.

Produce an updated L3 {sectionKey} body that:
- Preserves all unique information from both sources.
- Deduplicates (e.g. if a vendor is already in L3, don't add again —
  enrich the existing entry).
- For lessons: group similar lessons, abstract specifics ("on Smith
  bathroom we…" → "for bathrooms, watch out for…").
- For pricing: keep specific data points but tag with project.
```

## Auto-promotion (Q10 alternative)

If Q10 lands on (a) — fully automatic — wire a Firestore trigger on
`tasktotime_tasks` lifecycle change:
- `lifecycle: accepted` → publish to Pub/Sub topic `wiki-rollup-queue`.
- Subscriber runs `RollupWiki` use case.
- Idempotency via `(taskId, sectionKey)` reservation.

## Acceptance (Phase E)

- Pilot: 10 closed tasks, manual review of each rollup proposal.
- ≥80% of proposals accepted without modification.
- L3 `lessons` content stays clean (no duplicate entries, abstraction
  level reasonable) after 3 months.
- Денис uses L3 `pricingRef` for ≥1 quote / week.
