"""Clients domain."""

from __future__ import annotations

from typing import TYPE_CHECKING

from profit_step_agent.models.clients import Client, CreateClient

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient


class ClientsDomain:
    """Typed interface for /api/clients endpoints."""

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    def list(self) -> list[Client]:
        """List all clients."""
        resp = self._c.get("/api/clients/list")
        items = resp.get("clients", resp.get("items", []))
        return [Client(**c) for c in items]

    def search(self, query: str, *, limit: int = 5) -> list[Client]:
        """Fuzzy search clients by name."""
        resp = self._c.get("/api/clients/search", q=query, limit=limit)
        items = resp.get("results", resp.get("clients", []))
        return [Client(**c) for c in items]

    def get(self, client_id: str) -> Client:
        """Get a client by ID."""
        resp = self._c.get(f"/api/clients/{client_id}")
        return Client(**resp.get("client", resp))

    def create(
        self,
        name: str,
        *,
        address: str | None = None,
        phone: str | None = None,
        email: str | None = None,
        client_type: str | None = None,
    ) -> str:
        """Create a client. Returns client ID."""
        body = CreateClient(
            name=name, address=address, phone=phone, email=email, type=client_type,
        )
        resp = self._c.post(
            "/api/clients",
            data=body.model_dump(exclude_none=True),
        )
        return resp.get("clientId", resp.get("id", ""))

    def update(self, client_id: str, **fields: object) -> bool:
        """Update client fields."""
        resp = self._c.patch(f"/api/clients/{client_id}", data=fields)
        return resp.get("updated", False)
