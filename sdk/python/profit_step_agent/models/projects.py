"""Project models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Project(BaseModel):
    """A CRM project."""

    id: str = ""
    name: str = ""
    client_id: str | None = Field(default=None, alias="clientId")
    client_name: str | None = Field(default=None, alias="clientName")
    status: str = ""
    budget: float | None = None
    description: str | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}


class CreateProject(BaseModel):
    """Request body for POST /api/projects."""

    name: str
    client_id: str | None = Field(default=None, serialization_alias="clientId")
    description: str | None = None
    budget: float | None = None
