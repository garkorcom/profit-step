"""Tasks domain — GTD task management."""

from __future__ import annotations

from typing import TYPE_CHECKING

from profit_step_agent.models.tasks import Task, CreateTask, UpdateTask, ListTasksParams

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient


class TasksDomain:
    """Typed interface for /api/tasks endpoints."""

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    def list(
        self,
        *,
        status: str | None = None,
        client_id: str | None = None,
        assignee_id: str | None = None,
        priority: str | None = None,
        limit: int = 20,
    ) -> list[Task]:
        """List tasks with optional filters. Workers see only their assigned tasks."""
        params = ListTasksParams(
            status=status, client_id=client_id, assignee_id=assignee_id,
            priority=priority, limit=limit,
        )
        resp = self._c.get(
            "/api/tasks/list",
            **params.model_dump(by_alias=True, exclude_none=True),
        )
        items = resp.get("tasks", resp.get("items", []))
        return [Task(**t) for t in items]

    def create(
        self,
        title: str,
        *,
        status: str = "next_action",
        priority: str = "medium",
        client_id: str | None = None,
        project_id: str | None = None,
        assignee_id: str | None = None,
        due_date: str | None = None,
        notes: str | None = None,
    ) -> str:
        """Create a task. Returns the new task ID."""
        body = CreateTask(
            title=title, status=status, priority=priority,
            client_id=client_id, project_id=project_id,
            assignee_id=assignee_id, due_date=due_date, notes=notes,
        )
        resp = self._c.post(
            "/api/tasks",
            data=body.model_dump(by_alias=True, exclude_none=True),
        )
        return resp.get("taskId", resp.get("id", ""))

    def update(self, task_id: str, **fields: object) -> bool:
        """Update task fields. Returns True on success."""
        body = UpdateTask(**fields)
        resp = self._c.patch(
            f"/api/tasks/{task_id}",
            data=body.model_dump(by_alias=True, exclude_none=True),
        )
        return resp.get("updated", False)

    def complete(self, task_id: str) -> bool:
        """Mark a task as done."""
        return self.update(task_id, status="done")

    def get(self, task_id: str) -> Task:
        """Get a single task by ID."""
        resp = self._c.get(f"/api/tasks/{task_id}")
        return Task(**resp.get("task", resp))
