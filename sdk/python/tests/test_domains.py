"""Tests for domain classes — tasks, time, costs, events, payroll."""

import pytest
import respx
import httpx

from profit_step_agent import CRMAgent

BASE = "https://test-api.example.com"
TOKEN = "a" * 40


@pytest.fixture
def agent():
    a = CRMAgent(token=TOKEN, base_url=BASE, timeout=5.0)
    yield a
    a.close()


# ─── Tasks ─────────────────────────────────────────────────────

@respx.mock
def test_tasks_list(agent: CRMAgent):
    respx.get(f"{BASE}/api/tasks/list").mock(
        return_value=httpx.Response(200, json={"tasks": [
            {"id": "t1", "title": "Fix wiring", "status": "next_action", "priority": "high"},
            {"id": "t2", "title": "Buy materials", "status": "inbox", "priority": "medium"},
        ]})
    )
    tasks = agent.tasks.list(status="next_action")
    assert len(tasks) == 2
    assert tasks[0].title == "Fix wiring"
    assert tasks[0].priority == "high"


@respx.mock
def test_tasks_create(agent: CRMAgent):
    respx.post(f"{BASE}/api/tasks").mock(
        return_value=httpx.Response(201, json={"taskId": "new-task-123"})
    )
    task_id = agent.tasks.create("Test task", priority="urgent")
    assert task_id == "new-task-123"


@respx.mock
def test_tasks_complete(agent: CRMAgent):
    respx.patch(f"{BASE}/api/tasks/t1").mock(
        return_value=httpx.Response(200, json={"updated": True})
    )
    assert agent.tasks.complete("t1") is True


# ─── Time ──────────────────────────────────────────────────────

@respx.mock
def test_time_start(agent: CRMAgent):
    respx.post(f"{BASE}/api/time-tracking").mock(
        return_value=httpx.Response(201, json={"sessionId": "s1", "status": "started"})
    )
    result = agent.time.start(client_id="c1")
    assert result["sessionId"] == "s1"


@respx.mock
def test_time_stop(agent: CRMAgent):
    respx.post(f"{BASE}/api/time-tracking").mock(
        return_value=httpx.Response(200, json={"stopped": True, "durationMinutes": 45})
    )
    result = agent.time.stop()
    assert result["stopped"] is True


@respx.mock
def test_time_active_all(agent: CRMAgent):
    respx.get(f"{BASE}/api/time-tracking/active-all").mock(
        return_value=httpx.Response(200, json={"sessions": [
            {"id": "s1", "employeeId": "uid1", "employeeName": "Vasya", "status": "active",
             "clientName": "Jim", "durationMinutes": 120, "hourlyRate": 35},
        ]})
    )
    sessions = agent.time.active_all()
    assert len(sessions) == 1
    assert sessions[0].employee_name == "Vasya"
    assert sessions[0].hours == 2.0
    assert sessions[0].is_active is True


# ─── Costs ─────────────────────────────────────────────────────

@respx.mock
def test_costs_list(agent: CRMAgent):
    respx.get(f"{BASE}/api/costs/list").mock(
        return_value=httpx.Response(200, json={"costs": [
            {"id": "c1", "amount": 150, "category": "materials", "description": "Wire"},
        ]})
    )
    costs = agent.costs.list(category="materials")
    assert len(costs) == 1
    assert costs[0].amount == 150


@respx.mock
def test_costs_create(agent: CRMAgent):
    respx.post(f"{BASE}/api/costs").mock(
        return_value=httpx.Response(201, json={"costId": "c-new"})
    )
    cost_id = agent.costs.create(99.50, "tools", "Drill bit set")
    assert cost_id == "c-new"


# ─── Events ────────────────────────────────────────────────────

@respx.mock
def test_events_poll(agent: CRMAgent):
    respx.get(f"{BASE}/api/events").mock(
        return_value=httpx.Response(200, json={"events": [
            {"id": "e1", "type": "task", "action": "created", "summary": "New task: Fix wiring",
             "entityId": "t1", "entityType": "gtd_task", "source": "api"},
        ]})
    )
    events = agent.events.poll(event_type="task")
    assert len(events) == 1
    assert events[0].action == "created"


# ─── Payroll ───────────────────────────────────────────────────

@respx.mock
def test_payroll_balance(agent: CRMAgent):
    respx.get(f"{BASE}/api/payroll/my-balance").mock(
        return_value=httpx.Response(200, json={
            "runningBalance": 1500.00,
            "ytdEarned": 15000.00,
            "ytdPaid": 13500.00,
            "advanceBalance": 200.00,
        })
    )
    balance = agent.payroll.my_balance()
    assert balance.running_balance == 1500.00
    assert balance.ytd_earned == 15000.00


@respx.mock
def test_payroll_hours(agent: CRMAgent):
    respx.get(f"{BASE}/api/payroll/my-hours").mock(
        return_value=httpx.Response(200, json={
            "weekOf": "2026-04-06",
            "totalHours": 38.5,
            "totalEarnings": 1347.50,
            "overtimeWarning": False,
            "days": [
                {"date": "2026-04-06", "hours": 8.0, "sessions": 1, "earnings": 280.00, "projects": ["Jim"]},
            ],
        })
    )
    hours = agent.payroll.my_hours()
    assert hours.total_hours == 38.5
    assert len(hours.days) == 1
    assert hours.days[0].projects == ["Jim"]


# ─── Clients ───────────────────────────────────────────────────

@respx.mock
def test_clients_search(agent: CRMAgent):
    respx.get(f"{BASE}/api/clients/search").mock(
        return_value=httpx.Response(200, json={"results": [
            {"id": "cl1", "name": "Jim Dvorkin", "type": "residential"},
        ]})
    )
    clients = agent.clients.search("jim")
    assert len(clients) == 1
    assert clients[0].name == "Jim Dvorkin"
