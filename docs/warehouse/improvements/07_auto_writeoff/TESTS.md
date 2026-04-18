# Auto-writeoff — Tests

- ✓ task.started → draft issue < 3 сек
- ✓ Draft has projectId + phaseCode from task
- ✓ Norm lookup: install_outlet × 3 → {outlet:3, wire:15, box:3, wirenut:9}
- ✓ Confirm → posted with ledger entries
- ✓ Edit qty → draft updated → post uses new qty
- ✓ Actual vs planned reconciliation на complete
- ✓ Overrun > 25% + $50 → anomaly event
- ✓ Van shortfall → partial draft + auto-transfer proposal (improvement 04)
- ✓ No norm → no draft, warning event
- ✓ Task cancelled → draft voided

**2026-04-18** — v1.0.
