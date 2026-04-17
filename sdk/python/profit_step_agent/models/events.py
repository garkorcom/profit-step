"""Agent event queue models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from profit_step_agent.models.common import parse_timestamp

EventType = Literal["task", "session", "cost", "estimate", "project", "inventory", "payroll", "alert"]


class Event(BaseModel):
    """An event from the agent_events queue."""

    id: str = ""
    type: str = ""
    action: str = ""
    entity_id: str = Field(default="", alias="entityId")
    entity_type: str = Field(default="", alias="entityType")
    summary: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    employee_id: str | None = Field(default=None, alias="employeeId")
    source: str = ""
    created_at: datetime | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}

    def __init__(self, **data: Any) -> None:
        for field in ("created_at", "createdAt"):
            if field in data and not isinstance(data.get(field), datetime):
                data["created_at"] = parse_timestamp(data.pop(field, None))
        super().__init__(**data)


class EventQuery(BaseModel):
    """Query parameters for GET /api/events."""

    since: str | None = None
    type: EventType | None = None
    limit: int = 50
