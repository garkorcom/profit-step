"""
02_daily_report.py — fetch yesterday's shift summary + top projects.

Prints a report that a partner can pipe to Slack/Discord/email.
This is the kind of "nightly cron" script many integrations want as
their first real use of the API.

Uses:
  - agent.time.summary(from_date, to_date)     — per-employee hours+earnings
  - agent.clients.list() / projects-by-client  — map IDs to names

Run:
    PROFIT_STEP_TOKEN=ak_... python 02_daily_report.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta

from profit_step_agent import CRMAgent, CRMError


def main() -> int:
    token = os.environ.get("PROFIT_STEP_TOKEN")
    if not token:
        print("ERROR: set PROFIT_STEP_TOKEN env var.", file=sys.stderr)
        return 2

    yesterday = date.today() - timedelta(days=1)
    date_str = yesterday.isoformat()

    try:
        with CRMAgent(token=token) as agent:
            summary = agent.time.summary(from_date=date_str, to_date=date_str)
    except CRMError as e:
        print(f"API error: {e}", file=sys.stderr)
        return 1

    employees = summary.get("employees", [])
    total_hours = sum(e.get("totalHours", 0) for e in employees)
    total_earned = sum(e.get("earned", 0) for e in employees)

    print(f"📊 Daily report — {yesterday.strftime('%A, %B %d, %Y')}")
    print("=" * 50)
    print(f"Active workers: {len(employees)}")
    print(f"Total hours:    {total_hours:.1f}")
    print(f"Total earned:   ${total_earned:,.2f}")

    if not employees:
        print("\n(no activity yesterday)")
        return 0

    print("\nPer-employee breakdown:")
    print(f"{'Employee':<28}{'Hours':>8}{'Earned':>12}{'Sessions':>10}")
    print("-" * 58)
    for e in sorted(employees, key=lambda x: x.get("totalHours", 0), reverse=True):
        name = (e.get("employeeName") or "Unknown")[:26]
        hours = e.get("totalHours", 0)
        earned = e.get("earned", 0)
        sessions = e.get("sessionCount", 0)
        print(f"{name:<28}{hours:>8.1f}{'$':>5}{earned:>6.2f}{sessions:>10}")

    print(f"\nTotal payroll for day: ${total_earned:,.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
