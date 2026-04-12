"""Time tracking domain — start/stop/status/summary."""

from __future__ import annotations

from typing import TYPE_CHECKING

from profit_step_agent.models.time import Session, StartSession, TimeSummary, TimeSummaryEmployee

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient


class TimeDomain:
    """Typed interface for /api/time-tracking endpoints."""

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    def start(
        self,
        *,
        client_id: str | None = None,
        client_name: str | None = None,
        task_id: str | None = None,
        task_title: str | None = None,
        start_time: str | None = None,
    ) -> dict:
        """Start a timer. Auto-closes any active session."""
        body = StartSession(
            task_id=task_id, task_title=task_title,
            client_id=client_id, client_name=client_name,
            start_time=start_time,
        )
        return self._c.post(
            "/api/time-tracking",
            data=body.model_dump(by_alias=True, exclude_none=True),
        )

    def stop(self, *, end_time: str | None = None) -> dict:
        """Stop the active timer."""
        data: dict = {"action": "stop"}
        if end_time:
            data["endTime"] = end_time
        return self._c.post("/api/time-tracking", data=data)

    def status(self) -> dict:
        """Get current timer status."""
        return self._c.post("/api/time-tracking", data={"action": "status"})

    def active_all(self) -> list[Session]:
        """List all active sessions across all employees."""
        resp = self._c.get("/api/time-tracking/active-all")
        items = resp.get("sessions", resp.get("items", []))
        return [Session(**s) for s in items]

    def summary(
        self,
        from_date: str,
        to_date: str,
        *,
        employee_id: str | None = None,
    ) -> TimeSummary:
        """Get aggregated time summary for a date range."""
        params: dict = {"from": from_date, "to": to_date}
        if employee_id:
            params["employeeId"] = employee_id
        resp = self._c.get("/api/time-tracking/summary", **params)
        return TimeSummary(**resp)

    def admin_stop(self, session_id: str) -> dict:
        """Admin: force-stop a specific session."""
        return self._c.post(
            "/api/time-tracking/admin-stop",
            data={"sessionId": session_id},
        )
