"""Client models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ClientType = Literal["residential", "commercial", "industrial"]


class Client(BaseModel):
    """A CRM client."""

    id: str = ""
    name: str = ""
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    type: str | None = None
    notes: str | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}


class CreateClient(BaseModel):
    """Request body for POST /api/clients."""

    name: str
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    type: ClientType | None = None


class SearchClientsParams(BaseModel):
    """Query parameters for GET /api/clients/search."""

    q: str
    limit: int = 5
