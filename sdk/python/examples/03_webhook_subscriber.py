"""
03_webhook_subscriber.py — Flask endpoint that receives CRM webhooks,
verifies HMAC-SHA256 signatures, and logs events.

Boilerplate for building integration bots (Slack notifier, CRM sync, audit log forwarder).

Setup:
  1. Register a webhook subscription in the CRM:

         agent.webhooks.create(
             url="https://your-server.example.com/crm-webhook",
             events=["task.created", "task.done", "cost.approved"],
             secret="your-secret-for-hmac-verify",
         )

  2. Run this script:

         WEBHOOK_SECRET=your-secret-for-hmac-verify python 03_webhook_subscriber.py

  3. Expose it (ngrok http 5000 for testing). Use the public URL from
     step 1.

Each event body matches the schema in `profit_step_agent.models.webhooks.WebhookEvent`.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
from typing import Any

try:
    from flask import Flask, abort, request
except ImportError:
    print("pip install flask  # required for this example", file=sys.stderr)
    sys.exit(2)

from profit_step_agent.models.webhooks import WebhookEvent
from pydantic import ValidationError

SECRET = os.environ.get("WEBHOOK_SECRET", "").encode()
if not SECRET:
    print("ERROR: set WEBHOOK_SECRET env var.", file=sys.stderr)
    sys.exit(2)

app = Flask(__name__)


def verify_signature(raw_body: bytes, sent_sig: str) -> bool:
    """Timing-safe HMAC-SHA256 verification."""
    expected = hmac.new(SECRET, raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sent_sig or "")


@app.post("/crm-webhook")
def receive() -> dict[str, Any]:
    raw = request.get_data()
    sig = request.headers.get("X-Hub-Signature-256", "").removeprefix("sha256=")

    if not verify_signature(raw, sig):
        app.logger.warning("Rejected webhook — invalid signature")
        abort(401)

    try:
        body = json.loads(raw)
        event = WebhookEvent.model_validate(body)
    except (json.JSONDecodeError, ValidationError) as e:
        app.logger.warning("Rejected webhook — bad payload: %s", e)
        abort(400)

    # Handle the event. Real integrations would route to slack/db/etc.
    app.logger.info(
        "Event %s for %s (id=%s): %s",
        event.event_type, event.resource_type, event.resource_id, event.summary or "",
    )

    # Example dispatch
    if event.event_type == "task.done":
        print(f"🎉 Task done: {event.summary}  (by {event.actor_name or 'unknown'})")
    elif event.event_type == "cost.approved":
        print(f"💵 Cost approved: ${event.payload.get('amount', 0)} on {event.payload.get('clientName', 'no project')}")
    else:
        print(f"📨 {event.event_type}")

    return {"ok": True}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
