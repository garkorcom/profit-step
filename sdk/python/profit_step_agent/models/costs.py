"""Cost entry models."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from profit_step_agent.models.common import parse_timestamp


class Cost(BaseModel):
    """A cost entry."""

    id: str = ""
    amount: float = 0.0
    category: str = ""
    description: str = ""
    client_id: str | None = Field(default=None, alias="clientId")
    client_name: str | None = Field(default=None, alias="clientName")
    project_id: str | None = Field(default=None, alias="projectId")
    created_by: str = Field(default="", alias="createdBy")
    created_at: datetime | None = None
    is_voided: bool = Field(default=False, alias="isVoided")

    model_config = {"populate_by_name": True, "extra": "allow"}

    def __init__(self, **data: Any) -> None:
        for field in ("created_at", "createdAt"):
            if field in data and not isinstance(data.get(field), datetime):
                data["created_at"] = parse_timestamp(data.pop(field, None))
        super().__init__(**data)


class CreateCost(BaseModel):
    """Request body for POST /api/costs."""

    amount: float
    category: str
    description: str
    client_id: str | None = Field(default=None, serialization_alias="clientId")
    project_id: str | None = Field(default=None, serialization_alias="projectId")

    model_config = {"populate_by_name": True}


class ListCostsParams(BaseModel):
    """Query parameters for GET /api/costs/list."""

    client_id: str | None = Field(default=None, serialization_alias="clientId")
    project_id: str | None = Field(default=None, serialization_alias="projectId")
    category: str | None = None
    from_date: str | None = Field(default=None, serialization_alias="from")
    to_date: str | None = Field(default=None, serialization_alias="to")
    limit: int = 50
