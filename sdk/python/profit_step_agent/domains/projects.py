"""Projects domain."""

from __future__ import annotations

from typing import TYPE_CHECKING

from profit_step_agent.models.projects import Project, CreateProject

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient


class ProjectsDomain:
    """Typed interface for /api/projects endpoints."""

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    def list(self) -> list[Project]:
        """List active projects."""
        resp = self._c.get("/api/projects/list")
        items = resp.get("projects", resp.get("items", []))
        return [Project(**p) for p in items]

    def create(
        self,
        name: str,
        *,
        client_id: str | None = None,
        description: str | None = None,
        budget: float | None = None,
    ) -> str:
        """Create a project. Returns project ID."""
        body = CreateProject(
            name=name, client_id=client_id,
            description=description, budget=budget,
        )
        resp = self._c.post(
            "/api/projects",
            data=body.model_dump(by_alias=True, exclude_none=True),
        )
        return resp.get("projectId", resp.get("id", ""))

    def dashboard(self, project_id: str) -> dict:
        """Get project dashboard (financials, tasks, sessions)."""
        return self._c.get(f"/api/projects/{project_id}/dashboard")
