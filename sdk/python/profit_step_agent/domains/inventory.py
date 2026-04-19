"""Inventory domain — warehouse, catalog, stock movements.

Covers V3 unified endpoints (POST /api/inventory/v3/transactions) plus the
backward-compatible GET endpoints for catalog/location browsing.

Example:
    from profit_step_agent import CRMAgent

    agent = CRMAgent(token="...")

    # Browse catalog + stock
    items = agent.inventory.catalog_list(category="materials")

    # Record a purchase (writes to journal + updates stock cache atomically)
    result = agent.inventory.record_purchase(
        catalog_item_id="wire_12awg",
        qty=100,
        unit_price=0.85,
        to_location="warehouse_main",
    )
    print(f"New stock: {result.stock_after}")

    # Write off for a task
    agent.inventory.write_off(
        catalog_item_id="wire_12awg",
        qty=40,
        from_location="vehicle_van_1",
        related_task_id="task_abc",
    )

    # Transfer atomically
    agent.inventory.transfer(
        catalog_item_id="wire_12awg",
        qty=20,
        from_location="warehouse_main",
        to_location="vehicle_van_1",
    )
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from profit_step_agent.models.inventory import (
    CatalogItem,
    CreateTransaction,
    ListCatalogParams,
    ListTransactionsParams,
    Location,
    Transaction,
    TransactionResult,
    TransactionType,
)

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient


class InventoryDomain:
    """Typed interface for /api/inventory/* endpoints (V1 reads + V3 writes)."""

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    # ── Catalog ────────────────────────────────────────────────────

    def catalog_list(
        self,
        *,
        warehouse_id: str | None = None,
        category: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[CatalogItem]:
        """List catalog items. RLS-scoped for worker/foreman roles."""
        params = ListCatalogParams(
            warehouse_id=warehouse_id, category=category, limit=limit, offset=offset,
        )
        resp = self._c.get(
            "/api/inventory/items",
            **params.model_dump(by_alias=True, exclude_none=True),
        )
        items = resp.get("items", [])
        return [CatalogItem(**it) for it in items]

    # ── Locations / warehouses ─────────────────────────────────────

    def locations_list(
        self,
        *,
        type: str | None = None,
        client_id: str | None = None,
        include_archived: bool = False,
    ) -> list[Location]:
        """List locations (warehouses + vehicles). RLS-scoped."""
        params: dict[str, object] = {}
        if type is not None:
            params["type"] = type
        if client_id is not None:
            params["clientId"] = client_id
        if include_archived:
            params["includeArchived"] = "true"
        resp = self._c.get("/api/inventory/warehouses", **params)
        warehouses = resp.get("warehouses", [])
        return [Location(**w) for w in warehouses]

    # ── Transactions (journal reads) ───────────────────────────────

    def transactions_list(
        self,
        *,
        warehouse_id: str | None = None,
        item_id: str | None = None,
        type: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Transaction]:
        """List historical transactions. RLS-scoped."""
        params = ListTransactionsParams(
            warehouse_id=warehouse_id, item_id=item_id, type=type,
            from_date=from_date, to_date=to_date, limit=limit, offset=offset,
        )
        resp = self._c.get(
            "/api/inventory/transactions",
            **params.model_dump(by_alias=True, exclude_none=True),
        )
        transactions = resp.get("transactions", [])
        return [Transaction(**tx) for tx in transactions]

    # ── Transactions (V3 writes) ───────────────────────────────────

    def commit(self, body: CreateTransaction) -> TransactionResult:
        """Commit a transaction via the V3 unified write path.

        Prefer the record_purchase / write_off / transfer helpers for
        common cases — `commit()` is the escape hatch for custom types.
        """
        resp = self._c.post(
            "/api/inventory/v3/transactions",
            data=body.model_dump(by_alias=True, exclude_none=True),
        )
        return TransactionResult(**resp)

    def record_purchase(
        self,
        catalog_item_id: str,
        qty: float,
        *,
        to_location: str,
        unit_price: float | None = None,
        related_cost_id: str | None = None,
        idempotency_key: str | None = None,
        note: str | None = None,
    ) -> TransactionResult:
        """Shortcut — record a purchase arriving at to_location."""
        body = CreateTransaction(
            catalog_item_id=catalog_item_id,
            type="purchase",
            qty=qty,
            to_location=to_location,
            unit_price=unit_price,
            idempotency_key=idempotency_key,
            note=note,
        )
        return self._send(body, related_cost_id)

    def write_off(
        self,
        catalog_item_id: str,
        qty: float,
        *,
        from_location: str,
        related_task_id: str | None = None,
        related_norm_id: str | None = None,
        idempotency_key: str | None = None,
        note: str | None = None,
    ) -> TransactionResult:
        """Shortcut — write off qty from from_location, optionally linked to a task/norm."""
        body = CreateTransaction(
            catalog_item_id=catalog_item_id,
            type="write_off",
            qty=qty,
            from_location=from_location,
            related_task_id=related_task_id,
            related_norm_id=related_norm_id,
            idempotency_key=idempotency_key,
            note=note,
        )
        return self._send(body)

    def transfer(
        self,
        catalog_item_id: str,
        qty: float,
        *,
        from_location: str,
        to_location: str,
        transaction_group_id: str | None = None,
        idempotency_key: str | None = None,
        note: str | None = None,
    ) -> TransactionResult:
        """Shortcut — atomic single-step transfer between two locations."""
        body = CreateTransaction(
            catalog_item_id=catalog_item_id,
            type="transfer",
            qty=qty,
            from_location=from_location,
            to_location=to_location,
            transaction_group_id=transaction_group_id,
            idempotency_key=idempotency_key,
            note=note,
        )
        return self._send(body)

    def adjust(
        self,
        catalog_item_id: str,
        qty: float,
        *,
        direction: TransactionType,
        location: str,
        note: str | None = None,
    ) -> TransactionResult:
        """Inventory reconciliation — adjustment_in or adjustment_out."""
        if direction not in ("adjustment_in", "adjustment_out"):
            raise ValueError(
                f"direction must be 'adjustment_in' or 'adjustment_out', got {direction}"
            )
        body = CreateTransaction(
            catalog_item_id=catalog_item_id,
            type=direction,
            qty=qty,
            to_location=location if direction == "adjustment_in" else None,
            from_location=location if direction == "adjustment_out" else None,
            note=note,
        )
        return self._send(body)

    def recalculate(self, catalog_item_id: str) -> TransactionResult | dict:
        """Admin-only — rebuild stock cache by replaying journal for one item."""
        return self._c.post(f"/api/inventory/v3/recalculate/{catalog_item_id}")

    # ── internals ──────────────────────────────────────────────────

    def _send(
        self,
        body: CreateTransaction,
        related_cost_id: str | None = None,
    ) -> TransactionResult:
        payload = body.model_dump(by_alias=True, exclude_none=True)
        if related_cost_id:
            payload["relatedCostId"] = related_cost_id
        resp = self._c.post("/api/inventory/v3/transactions", data=payload)
        return TransactionResult(**resp)
