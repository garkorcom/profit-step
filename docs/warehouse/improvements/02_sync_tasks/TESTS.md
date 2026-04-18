# Improvement 02 — Sync Tasks — Tests

- ✓ Task start event → draft issue create в < 3 сек
- ✓ Draft issue linked through `relatedTaskId`
- ✓ Worker confirm → post + ledger entries
- ✓ Task complete → reconciliation: actual == plan → OK
- ✓ Task complete с overrun → adjustment created + anomaly event
- ✓ Task cancel → draft voided, reservation released
- ✓ Insufficient stock → warehouse.insufficient_stock event → task blocked
- ✓ Task без norm → skip (no draft), warning logged
- ✓ Multiple tasks parallel → independent drafts

**2026-04-18** — v1.0.
