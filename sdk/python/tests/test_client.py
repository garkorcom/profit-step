"""Tests for CRMClient — HTTP layer, retries, error mapping."""

import pytest
import respx
import httpx

from profit_step_agent.client import CRMClient
from profit_step_agent.exceptions import (
    ValidationError,
    ScopeError,
    NotFoundError,
    RateLimitError,
    ServerError,
)

BASE = "https://test-api.example.com"
TOKEN = "a" * 40


@pytest.fixture
def client():
    c = CRMClient(token=TOKEN, base_url=BASE, timeout=5.0, max_retries=2)
    yield c
    c.close()


@respx.mock
def test_get_success(client: CRMClient):
    respx.get(f"{BASE}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok", "version": "4.3.0"})
    )
    result = client.get("/api/health")
    assert result["status"] == "ok"


@respx.mock
def test_post_success(client: CRMClient):
    respx.post(f"{BASE}/api/tasks").mock(
        return_value=httpx.Response(201, json={"taskId": "abc123"})
    )
    result = client.post("/api/tasks", data={"title": "Test"})
    assert result["taskId"] == "abc123"


@respx.mock
def test_validation_error(client: CRMClient):
    respx.post(f"{BASE}/api/tasks").mock(
        return_value=httpx.Response(400, json={
            "error": "Title is required",
            "code": "VALIDATION_ERROR",
            "details": [{"field": "title", "message": "required"}],
        })
    )
    with pytest.raises(ValidationError) as exc_info:
        client.post("/api/tasks", data={})
    assert "Title is required" in str(exc_info.value)
    assert exc_info.value.code == "VALIDATION_ERROR"


@respx.mock
def test_scope_error(client: CRMClient):
    respx.get(f"{BASE}/api/finance/context").mock(
        return_value=httpx.Response(403, json={
            "error": "Insufficient scopes",
            "code": "FORBIDDEN",
        })
    )
    with pytest.raises(ScopeError):
        client.get("/api/finance/context")


@respx.mock
def test_not_found(client: CRMClient):
    respx.get(f"{BASE}/api/tasks/nonexistent").mock(
        return_value=httpx.Response(404, json={"error": "Task not found"})
    )
    with pytest.raises(NotFoundError):
        client.get("/api/tasks/nonexistent")


@respx.mock
def test_rate_limit_retry(client: CRMClient):
    """Should retry once on 429, then succeed."""
    route = respx.get(f"{BASE}/api/tasks/list")
    route.side_effect = [
        httpx.Response(429, json={"error": "Rate limited"}, headers={"Retry-After": "1"}),
        httpx.Response(200, json={"tasks": []}),
    ]
    result = client.get("/api/tasks/list")
    assert result == {"tasks": []}
    assert route.call_count == 2


@respx.mock
def test_server_error_retry(client: CRMClient):
    """Should retry on 500, then raise on final attempt."""
    respx.get(f"{BASE}/api/health").mock(
        return_value=httpx.Response(500, json={"error": "Internal error"})
    )
    with pytest.raises(ServerError):
        client.get("/api/health")


@respx.mock
def test_params_strip_none(client: CRMClient):
    """None params should be stripped."""
    route = respx.get(f"{BASE}/api/tasks/list").mock(
        return_value=httpx.Response(200, json={"tasks": []})
    )
    client.request("GET", "/api/tasks/list", params={"status": "inbox", "clientId": None})
    assert "clientId" not in str(route.calls[0].request.url)


def test_missing_token():
    """Should raise ValueError if no token provided."""
    import os
    old = os.environ.pop("PROFIT_STEP_TOKEN", None)
    try:
        with pytest.raises(ValueError, match="Token required"):
            CRMClient(token="", base_url=BASE)
    finally:
        if old:
            os.environ["PROFIT_STEP_TOKEN"] = old
