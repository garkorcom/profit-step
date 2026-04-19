# Changelog

## 0.2.0 (2026-04-19)

### Added
- **`agent.inventory`** — InventoryDomain (Phase 2 of [PYTHON_SDK_SPEC](../../docs/tasks/PYTHON_SDK_SPEC.md)). Covers Warehouse V3 endpoints:
  - `catalog_list` / `locations_list` / `transactions_list` — RLS-scoped reads
  - `record_purchase` / `write_off` / `transfer` / `adjust` — typed write helpers around `POST /api/inventory/v3/transactions`
  - `commit` — escape hatch for custom transaction types
  - `recalculate` — admin-only journal replay
- Pydantic models: `CatalogItem`, `Location`, `Transaction`, `CreateTransaction`, `TransactionResult`, `ListCatalogParams`, `ListTransactionsParams`
- 10 new respx-mocked tests in `tests/test_inventory.py`

### Fixed
- Version drift between `pyproject.toml` (was stuck on 0.1.0) and `__init__.py` (said 0.2.0) — aligned to 0.2.0
- `client.py` User-Agent bumped 0.1.0 → 0.2.0

### Migration notes
- Backward-compatible — no breaking changes to existing domains
- `base_url` already supports `PROFIT_STEP_API_URL` env override (added in 0.1.0, docs clarified in 0.2.0)

## 0.1.0-beta (2026-04-17)

Initial public release.

### Added
- 8 domains: `tasks`, `time`, `costs`, `events`, `clients`, `projects`, `payroll`, `webhooks`
- `CRMAgent` root facade
- 3 auth modes: master key / impersonation / Firebase JWT
- `httpx` client with retry + rate-limit handling
- Pydantic models for every resource
- `psa` CLI entry point
- 3 runnable examples: smoke check, daily report, webhook subscriber
- 30 unit tests + CI workflow
