# Sync Estimate — Tests

- ✓ estimate.published → procurement plan trigger → plan ready event
- ✓ Plan contains 4 buckets: internal / external / quote-needed / not-found
- ✓ Reservations created для internal-allocated items
- ✓ RFQ emails sent для quote-needed (see improvements/10)
- ✓ Vendor quote received → Estimate line update event
- ✓ Quick-price-lookup < 1 сек
- ✓ Estimate update → incremental plan adjustment

**2026-04-18** — v1.0.
