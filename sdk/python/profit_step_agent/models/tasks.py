"""Task (GTD) models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from profit_step_agent.models.common import parse_timestamp

TaskStatus = Literal[
    "inbox", "next_action", "waiting", "projects", "someday", "done", "estimate", "completed", "archived"
]
TaskPriority = Literal["low", "medium", "high", "urgent"]


class Task(BaseModel):
    """A GTD task as returned by the API."""

    id: str = ""
    title: str = ""
    status: str = ""
    priority: str = "medium"
    client_id: str | None = Field(default=None, alias="clientId")
    client_name: str | None = Field(default=None, alias="clientName")
    project_id: str | None = Field(default=None, alias="projectId")
    assignee_id: str | None = Field(default=None, alias="assigneeId")
    assignee_name: str | None = Field(default=None, alias="assigneeName")
    due_date: datetime | None = None
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Time tracking aggregates
    total_time_spent_minutes: int = Field(default=0, alias="totalTimeSpentMinutes")
    total_earnings: float = Field(default=0.0, alias="totalEarnings")

    model_config = {"populate_by_name": True, "extra": "allow"}

    def __init__(self, **data: Any) -> None:
        # Parse Firestore timestamps
        for field in ("due_date", "dueDate", "created_at", "createdAt", "updated_at", "updatedAt"):
            if field in data and not isinstance(data[field], datetime):
                snake = field.replace("At", "_at").replace("Date", "_date")
                if snake.startswith("due"):
                    snake = "due_date"
                parsed = parse_timestamp(data.pop(field, None))
                data[snake] = parsed
        super().__init__(**data)


class CreateTask(BaseModel):
    """Request body for POST /api/tasks."""

    title: str
    status: TaskStatus = "next_action"
    priority: TaskPriority = "medium"
    client_id: str | None = Field(default=None, serialization_alias="clientId")
    project_id: str | None = Field(default=None, serialization_alias="projectId")
    assignee_id: str | None = Field(default=None, serialization_alias="assigneeId")
    due_date: str | None = Field(default=None, serialization_alias="dueDate")
    notes: str | None = None


class UpdateTask(BaseModel):
    """Request body for PATCH /api/tasks/{taskId}."""

    title: str | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    client_id: str | None = Field(default=None, serialization_alias="clientId")
    assignee_id: str | None = Field(default=None, serialization_alias="assigneeId")
    due_date: str | None = Field(default=None, serialization_alias="dueDate")
    notes: str | None = None

    model_config = {"populate_by_name": True}


class ListTasksParams(BaseModel):
    """Query parameters for GET /api/tasks/list."""

    status: TaskStatus | None = None
    client_id: str | None = Field(default=None, serialization_alias="clientId")
    assignee_id: str | None = Field(default=None, serialization_alias="assigneeId")
    priority: TaskPriority | None = None
    limit: int = 20
