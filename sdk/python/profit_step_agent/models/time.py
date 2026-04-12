"""Time tracking models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from profit_step_agent.models.common import parse_timestamp

SessionStatus = Literal["active", "paused", "completed", "auto_closed"]


class Session(BaseModel):
    """A work session."""

    id: str = ""
    employee_id: str = Field(default="", alias="employeeId")
    employee_name: str = Field(default="", alias="employeeName")
    client_id: str | None = Field(default=None, alias="clientId")
    client_name: str | None = Field(default=None, alias="clientName")
    status: str = ""
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int = Field(default=0, alias="durationMinutes")
    session_earnings: float = Field(default=0.0, alias="sessionEarnings")
    hourly_rate: float = Field(default=0.0, alias="hourlyRate")
    task_id: str | None = Field(default=None, alias="taskId")
    source: str | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}

    def __init__(self, **data: Any) -> None:
        for field in ("start_time", "startTime", "end_time", "endTime"):
            if field in data and not isinstance(data.get(field), datetime):
                snake = field.replace("Time", "_time")
                data[snake] = parse_timestamp(data.pop(field, None))
        super().__init__(**data)

    @property
    def hours(self) -> float:
        return round(self.duration_minutes / 60, 2)

    @property
    def is_active(self) -> bool:
        return self.status in ("active", "paused")


class StartSession(BaseModel):
    """Request body for time.start()."""

    action: str = "start"
    task_title: str | None = Field(default=None, serialization_alias="taskTitle")
    task_id: str | None = Field(default=None, serialization_alias="taskId")
    client_id: str | None = Field(default=None, serialization_alias="clientId")
    client_name: str | None = Field(default=None, serialization_alias="clientName")
    start_time: str | None = Field(default=None, serialization_alias="startTime")

    model_config = {"populate_by_name": True}


class TimeSummaryEmployee(BaseModel):
    """Per-employee row in time summary."""

    employee_id: str = Field(default="", alias="employeeId")
    employee_name: str = Field(default="", alias="employeeName")
    total_minutes: int = Field(default=0, alias="totalMinutes")
    total_earnings: float = Field(default=0.0, alias="totalEarnings")
    session_count: int = Field(default=0, alias="sessionCount")

    model_config = {"populate_by_name": True, "extra": "allow"}

    @property
    def hours(self) -> float:
        return round(self.total_minutes / 60, 2)


class TimeSummary(BaseModel):
    """Response from GET /api/time-tracking/summary."""

    employees: list[TimeSummaryEmployee] = []
    total_minutes: int = Field(default=0, alias="totalMinutes")
    total_earnings: float = Field(default=0.0, alias="totalEarnings")

    model_config = {"populate_by_name": True, "extra": "allow"}
