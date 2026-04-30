---
title: 7.3 Cross-wiki search (RAG)
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase F)
---

# Cross-wiki search — natural language over all wikis

`GET /api/wiki-v2/search?q=...` — natural language query over L1 / L2 / L3
wikis of the user's tenant.

## Indexing

Per [collections.md](../04-storage/collections.md):
- On every section save → enqueue embedding compute (Pub/Sub queue per
  Q12 — 30s freshness).
- Compute embedding via `EmbeddingPort.embed([sectionContentChunk])`.
- Upsert to `VectorSearchPort` with payload `{ wikiId, sectionKey, level,
  companyId }`.
- Chunking: section bodies > 1000 tokens get split into ~500-token chunks
  for granular retrieval.

## Query flow

1. User submits `?q="permit fee Tampa"`.
2. Compute query embedding.
3. `VectorSearchPort.query(vector, { topK: 20, filter: { companyId } })`.
4. Re-rank with cross-encoder (optional, Phase F+1).
5. Pull top hits' section bodies, build snippet around match.
6. Return `{ wikiKey, sectionKey, score, snippet }[]`.

## UI

`<WikiSearchBar />` mounted at top of wiki view + global search box in
main layout.
- Type query → debounced 300ms → fire search.
- Results card list: each result shows snippet + breadcrumb (project →
  task → section).
- Click → navigate to that section.

## Provider choice

Per [host-contract.md](../08-portability/host-contract.md), `EmbeddingPort`
+ `VectorSearchPort` are pluggable.
- Profit-step adapter: Anthropic embeddings + Vertex AI Search.
- Alternative: OpenAI embeddings + Firestore vector field (when stable).

## Cost gating

- Embedding compute on save is async (Pub/Sub) so user-facing save
  latency unaffected.
- Re-indexing existing wikis is a one-shot script
  (`scripts/index-existing-wikis.ts`).
- Per Q12, default cadence is 30s freshness via Pub/Sub.

## Cross-tenant safety

`filter: { companyId }` is set at the query layer (cannot be overridden
by client). Even if a malicious user crafts a bad query, vector search
returns hits filtered to their tenant.

## Acceptance (Phase F)

- p95 latency < 500ms for queries over 10k indexed sections.
- "permit fee Tampa" returns relevant hits.
- "epoxy garage floor" returns past garage floor tasks with relevant
  materials and lessons.
- No cross-tenant leak in security tests.
