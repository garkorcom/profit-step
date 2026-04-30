---
title: 2.1 Three Levels of Knowledge
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Three Levels of Knowledge — L1 / L2 / L3

`wiki-v2` data is organised into three scope levels. Same shape (`Wiki` →
`Section[]`), different scope, different lifecycle, different writers.

| Level | Name | Scope | Owner type | Lifetime |
|---|---|---|---|---|
| **L1** | Project KB | One project | `projectId` | Lives as long as the project; archived on closeout |
| **L2** | Task wiki | One task | `taskId` | Lives as long as the task; rolls up to L1 / L3 on accept |
| **L3** | Company knowledge | One company tenant | `companyId` | Permanent; institutional memory |

## L1 — Project Knowledge Base

**One per project.** Pre-existing CLAUDE.md mention:
> "Project Knowledge Base — централизованное хранилище нефинансовой
> информации по проекту (команда, доступы/ключи/пароли, техдокументация,
> предпочтения клиента, permits)"

### Standard sections for a construction project

| Section | What goes here |
|---|---|
| `Address` | Site address, gate code, parking notes, lockbox combo |
| `Client` | Name, phone, preferences, allergies (e.g. low-VOC paint) |
| `Brigade` | Foreman, electrician, plumber, painter — names + phones + role tags |
| `Permits` | Permit numbers, inspection dates, contact at city office |
| `Selections` | Tile, paint, fixtures, hardware — chosen + alternates with photos |
| `Baseline photos` | Before-state photos by room |
| `Decisions` | Major decisions chronologically with rationale |
| `Notes` | Free markdown for anything else |

### Who writes

- **Денис** at project initiation (during contract / first site visit).
- **AI auto-fill** from estimate document and contract (Phase B+).
- **Foreman via Telegram** for baseline photos and selections.
- **Client via portal** for selection approvals (Phase G).

### Who reads

- Денис (PM view): all sections.
- Foreman: `Address`, `Brigade`, `Selections`, `Permits`.
- Client: `Selections`, `Decisions`, `Baseline photos` (filtered to
  `clientVisible: true` only).
- AI agents: full structured JSON via REST.

## L2 — Task wiki

**One per task.** This is the closest thing to v1 wiki today.

### Standard sections for a construction task

| Section | What goes here |
|---|---|
| `Materials` | Materials used + qty + vendor + cost |
| `Decisions` | Decisions made during this task |
| `Blockers` | Issues hit, when, how resolved |
| `Photos` | Process photos chronologically |
| `Lessons` | What we learned (gets rolled up to L3) |
| `Notes` | Free markdown |

### Who writes

- **Foreman via Telegram** — voice / photo / receipt → auto-suggested
  section.
- **Денис** in web editor for plan / context.
- **AI Decompose** seeds initial sections when a task is created from
  estimate.
- **AI Enhance** suggests improvements per section.

### Who reads

- Денис, foreman, subcontractor assigned to task.
- Client (filtered) — only sections / entries marked `clientVisible: true`.
- AI agents — for context when generating outputs.

### Lifecycle hooks

- On `task.lifecycle: completed` → `Lessons` section is highlighted in UI
  for foreman to fill in if empty (gentle nudge, not blocking).
- On `task.lifecycle: accepted` → `Lessons` rolled up to L3 (see
  [spec/07-ai-features/rollup.md](../07-ai-features/rollup.md)).
- On `task.archived` → wiki archived but readable for 12 months.

## L3 — Company knowledge

**One per company (tenant).** This is the long-term memory.

### Standard sections

| Section | What goes here |
|---|---|
| `Vendors` | Vendor list with contact / preference / cost notes |
| `Subcontractors` | Subcontractor pool with role tags / past projects |
| `Procedures` | "How we do X" — bathroom rough-in checklist, framing
inspection prep |
| `Pricing reference` | Past quote prices by category / size |
| `Lessons` | Aggregated lessons from completed tasks |
| `Notes` | Free markdown |

### Who writes

- **Auto-rollup** from L2 `Lessons` on task acceptance.
- **Денис manually** for `Procedures` and `Pricing reference`.
- **AI** consolidates duplicates ("3 lessons all about the same supplier")
  on a weekly cron.

### Who reads

- Денис and any future PMs in the company.
- AI agents for cross-project queries ("similar bathrooms").
- NOT clients. NOT foremen by default.

### Special property — search-first

L3 is the primary index for cross-wiki search (Phase F). Embeddings live on
every L3 section. Queries like "permit fee Tampa" or "epoxy garage floor
process" hit L3 first, then drop to L2 if no match.

## Cross-level relationships

```
L3 Company knowledge
    ▲
    │ rollup on task accept
    │
L2 Task wiki (one per task)
    ▲
    │ context inherit (read-only banner)
    │
L1 Project KB
    ▲
    │ context inherit (read-only banner)
    │
[task / project pages in CRM]
```

- L1 inherits no parent — top of project tree.
- L2 inherits L1 context: a `<Inherited from project>` banner shows the
  relevant sections from L1 (Address, Brigade, Permits) read-only.
- L3 has no inheritance; it's company-wide.

## Section identity is stable across levels

A section called `Materials` has the same wire shape at L1, L2, L3. This is
why agents can write generic code — "patch Materials section" works
everywhere.

The semantics differ:
- L1 `Materials` = project-wide expected materials baseline.
- L2 `Materials` = materials actually used on this task.
- L3 `Materials` = company-wide vendor preferences (this is closer to a
  catalog).

But the wire shape is the same `MaterialsSection { items: MaterialEntry[] }`.

## Open questions

See [spec/10-decisions/open-questions.md](../10-decisions/open-questions.md):
- Q1: Is L3 per-company or global across the whole platform?
- Q2: When a project is archived, does L1 archive too, or stay searchable
  as institutional memory?
- Q3: Can L2 inherit from a task template stored at L3?
