"""Payroll domain — self-service + admin endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from profit_step_agent.models.payroll import MyBalance, MyHours, MyPay, OvertimeCheck

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient


class PayrollDomain:
    """Typed interface for /api/payroll endpoints."""

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    # ─── Self-service (worker scope: time:read) ────────────────────

    def my_balance(self) -> MyBalance:
        """Get my current balance (running, YTD, advances)."""
        resp = self._c.get("/api/payroll/my-balance")
        return MyBalance(**resp)

    def my_hours(self, *, week_of: str | None = None) -> MyHours:
        """Get my hours this week with overtime warnings."""
        params: dict = {}
        if week_of:
            params["weekOf"] = week_of
        resp = self._c.get("/api/payroll/my-hours", **params)
        return MyHours(**resp)

    def my_pay(self, *, period: str | None = None) -> MyPay:
        """Get my pay stub for a period (YYYY-MM)."""
        params: dict = {}
        if period:
            params["period"] = period
        resp = self._c.get("/api/payroll/my-pay", **params)
        return MyPay(**resp)

    # ─── Admin endpoints ───────────────────────────────────────────

    def overtime_check(self, *, week_of: str | None = None) -> OvertimeCheck:
        """Admin: check all employees' weekly hours for overtime."""
        params: dict = {}
        if week_of:
            params["weekOf"] = week_of
        resp = self._c.get("/api/payroll/overtime-check", **params)
        return OvertimeCheck(**resp)

    def validate_period(
        self,
        period_id: str,
        *,
        checks: list[str] | None = None,
    ) -> dict:
        """Admin: validate a payroll period for anomalies."""
        data: dict = {}
        if checks:
            data["checks"] = checks
        return self._c.post(f"/api/payroll/period/{period_id}/validate", data=data or None)
