---
title: 3.4 Receipt OCR → Materials
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase H)
---

# Receipt OCR → Materials

Foreman fotos receipt → OCR extracts structured fields → entry proposed
in `Materials` → foreman confirms → wiki updated. Optional: linked back
to task expense (BUT see [../10-decisions/what-not-to-do.md](../10-decisions/what-not-to-do.md)
for finance integration boundary).

## Pipeline

1. **Trigger:** photo classified as receipt (heuristic in
   [photo-to-section.md](photo-to-section.md)).
2. **OCR** via `OCRPort.parseReceipt({ imageUrl })`.
3. **Structured output:** `{ vendor, totalCents, items[], purchasedAt, confidence }`.
4. **Bot reply**: preview parsed entry, ask `[Save] [Edit] [Discard]`.
5. **On Save** → `CaptureFromReceipt` use case → `PatchSection` for
   `materials`.
6. **Audit event** with raw OCR confidence + raw image reference.

## Linking to finance

Two-stage approach:

- **Phase H:** wiki write only. Materials entry has `costCents` populated;
  not yet linked to finance ledger.
- **Phase H+1:** OPTIONAL link to `expenses` collection in finance via
  `ExpenseLinkPort` (host-provided). **Requires explicit Денис approval
  per `feedback_no_touch_time_finance` memory** — finance is production-
  critical; even a read-only link must be reviewed.

The link, if shipped, is unidirectional: wiki materials entry → expense
record. Editing the expense in finance does not retroactively update the
wiki.

## Vendor recognition

OCR returns vendor name; we map to canonical vendor entry in L3
`vendors` section. Cache the mapping per company so "Home Depot store
#5512" resolves to canonical "Home Depot" without re-asking.

## Acceptance criteria (Phase H)

- Pilot with 30 receipts (Home Depot / Lowes / Sherwin Williams).
- ≥85% extraction accuracy on `vendor` and `totalCents`.
- ≥70% line-item extraction accuracy.
- Foreman edits the parsed entry in <5% of confirmed receipts.
- Audit log allows reconstructing OCR'd fields if dispute later.
