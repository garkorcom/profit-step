"""Payroll self-service models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MyBalance(BaseModel):
    """Response from GET /api/payroll/my-balance."""

    running_balance: float = Field(default=0.0, alias="runningBalance")
    ytd_earned: float = Field(default=0.0, alias="ytdEarned")
    ytd_paid: float = Field(default=0.0, alias="ytdPaid")
    advance_balance: float = Field(default=0.0, alias="advanceBalance")
    last_payment_date: str | None = Field(default=None, alias="lastPaymentDate")
    last_payment_amount: float | None = Field(default=None, alias="lastPaymentAmount")

    model_config = {"populate_by_name": True, "extra": "allow"}


class DayHours(BaseModel):
    """A single day's hours in MyHours response."""

    date: str = ""
    hours: float = 0.0
    sessions: int = 0
    earnings: float = 0.0
    projects: list[str] = Field(default_factory=list)


class MyHours(BaseModel):
    """Response from GET /api/payroll/my-hours."""

    week_of: str = Field(default="", alias="weekOf")
    total_hours: float = Field(default=0.0, alias="totalHours")
    total_earnings: float = Field(default=0.0, alias="totalEarnings")
    overtime_warning: bool = Field(default=False, alias="overtimeWarning")
    days: list[DayHours] = Field(default_factory=list)

    model_config = {"populate_by_name": True, "extra": "allow"}


class MyPay(BaseModel):
    """Response from GET /api/payroll/my-pay."""

    period: str = ""
    gross: float = 0.0
    deductions: float = 0.0
    net: float = 0.0
    hours: float = 0.0
    sessions: int = 0

    model_config = {"populate_by_name": True, "extra": "allow"}


class OvertimeEmployee(BaseModel):
    """Per-employee row in overtime check."""

    employee_id: str = Field(default="", alias="employeeId")
    employee_name: str = Field(default="", alias="employeeName")
    total_hours: float = Field(default=0.0, alias="totalHours")
    status: str = ""  # "ok", "approaching", "overtime"

    model_config = {"populate_by_name": True, "extra": "allow"}


class OvertimeCheck(BaseModel):
    """Response from GET /api/payroll/overtime-check."""

    week_of: str = Field(default="", alias="weekOf")
    employees: list[OvertimeEmployee] = Field(default_factory=list)

    model_config = {"populate_by_name": True, "extra": "allow"}
