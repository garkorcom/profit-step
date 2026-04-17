"""Events domain — poll and stream agent events."""

from __future__ import annotations

import time
import logging
from typing import TYPE_CHECKING, AsyncGenerator
from datetime import datetime, timezone

from profit_step_agent.models.events import Event

if TYPE_CHECKING:
    from profit_step_agent.client import CRMClient

logger = logging.getLogger("profit_step_agent.events")


class EventsDomain:
    """Interface for /api/events — polling and streaming."""

    def __init__(self, client: CRMClient) -> None:
        self._c = client

    def poll(
        self,
        *,
        since: str | None = None,
        event_type: str | None = None,
        limit: int = 50,
    ) -> list[Event]:
        """
        Poll for new events.

        Args:
            since: ISO timestamp — return events after this time
            event_type: Filter by type (task, session, cost, etc.)
            limit: Max events to return
        """
        params: dict = {"limit": limit}
        if since:
            params["since"] = since
        if event_type:
            params["type"] = event_type

        resp = self._c.get("/api/events", **params)
        items = resp.get("events", resp.get("items", []))
        return [Event(**e) for e in items]

    def ack(self, event_id: str) -> bool:
        """Acknowledge an event (marks it as read)."""
        resp = self._c.post(f"/api/events/{event_id}/ack")
        return resp.get("acknowledged", False)

    def stream(
        self,
        *,
        event_type: str | None = None,
        interval: float = 15.0,
        limit: int = 50,
    ):
        """
        Generator that continuously polls for new events.

        Yields Event objects as they arrive. Tracks watermark automatically.

        Usage:
            for event in agent.events.stream(event_type="task"):
                print(f"New: {event.summary}")
                agent.events.ack(event.id)
        """
        watermark = datetime.now(timezone.utc).isoformat()

        while True:
            try:
                events = self.poll(
                    since=watermark,
                    event_type=event_type,
                    limit=limit,
                )

                for event in events:
                    yield event

                    # Advance watermark
                    if event.created_at:
                        event_ts = event.created_at.isoformat()
                        if event_ts > watermark:
                            watermark = event_ts

                if not events:
                    time.sleep(interval)
                else:
                    # Brief pause between batches
                    time.sleep(1.0)

            except KeyboardInterrupt:
                logger.info("Event stream stopped by user")
                break
            except Exception as e:
                logger.warning("Event poll error: %s. Retrying in %ds...", e, interval)
                time.sleep(interval)
