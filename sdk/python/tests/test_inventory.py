"""Tests for InventoryDomain — V3 endpoints.

Uses respx to mock the HTTP layer so these run offline and without touching
prod. Target coverage: catalog/location reads, all four write helpers
(record_purchase, write_off, transfer, adjust), recalculate.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from profit_step_agent import CRMAgent

BASE = "https://test-api.example.com"
TOKEN = "a" * 40


@pytest.fixture
def agent():
    a = CRMAgent(token=TOKEN, base_url=BASE, timeout=5.0)
    yield a
    a.close()


# ── Reads ─────────────────────────────────────────────────────────


@respx.mock
def test_catalog_list(agent: CRMAgent):
    respx.get(f"{BASE}/api/inventory/items").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": "wire_12awg",
                        "name": "Wire 12 AWG",
                        "category": "materials",
                        "unit": "м",
                        "totalStock": 320,
                        "stockByLocation": {"warehouse": 200, "vehicle_1": 120},
                        "minStock": 50,
                    },
                ],
                "total": 1,
                "hasMore": False,
            },
        )
    )
    items = agent.inventory.catalog_list(category="materials")
    assert len(items) == 1
    assert items[0].name == "Wire 12 AWG"
    assert items[0].total_stock == 320
    assert items[0].stock_by_location == {"warehouse": 200, "vehicle_1": 120}


@respx.mock
def test_locations_list(agent: CRMAgent):
    respx.get(f"{BASE}/api/inventory/warehouses").mock(
        return_value=httpx.Response(
            200,
            json={
                "warehouses": [
                    {
                        "id": "wh_main",
                        "name": "Main Warehouse",
                        "type": "physical",
                        "ownerEmployeeId": None,
                    },
                    {
                        "id": "van_1",
                        "name": "Denis's Van",
                        "type": "vehicle",
                        "ownerEmployeeId": "uid_denis",
                    },
                ],
                "count": 2,
            },
        )
    )
    locations = agent.inventory.locations_list()
    assert len(locations) == 2
    assert locations[1].type == "vehicle"
    assert locations[1].owner_employee_id == "uid_denis"


@respx.mock
def test_transactions_list(agent: CRMAgent):
    respx.get(f"{BASE}/api/inventory/transactions").mock(
        return_value=httpx.Response(
            200,
            json={
                "transactions": [
                    {
                        "id": "tx_1",
                        "catalogItemId": "wire_12awg",
                        "type": "purchase",
                        "qty": 100,
                        "unitPrice": 0.85,
                    }
                ],
                "total": 1,
                "hasMore": False,
            },
        )
    )
    txs = agent.inventory.transactions_list(item_id="wire_12awg", limit=10)
    assert len(txs) == 1
    assert txs[0].type == "purchase"
    assert txs[0].qty == 100


# ── Writes — happy paths ──────────────────────────────────────────


@respx.mock
def test_record_purchase(agent: CRMAgent):
    route = respx.post(f"{BASE}/api/inventory/v3/transactions").mock(
        return_value=httpx.Response(
            201,
            json={
                "transactionId": "tx_new",
                "catalogItemId": "wire_12awg",
                "type": "purchase",
                "qty": 100,
                "stockBefore": 200,
                "stockAfter": 300,
                "stockByLocationAfter": {"warehouse": 300},
            },
        )
    )
    result = agent.inventory.record_purchase(
        "wire_12awg", qty=100, unit_price=0.85, to_location="warehouse",
    )
    assert result.transaction_id == "tx_new"
    assert result.stock_after == 300
    # Verify payload
    sent = route.calls.last.request
    assert b'"catalogItemId":"wire_12awg"' in sent.content
    assert b'"type":"purchase"' in sent.content
    assert b'"toLocation":"warehouse"' in sent.content


@respx.mock
def test_write_off(agent: CRMAgent):
    route = respx.post(f"{BASE}/api/inventory/v3/transactions").mock(
        return_value=httpx.Response(
            201,
            json={
                "transactionId": "tx_2",
                "catalogItemId": "wire_12awg",
                "type": "write_off",
                "qty": 40,
                "stockBefore": 300,
                "stockAfter": 260,
                "stockByLocationAfter": {"warehouse": 260},
            },
        )
    )
    result = agent.inventory.write_off(
        "wire_12awg", qty=40, from_location="warehouse", related_task_id="task_x",
    )
    assert result.stock_after == 260
    sent = route.calls.last.request
    assert b'"fromLocation":"warehouse"' in sent.content
    assert b'"relatedTaskId":"task_x"' in sent.content


@respx.mock
def test_transfer(agent: CRMAgent):
    route = respx.post(f"{BASE}/api/inventory/v3/transactions").mock(
        return_value=httpx.Response(
            201,
            json={
                "transactionId": "tx_3",
                "catalogItemId": "wire_12awg",
                "type": "transfer",
                "qty": 20,
                "stockBefore": 260,
                "stockAfter": 260,
                "stockByLocationAfter": {"warehouse": 240, "vehicle_1": 20},
            },
        )
    )
    result = agent.inventory.transfer(
        "wire_12awg", qty=20, from_location="warehouse", to_location="vehicle_1",
    )
    # Transfer preserves total
    assert result.stock_after == 260
    assert result.stock_by_location_after == {"warehouse": 240, "vehicle_1": 20}
    sent = route.calls.last.request
    assert b'"type":"transfer"' in sent.content


@respx.mock
def test_adjust_in(agent: CRMAgent):
    route = respx.post(f"{BASE}/api/inventory/v3/transactions").mock(
        return_value=httpx.Response(
            201,
            json={
                "transactionId": "tx_4",
                "catalogItemId": "wire_12awg",
                "type": "adjustment_in",
                "qty": 5,
                "stockBefore": 240,
                "stockAfter": 245,
                "stockByLocationAfter": {"warehouse": 245},
            },
        )
    )
    result = agent.inventory.adjust(
        "wire_12awg", qty=5, direction="adjustment_in", location="warehouse",
    )
    assert result.stock_after == 245
    sent = route.calls.last.request
    assert b'"type":"adjustment_in"' in sent.content
    assert b'"toLocation":"warehouse"' in sent.content


def test_adjust_rejects_invalid_direction(agent: CRMAgent):
    with pytest.raises(ValueError, match="adjustment_in"):
        agent.inventory.adjust(
            "wire_12awg", qty=5, direction="purchase", location="warehouse",
        )


@respx.mock
def test_commit_handles_deduplication(agent: CRMAgent):
    respx.post(f"{BASE}/api/inventory/v3/transactions").mock(
        return_value=httpx.Response(
            200,
            json={
                "transactionId": "tx_prev",
                "catalogItemId": "wire_12awg",
                "type": "purchase",
                "qty": 50,
                "stockBefore": 100,
                "stockAfter": 150,
                "stockByLocationAfter": {"warehouse": 150},
                "deduplicated": True,
            },
        )
    )
    result = agent.inventory.record_purchase(
        "wire_12awg", qty=50, to_location="warehouse",
        idempotency_key="key_xyz", unit_price=1.0,
    )
    assert result.deduplicated is True


@respx.mock
def test_recalculate_admin_only(agent: CRMAgent):
    respx.post(f"{BASE}/api/inventory/v3/recalculate/wire_12awg").mock(
        return_value=httpx.Response(
            200,
            json={
                "catalogItemId": "wire_12awg",
                "stockByLocation": {"warehouse": 150},
                "totalStock": 150,
                "transactionsReplayed": 3,
            },
        )
    )
    result = agent.inventory.recalculate("wire_12awg")
    assert result["totalStock"] == 150
    assert result["transactionsReplayed"] == 3
