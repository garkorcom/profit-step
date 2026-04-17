"""Costs domain — expense tracking."""

from __future__ import annotations

from typing import TYPE_CHECKING

from profit_step_agent.models.costs import Cost, CreateCost, ListCostsParams

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient


class CostsDomain:
    """Typed interface for /api/costs endpoints."""

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    def list(
        self,
        *,
        client_id: str | None = None,
        project_id: str | None = None,
        category: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        limit: int = 50,
    ) -> list[Cost]:
        """List costs. Workers see only their own costs."""
        params = ListCostsParams(
            client_id=client_id, project_id=project_id,
            category=category, from_date=from_date, to_date=to_date,
            limit=limit,
        )
        resp = self._c.get(
            "/api/costs/list",
            **params.model_dump(by_alias=True, exclude_none=True),
        )
        items = resp.get("costs", resp.get("items", []))
        return [Cost(**c) for c in items]

    def create(
        self,
        amount: float,
        category: str,
        description: str,
        *,
        client_id: str | None = None,
        project_id: str | None = None,
    ) -> str:
        """Create a cost entry. Returns cost ID."""
        body = CreateCost(
            amount=amount, category=category, description=description,
            client_id=client_id, project_id=project_id,
        )
        resp = self._c.post(
            "/api/costs",
            data=body.model_dump(by_alias=True, exclude_none=True),
        )
        return resp.get("costId", resp.get("id", ""))

    def void(self, cost_id: str) -> bool:
        """Void a cost entry."""
        resp = self._c.post(f"/api/costs/{cost_id}/void")
        return resp.get("voided", False)
