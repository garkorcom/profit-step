"""Tests for webhook domain — signature verification, event parsing, API calls."""

import json

import pytest
import respx
import httpx

from profit_step_agent import CRMAgent
from profit_step_agent.domains.webhooks import WebhooksDomain
from profit_step_agent.models.webhooks import WebhookEvent, WebhookUpdateResult

BASE = "https://test-api.example.com"
TOKEN = "a" * 40


@pytest.fixture
def agent():
    a = CRMAgent(token=TOKEN, base_url=BASE, timeout=5.0)
    yield a
    a.close()


# ─── API calls ────────────────────────────────────────────────

@respx.mock
def test_webhook_update(agent: CRMAgent):
    respx.patch(f"{BASE}/api/agent-tokens/tok123/webhook").mock(
        return_value=httpx.Response(200, json={
            "updated": True,
            "tokenId": "tok123",
            "webhookUrl": "https://my-server.com/hook",
            "webhookEvents": ["task.*", "alert.*"],
            "webhookSecret": "secret-abc",
            "warning": "Save this webhook secret now — it will not be shown again.",
        })
    )
    result = agent.webhooks.update(
        "tok123",
        webhook_url="https://my-server.com/hook",
        webhook_events=["task.*", "alert.*"],
    )
    assert result.updated is True
    assert result.webhook_secret == "secret-abc"
    assert result.webhook_url == "https://my-server.com/hook"


@respx.mock
def test_webhook_disable(agent: CRMAgent):
    respx.patch(f"{BASE}/api/agent-tokens/tok123/webhook").mock(
        return_value=httpx.Response(200, json={
            "updated": True,
            "tokenId": "tok123",
            "webhookUrl": None,
            "webhookEvents": None,
        })
    )
    result = agent.webhooks.disable("tok123")
    assert result.updated is True
    assert result.webhook_url is None


# ─── Signature verification ───────────────────────────────────

def test_verify_signature_valid():
    payload = '{"type":"task","action":"created"}'
    secret = "my-webhook-secret"

    import hmac
    import hashlib
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

    assert WebhooksDomain.verify_signature(payload, secret, f"sha256={sig}") is True


def test_verify_signature_invalid():
    payload = '{"type":"task","action":"created"}'
    secret = "my-webhook-secret"

    assert WebhooksDomain.verify_signature(payload, secret, "sha256=wrong") is False


def test_verify_signature_without_prefix():
    """Signature without sha256= prefix should also work."""
    payload = '{"type":"task","action":"created"}'
    secret = "my-webhook-secret"

    import hmac
    import hashlib
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

    assert WebhooksDomain.verify_signature(payload, secret, sig) is True


def test_verify_signature_bytes_payload():
    """Should work with bytes payload too."""
    payload = b'{"type":"task","action":"created"}'
    secret = "my-webhook-secret"

    import hmac
    import hashlib
    sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

    assert WebhooksDomain.verify_signature(payload, secret, f"sha256={sig}") is True


# ─── Event parsing ────────────────────────────────────────────

def test_parse_event():
    payload = json.dumps({
        "id": "evt-1",
        "type": "task",
        "action": "assigned",
        "entityId": "t1",
        "entityType": "gtd_task",
        "summary": "Task assigned to Vasya",
        "data": {"priority": "high"},
        "employeeId": "uid1",
        "source": "api",
        "timestamp": "2026-04-12T10:00:00Z",
    })

    event = WebhooksDomain.parse_event(payload)
    assert event.type == "task"
    assert event.action == "assigned"
    assert event.entity_id == "t1"
    assert event.summary == "Task assigned to Vasya"
    assert event.event_key == "task.assigned"
    assert event.data == {"priority": "high"}


def test_parse_event_bytes():
    payload = b'{"type":"cost","action":"created","entityId":"c1","entityType":"cost","summary":"New cost"}'
    event = WebhooksDomain.parse_event(payload)
    assert event.type == "cost"
    assert event.event_key == "cost.created"


# ─── WebhookEvent model ──────────────────────────────────────

def test_webhook_event_model():
    event = WebhookEvent(
        type="session",
        action="started",
        entityId="s1",
        entityType="work_session",
        summary="Session started",
    )
    assert event.event_key == "session.started"
    assert event.entity_id == "s1"
