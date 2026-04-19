# Estimate Procurement — Tests

- ✓ 50-line estimate → plan < 30 сек
- ✓ All 5 buckets populated correctly
- ✓ Internal allocation → reservations created
- ✓ 2 vendors → 2 draft POs (grouped)
- ✓ Quote needed → RFQ queued (improvement 10)
- ✓ Unmatched → web search queued (improvement 09)
- ✓ Event `procurement_plan_ready` published
- ✓ Estimate re-publish → incremental plan update
- ✓ All items in stock → no external, "all ready"
- ✓ User confirm → reservations committed, POs ready-to-send

**2026-04-18** — v1.0.
