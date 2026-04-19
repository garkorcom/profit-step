# Vendor Email RFQ — Tests

- ✓ Send RFQ email via SendGrid (mock)
- ✓ Rate limit 5/day/vendor
- ✓ Dedupe same RFQ within 48h
- ✓ Inbound webhook parses sample responses (10 test emails)
- ✓ Gemini extracts items (accuracy > 80% на fixtures)
- ✓ `vendor_quote_received` event published
- ✓ Estimate agent receives event → updates line
- ✓ RFQ expires after 7d без reply → status closed_expired
- ✓ Vendor "out of stock" reply → items marked unavailable
- ✓ Spam inbound (no matching rfqId) → rejected

**2026-04-18** — v1.0.
