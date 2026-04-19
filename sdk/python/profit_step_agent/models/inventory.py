"""Inventory domain models — catalog, locations, transactions.

Mirrors the V3 journal-based schema (inventory_catalog + inventory_transactions_v2
+ inventory_locations). See docs/tasks/WAREHOUSE_SPEC_V3.md for authoritative
field definitions.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from profit_step_agent.models.common import parse_timestamp


TransactionType = Literal[
    "purchase",
    "return_in",
    "adjustment_in",
    "write_off",
    "transfer",
    "loss",
    "adjustment_out",
    "tool_issue",
    "tool_return",
]

InventoryCategory = Literal["materials", "tools", "consumables", "equipment"]

# 'physical' is the legacy V1 value for static warehouses — we accept it
# alongside the V3 names so that reads from the mixed-state API still parse.
LocationType = Literal["warehouse", "vehicle", "jobsite", "pack_station", "physical"]


class CatalogItem(BaseModel):
    """A catalog item (SKU) with stock cache."""

    id: str = ""
    name: str = ""
    sku: str | None = None
    category: InventoryCategory = "materials"
    unit: str = "шт"

    last_purchase_price: float = Field(default=0.0, alias="lastPurchasePrice")
    avg_price: float = Field(default=0.0, alias="avgPrice")
    client_markup_percent: float = Field(default=20.0, alias="clientMarkupPercent")

    stock_by_location: dict[str, float] = Field(default_factory=dict, alias="stockByLocation")
    total_stock: float = Field(default=0.0, alias="totalStock")
    min_stock: float = Field(default=0.0, alias="minStock")

    is_trackable: bool = Field(default=False, alias="isTrackable")
    assigned_to: str | None = Field(default=None, alias="assignedTo")
    assigned_to_name: str | None = Field(default=None, alias="assignedToName")

    is_archived: bool = Field(default=False, alias="isArchived")
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}

    def __init__(self, **data: Any) -> None:
        for src, dst in (("createdAt", "created_at"), ("updatedAt", "updated_at")):
            if src in data and not isinstance(data.get(src), datetime):
                data[dst] = parse_timestamp(data.pop(src, None))
        super().__init__(**data)


class Location(BaseModel):
    """A storage location — warehouse, vehicle, jobsite, or pack station."""

    id: str = ""
    name: str = ""
    type: LocationType = "warehouse"
    owner_employee_id: str | None = Field(default=None, alias="ownerEmployeeId")
    related_client_id: str | None = Field(default=None, alias="relatedClientId")
    address: str | None = None
    is_active: bool = Field(default=True, alias="isActive")

    model_config = {"populate_by_name": True, "extra": "allow"}


class Transaction(BaseModel):
    """An immutable journal entry in inventory_transactions_v2."""

    id: str = ""
    catalog_item_id: str = Field(default="", alias="catalogItemId")
    catalog_item_name: str = Field(default="", alias="catalogItemName")
    category: InventoryCategory = "materials"

    type: TransactionType = "purchase"
    qty: float = 0.0
    unit_price: float = Field(default=0.0, alias="unitPrice")
    total_amount: float = Field(default=0.0, alias="totalAmount")
    stock_after: float = Field(default=0.0, alias="stockAfter")

    from_location: str | None = Field(default=None, alias="fromLocation")
    to_location: str | None = Field(default=None, alias="toLocation")

    related_task_id: str | None = Field(default=None, alias="relatedTaskId")
    related_task_title: str | None = Field(default=None, alias="relatedTaskTitle")
    related_client_id: str | None = Field(default=None, alias="relatedClientId")
    related_client_name: str | None = Field(default=None, alias="relatedClientName")
    related_norm_id: str | None = Field(default=None, alias="relatedNormId")

    transaction_group_id: str | None = Field(default=None, alias="transactionGroupId")
    transfer_request_id: str | None = Field(default=None, alias="transferRequestId")

    performed_by: str = Field(default="", alias="performedBy")
    performed_by_name: str = Field(default="", alias="performedByName")
    timestamp: datetime | None = None
    source: str = "api"
    note: str | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}

    def __init__(self, **data: Any) -> None:
        if "timestamp" in data and not isinstance(data.get("timestamp"), datetime):
            data["timestamp"] = parse_timestamp(data.pop("timestamp", None))
        super().__init__(**data)


class CreateTransaction(BaseModel):
    """Request body for POST /api/inventory/v3/transactions."""

    catalog_item_id: str = Field(serialization_alias="catalogItemId")
    type: TransactionType
    qty: float
    from_location: str | None = Field(default=None, serialization_alias="fromLocation")
    to_location: str | None = Field(default=None, serialization_alias="toLocation")
    unit_price: float | None = Field(default=None, serialization_alias="unitPrice")
    related_task_id: str | None = Field(default=None, serialization_alias="relatedTaskId")
    related_task_title: str | None = Field(default=None, serialization_alias="relatedTaskTitle")
    related_client_id: str | None = Field(default=None, serialization_alias="relatedClientId")
    related_client_name: str | None = Field(default=None, serialization_alias="relatedClientName")
    related_norm_id: str | None = Field(default=None, serialization_alias="relatedNormId")
    transaction_group_id: str | None = Field(default=None, serialization_alias="transactionGroupId")
    transfer_request_id: str | None = Field(default=None, serialization_alias="transferRequestId")
    idempotency_key: str | None = Field(default=None, serialization_alias="idempotencyKey")
    note: str | None = None
    performed_by_name: str | None = Field(default=None, serialization_alias="performedByName")

    model_config = {"populate_by_name": True}


class TransactionResult(BaseModel):
    """Response body from POST /api/inventory/v3/transactions."""

    transaction_id: str = Field(alias="transactionId")
    catalog_item_id: str = Field(alias="catalogItemId")
    type: TransactionType
    qty: float
    stock_before: float = Field(alias="stockBefore")
    stock_after: float = Field(alias="stockAfter")
    stock_by_location_after: dict[str, float] = Field(
        default_factory=dict, alias="stockByLocationAfter"
    )
    deduplicated: bool = False

    model_config = {"populate_by_name": True}


class ListCatalogParams(BaseModel):
    """Query parameters for GET /api/inventory/items."""

    warehouse_id: str | None = Field(default=None, serialization_alias="warehouseId")
    category: str | None = None
    limit: int = 100
    offset: int = 0

    model_config = {"populate_by_name": True}


class ListTransactionsParams(BaseModel):
    """Query parameters for GET /api/inventory/transactions."""

    warehouse_id: str | None = Field(default=None, serialization_alias="warehouseId")
    item_id: str | None = Field(default=None, serialization_alias="itemId")
    type: str | None = None
    from_date: str | None = Field(default=None, serialization_alias="from")
    to_date: str | None = Field(default=None, serialization_alias="to")
    limit: int = 50
    offset: int = 0

    model_config = {"populate_by_name": True}
