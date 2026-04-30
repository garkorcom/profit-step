---
title: 3.3 Photo → Section
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase C)
---

# Photo → Section capture flow

Foreman sends photo in Telegram → vision tagging → section suggested →
foreman confirms → wiki updated.

## Pipeline

1. **Trigger:** `onWorkerBotMessage` detects `photo` message type.
2. **Heuristic:** if photo looks text-heavy + portrait orientation, treat
   as receipt → defer to [receipt-ocr.md](receipt-ocr.md). Otherwise this
   flow.
3. **Idempotency key:** `tg:photo:<chat_id>:<message_id>`.
4. **Upload** to Storage at `wikis_v2/captures/photo/{idempotencyKey}.jpg`.
5. **Tag** via `VisionTaggingPort.tag({ imageUrl })` →
   `{ tags, suggestedSectionKey, confidence }`.
6. **Suggested mapping:**
   - tags include `defect|damage|cracked|leak` → `blockers`
   - tags include `materials|tools|fixture|tile|paint` → could be
     `materials` (or L1 `selections`)
   - generic process / progress photo → `photos`
7. **Bot reply** with inline buttons: `[Save as <suggested>] [Other] [Discard]`.
8. **On confirm** → `CaptureFromPhoto` use case → `PatchSection`.
9. **AI auto-caption (optional):** if confidence high, propose a one-line
   caption derived from tags. Foreman can override.
10. **Audit event** recorded.

## Sectional mapping detail

When the user picks "Other section", the bot offers a quick list of valid
section keys for that level. Selection writes a `PhotoEntry` (or section-
appropriate entry — e.g. for `blockers`, the entry has the photo URL +
asks "what's the issue?" follow-up).

## Acceptance criteria (Phase C)

- 50 photos sent in pilot, ≥40 land in correct section after foreman
  confirmation (>80%).
- Auto-caption rated useful in ≥30% of cases (foreman keeps it as-is).
- Photo URLs in section entries resolve via portal (signed URLs work,
  CORS works, lazy-load works).
