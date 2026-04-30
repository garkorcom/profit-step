---
title: 7.1 Enhance Section — primary AI helper
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase B)
---

# Enhance Section — "Дополни wiki"

Most-used AI helper. PM / foreman clicks `✨ Enhance` on a section →
backend calls Anthropic with current section + context → returns proposed
new body → user previews diff → applies or discards.

## Use case

`application/EnhanceSectionWithAI.ts`:

1. Load current `Section` from `WikiRepositoryPort`.
2. Gather context: `EnhanceContext { taskTitle, taskDescription,
   projectKb, recentBlockers }` from caller's request.
3. Call `AnthropicEnhancePort.enhance({ section, context, style })`.
4. Return `{ proposedBody, rationale, confidence, diff }` to caller.
5. Audit event: `kind: 'enhance-proposed'`. Note: no write yet.
6. UI: render diff, user clicks `Apply` → `PatchSection` use case fires
   with `actor: { kind: 'agent', agentId: 'enhance-anthropic' }`.

## Prompt template (sketch)

```
You are a knowledge-management assistant for a construction CRM. The
user has a wiki section of type "{sectionKey}" with the following
content:

{currentSectionBody}

Context:
- Task: {taskTitle}
- Description: {taskDescription}
- Recent blockers: {blockers}
- Project KB highlights: {projectKb}

Your job: produce an improved version of this section. Rules:
- Keep all factual claims from the original; do not invent.
- Add structure (bullet lists, headings) only inside Markdown sections.
- For typed sections (materials/decisions/blockers/photos), produce
  structured JSON matching the section schema.
- Style: {concise|detailed}.

Return JSON: { proposedBody, rationale, confidence (0..1) }.
```

Per-section variants will be authored in Phase B prompts directory:
`wiki-v2/adapters/anthropic/prompts/enhance-{sectionKey}.txt`.

## Rate limits

- 30 enhance / hour / user
- 1000 / day / tenant
- 1 concurrent / wiki (no parallel enhances on the same wiki)

## Provider choice

Per Q8: Haiku for short (<500 chars in body), Sonnet for medium, Opus
for long / high-stakes (`L1` `client` section). Adapter selects based on
section size + level.

## Undo

Every applied enhance writes both an audit event AND the previous body
in `section_history`. Undo within 24h is one click — restores
previous body via `RestoreSection`.

## Anti-pollution rules

- Never auto-apply. Always show preview + require explicit user action.
- Detect content drift: if proposed body removes >50% of the original
  text, force user to scroll through full diff before applying.
- If `confidence < 0.5`, show warning banner.

## Acceptance (Phase B)

- Денис uses enhance on 5 different section types in pilot week.
- ≥70% of proposals applied without modification.
- 0 cases of irreversible loss (all undos work).
- Token cost <$5 / day at pilot usage.
