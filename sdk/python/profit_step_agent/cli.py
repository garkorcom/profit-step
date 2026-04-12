"""
CLI entry point: `psa` command.

Usage:
    psa auth test
    psa tasks list --status next_action
    psa tasks create "Fix wiring at Site B" --priority high
    psa time start --client-id abc123
    psa time stop
    psa time status
    psa costs list --from 2026-04-01
    psa payroll balance
    psa payroll hours
    psa events watch --type task
"""

from __future__ import annotations

import json
import os
import sys

import click

from profit_step_agent.agent import CRMAgent
from profit_step_agent.exceptions import CRMError


def _agent() -> CRMAgent:
    """Create agent from env or config."""
    token = os.environ.get("PROFIT_STEP_TOKEN")
    if not token:
        config_path = os.path.expanduser("~/.config/profit-step/token")
        if os.path.exists(config_path):
            token = open(config_path).read().strip()
    if not token:
        click.echo("Error: No token. Set PROFIT_STEP_TOKEN or run: psa auth setup", err=True)
        sys.exit(1)
    return CRMAgent(token=token)


def _json(data: object) -> None:
    """Pretty-print JSON."""
    if hasattr(data, "model_dump"):
        data = data.model_dump(by_alias=True)  # type: ignore
    click.echo(json.dumps(data, indent=2, default=str))


# ─── Main group ────────────────────────────────────────────────

@click.group()
@click.version_option(package_name="profit-step-agent")
def main() -> None:
    """Profit Step CRM Agent CLI."""
    pass


# ─── Auth ──────────────────────────────────────────────────────

@main.group()
def auth() -> None:
    """Authentication management."""
    pass


@auth.command("setup")
@click.option("--token", prompt="API Token", hide_input=True, help="40-hex per-employee token or admin API key")
def auth_setup(token: str) -> None:
    """Save API token to ~/.config/profit-step/token."""
    config_dir = os.path.expanduser("~/.config/profit-step")
    os.makedirs(config_dir, exist_ok=True)
    config_path = os.path.join(config_dir, "token")
    with open(config_path, "w") as f:
        f.write(token.strip())
    os.chmod(config_path, 0o600)
    click.echo(f"Token saved to {config_path}")


@auth.command("test")
def auth_test() -> None:
    """Test API connection and token validity."""
    try:
        agent = _agent()
        result = agent.health()
        click.echo(f"Connected to {agent.client.base_url}")
        _json(result)
    except CRMError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


# ─── Tasks ─────────────────────────────────────────────────────

@main.group()
def tasks() -> None:
    """Task management (GTD)."""
    pass


@tasks.command("list")
@click.option("--status", "-s", help="Filter by status")
@click.option("--assignee", help="Filter by assignee ID")
@click.option("--client", help="Filter by client ID")
@click.option("--limit", "-n", default=20, help="Max results")
def tasks_list(status: str | None, assignee: str | None, client: str | None, limit: int) -> None:
    """List tasks."""
    agent = _agent()
    result = agent.tasks.list(status=status, assignee_id=assignee, client_id=client, limit=limit)
    for t in result:
        flag = "!" if t.priority == "urgent" else " "
        click.echo(f"  {flag} [{t.status:12s}] {t.title}  (id={t.id[:8]})")
    click.echo(f"\n{len(result)} tasks")


@tasks.command("create")
@click.argument("title")
@click.option("--client", help="Client ID")
@click.option("--priority", "-p", default="medium", help="low/medium/high/urgent")
@click.option("--assignee", help="Assignee user ID")
def tasks_create(title: str, client: str | None, priority: str, assignee: str | None) -> None:
    """Create a new task."""
    agent = _agent()
    task_id = agent.tasks.create(title, client_id=client, priority=priority, assignee_id=assignee)
    click.echo(f"Created task: {task_id}")


# ─── Time ──────────────────────────────────────────────────────

@main.group()
def time() -> None:
    """Time tracking."""
    pass


@time.command("start")
@click.option("--client-id", help="Client ID")
@click.option("--client-name", help="Client name (if no ID)")
@click.option("--task-id", help="Link to a task")
def time_start(client_id: str | None, client_name: str | None, task_id: str | None) -> None:
    """Start a timer."""
    agent = _agent()
    result = agent.time.start(client_id=client_id, client_name=client_name, task_id=task_id)
    _json(result)


@time.command("stop")
def time_stop() -> None:
    """Stop the active timer."""
    agent = _agent()
    result = agent.time.stop()
    _json(result)


@time.command("status")
def time_status() -> None:
    """Show current timer status."""
    agent = _agent()
    result = agent.time.status()
    _json(result)


# ─── Costs ─────────────────────────────────────────────────────

@main.group()
def costs() -> None:
    """Cost/expense tracking."""
    pass


@costs.command("list")
@click.option("--client", help="Filter by client ID")
@click.option("--category", help="Filter by category")
@click.option("--from", "from_date", help="Start date (YYYY-MM-DD)")
@click.option("--to", "to_date", help="End date (YYYY-MM-DD)")
def costs_list(client: str | None, category: str | None, from_date: str | None, to_date: str | None) -> None:
    """List cost entries."""
    agent = _agent()
    result = agent.costs.list(client_id=client, category=category, from_date=from_date, to_date=to_date)
    for c in result:
        click.echo(f"  ${c.amount:>8.2f}  {c.category:15s}  {c.description}")
    click.echo(f"\n{len(result)} entries, total: ${sum(c.amount for c in result):.2f}")


@costs.command("add")
@click.option("--amount", "-a", required=True, type=float, help="Amount in dollars")
@click.option("--category", "-c", required=True, help="Category")
@click.option("--description", "-d", required=True, help="Description")
@click.option("--client", help="Client ID")
def costs_add(amount: float, category: str, description: str, client: str | None) -> None:
    """Add a cost entry."""
    agent = _agent()
    cost_id = agent.costs.create(amount, category, description, client_id=client)
    click.echo(f"Created cost: {cost_id}")


# ─── Payroll ───────────────────────────────────────────────────

@main.group()
def payroll() -> None:
    """Payroll self-service."""
    pass


@payroll.command("balance")
def payroll_balance() -> None:
    """Show my current balance."""
    agent = _agent()
    b = agent.payroll.my_balance()
    click.echo(f"  Running balance:  ${b.running_balance:>10.2f}")
    click.echo(f"  YTD earned:       ${b.ytd_earned:>10.2f}")
    click.echo(f"  YTD paid:         ${b.ytd_paid:>10.2f}")
    click.echo(f"  Advance balance:  ${b.advance_balance:>10.2f}")


@payroll.command("hours")
@click.option("--week-of", help="Date within target week (YYYY-MM-DD)")
def payroll_hours(week_of: str | None) -> None:
    """Show my hours this week."""
    agent = _agent()
    h = agent.payroll.my_hours(week_of=week_of)
    click.echo(f"  Week of: {h.week_of}")
    click.echo(f"  Total: {h.total_hours:.1f}h  |  Earnings: ${h.total_earnings:.2f}")
    if h.overtime_warning:
        click.echo("  ⚠️  OVERTIME WARNING: approaching 40h!")
    for d in h.days:
        click.echo(f"    {d.date}  {d.hours:>5.1f}h  ${d.earnings:>8.2f}  ({d.sessions} sessions)")


@payroll.command("pay")
@click.option("--period", help="Period (YYYY-MM)")
def payroll_pay(period: str | None) -> None:
    """Show my pay stub."""
    agent = _agent()
    p = agent.payroll.my_pay(period=period)
    click.echo(f"  Period: {p.period}")
    click.echo(f"  Gross:       ${p.gross:>10.2f}")
    click.echo(f"  Deductions:  ${p.deductions:>10.2f}")
    click.echo(f"  Net:         ${p.net:>10.2f}")
    click.echo(f"  Hours: {p.hours:.1f}h  |  Sessions: {p.sessions}")


# ─── Events ────────────────────────────────────────────────────

@main.group()
def events() -> None:
    """Event queue."""
    pass


@events.command("watch")
@click.option("--type", "event_type", help="Filter by event type")
@click.option("--interval", default=15.0, help="Poll interval in seconds")
def events_watch(event_type: str | None, interval: float) -> None:
    """Watch events in real-time (Ctrl+C to stop)."""
    agent = _agent()
    click.echo(f"Watching events (poll every {interval}s)... Press Ctrl+C to stop.")
    for event in agent.events.stream(event_type=event_type, interval=interval):
        ts = event.created_at.strftime("%H:%M:%S") if event.created_at else "??:??:??"
        click.echo(f"  [{ts}] {event.type}/{event.action}: {event.summary}")


if __name__ == "__main__":
    main()
