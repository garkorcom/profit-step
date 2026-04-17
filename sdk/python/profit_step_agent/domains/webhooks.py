"""Webhooks domain — manage webhook config on agent tokens."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import TYPE_CHECKING, Any

from profit_step_agent.models.webhooks import WebhookConfig, WebhookUpdateResult, WebhookEvent

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient

logger = logging.getLogger("profit_step_agent.webhooks")


class WebhooksDomain:
    """
    Interface for webhook management on agent tokens.

    Webhooks are configured per-token. When events occur in the CRM,
    the server sends HMAC-SHA256 signed HTTP POST requests to the
    registered webhook URL.

    Admin-only operations (require 'admin' scope).
    """

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    def update(
        self,
        token_id: str,
        *,
        webhook_url: str | None,
        webhook_events: list[str] | None = None,
    ) -> WebhookUpdateResult:
        """
        Set or update webhook config for a token.

        Args:
            token_id: The agent token ID to configure.
            webhook_url: HTTPS URL to receive events, or None to disable.
            webhook_events: Event filter patterns (e.g. ["task.*", "alert.budget_warning"]).
                           None = receive all events.

        Returns:
            WebhookUpdateResult with new config. If URL changed, includes
            the new webhook_secret (shown only once).
        """
        body: dict[str, Any] = {"webhookUrl": webhook_url}
        if webhook_events is not None:
            body["webhookEvents"] = webhook_events

        resp = self._c.patch(f"/api/agent-tokens/{token_id}/webhook", data=body)
        return WebhookUpdateResult(**resp)

    def disable(self, token_id: str) -> WebhookUpdateResult:
        """Disable webhook for a token (shortcut for update with url=None)."""
        return self.update(token_id, webhook_url=None)

    @staticmethod
    def verify_signature(payload: bytes | str, secret: str, signature: str) -> bool:
        """
        Verify an incoming webhook signature.

        Use this in your webhook handler to validate that the request
        came from ProfitStep and wasn't tampered with.

        Args:
            payload: Raw request body (bytes or string).
            secret: Your webhook secret (from token creation).
            signature: Value of X-Webhook-Signature header (sha256=xxx).

        Returns:
            True if signature is valid.

        Example:
            @app.post("/webhook")
            async def handle_webhook(request):
                body = await request.body()
                sig = request.headers["X-Webhook-Signature"]
                if not WebhooksDomain.verify_signature(body, MY_SECRET, sig):
                    return Response(status_code=401)
                event = WebhookEvent(**json.loads(body))
                print(f"Got: {event.event_key} — {event.summary}")
        """
        if isinstance(payload, str):
            payload = payload.encode("utf-8")

        expected = hmac.new(
            secret.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).hexdigest()

        # Strip "sha256=" prefix if present
        actual = signature.removeprefix("sha256=")

        return hmac.compare_digest(expected, actual)

    @staticmethod
    def parse_event(payload: bytes | str) -> WebhookEvent:
        """
        Parse a webhook payload into a WebhookEvent.

        Args:
            payload: Raw request body (bytes or string).

        Returns:
            Parsed WebhookEvent object.
        """
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        data = json.loads(payload)
        return WebhookEvent(**data)
