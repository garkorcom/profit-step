---
title: 3.1 Capture Flows — overview
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Capture Flows — overview

A **capture flow** is any path that writes into a wiki section without
requiring the user to type Markdown. Capture flows are the primary input
mode for foremen in the field; manual editing is the fallback.

## Four flows shipped in v2

1. **Voice → Section** — voice note transcribed by `VoiceTranscriptionPort`,
   AI parses into structured section entries.
   See [voice-to-section.md](voice-to-section.md).
2. **Photo → Section** — image uploaded, `VisionTaggingPort` returns tags
   + suggested section, foreman confirms.
   See [photo-to-section.md](photo-to-section.md).
3. **Receipt OCR → Materials** — receipt photo, `OCRPort` extracts
   vendor / total / line items, suggested as `Materials` entry.
   See [receipt-ocr.md](receipt-ocr.md).
4. **Manual edit** — web MDXEditor, fallback for desk-bound flows.
   See [manual-edit.md](manual-edit.md).

## Common contract — every capture flow

Every flow goes through the same pipeline:

```
[Input source]              e.g. Telegram message, web upload
   │
   ▼
[Capture adapter]           VoiceIntakeAdapter / PhotoCaptureAdapter / ...
   │  (idempotency key, raw blob preserved)
   ▼
[Extraction port]           VoiceTranscriptionPort / VisionTaggingPort / OCRPort
   │  (returns structured candidate)
   ▼
[CaptureFromX use case]     (application layer)
   │  - validates suggested section
   │  - applies confidence gating (Q11)
   │  - asks user confirmation if needed (Telegram inline button)
   │  - if confirmed: PatchSection
   │  - emits audit event
   ▼
[Wiki section updated]
```

## Hard rules for all capture flows

1. **Idempotent.** Retries (network blip, bot timeout) MUST NOT duplicate.
   Use `idempotencyKey` derived from message-id + timestamp.
2. **Audit every event.** AuditLogPort records the capture, the
   suggested section, the user's confirmation, the final write.
3. **Raw input preserved 90 days.** See open question Q7. Audio / image
   blobs in Storage with TTL.
4. **Confirmation required in v1.** Q11 — confidence-gated auto-apply
   comes in v2 of capture, after we have calibration data.
5. **Failure path = no write.** If extraction fails, capture flow notifies
   the user ("could not parse, please try again or type manually") and
   does NOT fall back to writing raw transcript / unstructured blob.

## Per-section capture support

Not every section accepts every flow:

| Section | Voice | Photo | Receipt | Manual |
|---|---|---|---|---|
| `materials` | ✅ | — | ✅ | ✅ |
| `decisions` | ✅ | ✅ (decision photo) | — | ✅ |
| `blockers` | ✅ | ✅ (blocker photo) | — | ✅ |
| `photos` | — | ✅ | — | ✅ |
| `lessons` | ✅ | — | — | ✅ |
| `notes` | ✅ | — | — | ✅ |
| L1 `address` / `client` / `brigade` / `permits` / `selections` | ✅ | partial | — | ✅ |

Voice covers everything because spoken instructions can describe any
section. Photo is preferred for visual sections. Receipt is special-purpose
for `materials`.

## Telegram bot integration

The existing `onWorkerBotMessage` handler is extended (carefully — see
CLAUDE.md §2.2 about test coverage) to detect:

- Voice notes → invoke `CaptureFromVoice` use case
- Photos → invoke `CaptureFromPhoto` use case
- Photos that look like receipts (heuristic: text-heavy, vertical) →
  invoke `CaptureFromReceipt`

The bot replies inline with section preview + `[Yes / No / Other section]`
buttons. Confirmed captures get written to the L2 wiki of whatever task
the foreman has currently "active" (per existing bot session).

## Out of scope for v1 of capture

- Real-time streaming voice (foreman's whole session as audio).
- Multi-image batches (drag-drop 20 photos at once).
- Email-to-wiki (forward an email → AI extracts → wiki section). Future
  capture flow #5.
- WhatsApp integration (different bot infrastructure; Telegram first).
