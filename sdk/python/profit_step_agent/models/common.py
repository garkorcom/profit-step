"""Common types shared across domains."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SortDir(str, Enum):
    ASC = "asc"
    DESC = "desc"


class Pagination(BaseModel):
    """Standard pagination wrapper returned by list endpoints."""

    total: int = 0
    limit: int = 20
    offset: int = 0
    has_more: bool = False


class FirestoreTimestamp(BaseModel):
    """Firestore timestamp as returned by the API."""

    seconds: int = Field(default=0, alias="_seconds")
    nanoseconds: int = Field(default=0, alias="_nanoseconds")

    model_config = {"populate_by_name": True}

    def to_datetime(self) -> datetime:
        return datetime.fromtimestamp(self.seconds)


def parse_timestamp(val: Any) -> datetime | None:
    """Parse a Firestore timestamp dict or ISO string into a datetime."""
    if val is None:
        return None
    if isinstance(val, dict):
        seconds = val.get("_seconds", 0)
        return datetime.fromtimestamp(seconds)
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None
