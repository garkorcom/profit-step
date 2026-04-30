---
title: 10.1 Open Questions
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Open Questions for Денис

These need answers before Phase A coding starts. Each has options + a
recommendation. Денис fills in the answer; agent records it in
[decision-log.md](decision-log.md) and updates the relevant spec files.

> **Process:**
> 1. Денис picks an option (or describes a different answer).
> 2. Agent moves the question from this file to `decision-log.md` with
>    full rationale.
> 3. Agent updates affected spec files to reflect the decision.

---

## Q1 — L3 scope: per-company or platform-wide?

**Question:** When we ship "company knowledge" (L3), is it siloed per
tenant (each company sees only their own) or shared across all profit-step
tenants (anonymised)?

**Options:**
- **(a) Per-company.** Strict isolation, mirrors current Firestore RLS.
  Recommended.
- **(b) Platform-wide opt-in.** Tenants can opt-in to share lessons /
  procedures, get back anonymised cross-tenant insights. Big privacy /
  legal lift.
- **(c) Hybrid — Денис's company is "founder", others are siloed.**
  Денис gets cross-tenant view, no one else.

**Recommended:** (a). Simpler RLS, no privacy concerns, no extra UX. We
can always loosen later.

---

## Q2 — Project archive behavior

**Question:** When a project is archived, what happens to its L1 wiki?

**Options:**
- **(a) Archive too — read-only, hidden from default search.**
- **(b) Stay live and searchable.** Becomes part of institutional memory.
- **(c) Roll up key sections into L3 then archive.**

**Recommended:** (b) by default + (c) for `Selections`, `Decisions`,
`Lessons` rolled up to L3 on archive.

---

## Q3 — L2 task templates from L3

**Question:** Can L2 task wikis pre-fill from a template stored in L3?

**Example:** "Bathroom rough-in" template at L3 → new task with that name
auto-creates L2 wiki with sections pre-populated from the template.

**Options:**
- **(a) Yes, with explicit "Apply template" button at task creation.**
- **(b) Yes, automatically when task name matches a template by exact
  string match.**
- **(c) Yes, with AI fuzzy match on task name.**
- **(d) No, keep L2 always blank.**

**Recommended:** (a). Predictable, explicit, no surprises.

---

## Q4 — Custom section keys for hosts

**Question:** Can a host project register their own section keys
(e.g. a medical SaaS adds `patientHistory`)?

**Options:**
- **(a) Yes, via `registerSectionKind()` at composition root.**
- **(b) No — fixed canonical set, fork wiki-v2 if host needs more.**

**Recommended:** (a). Improves portability story without much complexity.

---

## Q5 — `clientVisible` granularity

**Question:** Is `clientVisible` set at the section level or per-entry
inside the section?

**Options:**
- **(a) Section-level only.** Whole `Materials` section is either visible
  to client or not.
- **(b) Per-entry inside structured sections.** Each `MaterialEntry` has
  its own `clientVisible` flag; the section gets aggregated visibility
  ("show section if any entry is visible").
- **(c) Both. Section-level flag is default; per-entry flag overrides.**

**Recommended:** (c). Section default keeps simple cases simple; per-entry
override unlocks "show client only the high-end fixtures, hide the basic
hardware" flows.

---

## Q6 — `internalOnly` vs `clientVisible`

**Question:** Are `internalOnly` and `clientVisible` redundant? They're
"opposite" markers.

**Options:**
- **(a) Keep both.** `clientVisible: false` is "hide for now"; `internalOnly: true`
  is "never share, ever — internal note only".
- **(b) Replace both with single enum `visibility: 'internal' | 'team' | 'client'`.**

**Recommended:** (b). Cleaner, less confusing. Migration is trivial since
they're new fields anyway.

---

## Q7 — Capture flow audit retention

**Question:** How long do we keep the raw audio / photo blobs for capture
flows (voice / photo / receipt)?

**Options:**
- **(a) 90 days then delete blob, keep transcribed/extracted result.**
- **(b) Forever (until project archived).**
- **(c) Configurable per-tenant.**

**Recommended:** (a). 90 days covers debugging window; storage cost
predictable.

---

## Q8 — AI provider for enhance

**Question:** Which model behind `AnthropicEnhancePort`?

**Options:**
- **(a) Claude Sonnet 4.6 (fast, cheap, good enough).**
- **(b) Claude Opus 4.7 (slower, pricier, best output).**
- **(c) Anthropic Haiku for short sections, Sonnet for long.**

**Recommended:** (c). Token cost matters at scale; Haiku is fine for "fix
typos in 200 chars" but Opus is overkill there. Sonnet for everything else.

---

## Q9 — Cutover window for v1 → v2

**Question:** When do we cut over existing tasktotime wikis to v2?

**Options:**
- **(a) After Phase A only — both coexist briefly.**
- **(b) After Phase D (L1 done, foreman flows ready) — biggest visible win.**
- **(c) After Phase G (client view ready) — full feature parity.**

**Recommended:** (b). After D, v2 is significantly better than v1. Cutover
UX is meaningful.

**Sub-question:** which weekend?
- 17-18 May 2026
- 24-25 May 2026 (Memorial Day weekend in US — long window for rollback)
- 31 May - 1 June

**Recommended:** 24-25 May 2026 if Phase A-D actually fit in 4 weeks from
GO; else 31 May.

---

## Q10 — Rollup automation

**Question:** L2 → L3 rollup on task accept — fully automatic, or PM
review step?

**Options:**
- **(a) Fully automatic on `task.lifecycle: accepted`.**
- **(b) Queued for PM review — Денис clicks "Promote to company knowledge"
  to actually write to L3.**
- **(c) Auto for `Lessons`, manual for `Materials`/`Vendors`.**

**Recommended:** (b). L3 is permanent institutional memory; junk content
poisoning it long-term is worse than slow promotion. PM review is a
Sunday-morning ritual.

---

## Q11 — Telegram capture confirmation

**Question:** When the Telegram bot receives voice/photo and AI suggests a
section, does it write immediately or wait for foreman confirmation?

**Options:**
- **(a) Write immediately, undo via `/undo` bot command for 1h.**
- **(b) Always confirm: "Save as Materials? [Yes/No]" inline reply
  buttons.**
- **(c) Confidence-gated: ≥0.8 confidence → write; <0.8 → confirm.**

**Recommended:** (b) for v1 of capture. Feels safer for foreman, lower
cognitive load than "wait, did that get saved or not?". Move to (c) once
we have 200+ confirmed events to calibrate confidence thresholds.

---

## Q12 — Search cost / index update cadence

**Question:** Embedding compute is the priciest AI op. Update cadence?

**Options:**
- **(a) On every save — instant search freshness, max cost.**
- **(b) Async via Pub/Sub queue, ~30s freshness, much lower cost.**
- **(c) Daily batch at 03:00 EST — cheapest, but stale during workday.**

**Recommended:** (b). 30s freshness is fine for "find similar past quotes"
queries. Pub/Sub queue mirrors the `recomputeCriticalPath` pattern from
tasktotime.

---

## Process for new questions

When you (agent) hit a decision point not in this list:

1. **Don't invent a default.** Add it here as Q13+ with options + your
   recommendation.
2. Ask Денис.
3. Once answered, move it to `decision-log.md` and update affected files.
