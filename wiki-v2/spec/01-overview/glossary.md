---
title: 1.5 Glossary
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Glossary

Terms used across wiki-v2 spec files.

| Term | Definition |
|---|---|
| **Wiki** | A document of `Section[]` scoped to one owner at one level. |
| **Level** | One of `L1` (project KB), `L2` (task wiki), `L3` (company knowledge). |
| **Section** | A typed subdivision of a wiki — `Materials`, `Decisions`, `Photos`, etc. |
| **Section key** | Stable identifier for a section type — `materials`, `decisions`, etc. |
| **Section body** | The structured content inside a section; shape depends on key. |
| **Owner** | The entity a wiki is scoped to — `projectId` / `taskId` / `companyId`. |
| **Wiki key** | Composite identifier — `(level, ownerId, companyId)`. |
| **Capture flow** | A path to write into a section without typing — voice, photo, receipt. |
| **AI helper** | A use case that uses an LLM to write or transform a section. |
| **Enhance** | The most-common AI helper — given current section + context, propose a better body. |
| **Rollup** | L2 → L3 promotion of `lessons` (and selected sections) on task accept. |
| **View mode** | Presentation layer for the same data — PM / Foreman / Client / Agent. |
| **Port** | A typed interface the host must implement (e.g. `WikiRepositoryPort`). |
| **Adapter** | A concrete implementation of a port (e.g. `FirestoreWikiRepository`). |
| **Composition root** | Where the host wires adapters into use cases at startup. |
| **Use case** | An application service that orchestrates ports + domain logic. |
| **Audit event** | A log entry recording who did what to which section, with diff. |
| **Inheritance banner** | UI element showing parent-level context read-only on a child wiki. |
| **`clientVisible`** | Section flag; if true, section appears in client portal view. |
| **`internalOnly`** | Section flag; if true, section never leaves internal team. |
| **Idempotency key** | Per-write UUID; backend dedupes repeats. |
| **Schema version** | Per-section integer; bump on breaking body changes. |
| **L1 / L2 / L3** | Shorthand for the three levels. See [three-levels.md](../02-data-model/three-levels.md). |
| **PM view** | View mode for owner / project manager — full edit. |
| **Client view** | View mode for end client — filtered to `clientVisible`. |
| **Agent view** | Structured JSON returned to AI agents via REST. |
| **Foreman view** | Mobile-friendly view focused on assigned task + materials. |
| **Tenant** | One company in profit-step's multi-tenant Firestore. |
| **Host project** | A project consuming wiki-v2 as a package (profit-step today, others future). |
| **Tenant isolation** | RLS guarantee that wikis from one company are unreachable from another. |
| **Section history** | Subcollection storing all past versions of a section for audit + undo. |
