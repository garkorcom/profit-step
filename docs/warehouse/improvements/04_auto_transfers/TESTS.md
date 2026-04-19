# Auto-Transfer Agent — Tests

- ✓ Shortfall detection: worker с 2 outlet + 3 upcoming tasks requiring 9 → proposal qty 7
- ✓ Overstock rebalance: WH 300 wire, 3 vans с avg 50 → proposal from WH к lowest
- ✓ Site cleanup: task completed, site balance > 0 → transfer back proposal
- ✓ Telegram notification sent
- ✓ Worker accept → draft transfer status ready_for_review
- ✓ Worker decline → logged, no repeat for 24h
- ✓ Max 5/day throttling works
- ✓ Config disabled → cron no-op

**2026-04-18** — v1.0.
