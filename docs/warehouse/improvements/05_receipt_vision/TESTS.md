# Receipt Vision — Tests

- ✓ Parse Home Depot receipt (5 items) → matched 5, accuracy > 90%
- ✓ Parse Lowe's receipt
- ✓ Parse local supply receipt
- ✓ HEIC photo → converted to JPEG
- ✓ Receipt with poor quality → `receipt_unreadable`
- ✓ Non-receipt photo → `not_a_receipt`
- ✓ Idempotency: same photo → same docId
- ✓ Vendor detection: HD / Lowe's / unknown
- ✓ Unmatched items prompt clarification
- ✓ Active trip context → auto projectId attribution
- ✓ New item creation через clarification flow works

## 15 fixtures

`functions/test/fixtures/receipts/` содержит 15 real photos с expected parse output для regression tests.

**2026-04-18** — v1.0.
