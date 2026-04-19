"""
CRMAgent — main entry point for the SDK.

Usage:
    from profit_step_agent import CRMAgent

    agent = CRMAgent(token="abc123...")

    # Tasks
    tasks = agent.tasks.list(status="next_action")
    agent.tasks.create("Fix wiring", client_id="xyz")

    # Time tracking
    agent.time.start(client_id="xyz")
    agent.time.stop()

    # Costs
    agent.costs.create(150.0, "materials", "Wire 12 AWG", client_id="xyz")

    # Events (streaming)
    for event in agent.events.stream(event_type="task"):
        print(event.summary)

    # Payroll (self-service)
    balance = agent.payroll.my_balance()
    print(f"Balance: ${balance.running_balance}")
"""

from __future__ import annotations

from profit_step_agent.client import CRMClient
from profit_step_agent.domains.tasks import TasksDomain
from profit_step_agent.domains.time import TimeDomain
from profit_step_agent.domains.costs import CostsDomain
from profit_step_agent.domains.events import EventsDomain
from profit_step_agent.domains.clients import ClientsDomain
from profit_step_agent.domains.projects import ProjectsDomain
from profit_step_agent.domains.inventory import InventoryDomain
from profit_step_agent.domains.payroll import PayrollDomain
from profit_step_agent.domains.webhooks import WebhooksDomain


class CRMAgent:
    """
    High-level CRM Agent interface.

    Exposes domain-specific controllers as properties:
    - agent.tasks  → TasksDomain
    - agent.time   → TimeDomain
    - agent.costs  → CostsDomain
    - agent.events → EventsDomain
    - agent.clients → ClientsDomain
    - agent.projects → ProjectsDomain
    - agent.inventory → InventoryDomain
    - agent.payroll → PayrollDomain
    - agent.webhooks → WebhooksDomain

    Args:
        token: API token (admin key or per-employee 40-hex token).
               Falls back to PROFIT_STEP_TOKEN env var.
        base_url: Override API base URL. Defaults to production.
        timeout: HTTP timeout in seconds.
        max_retries: Max retry attempts for 429/5xx errors.
    """

    def __init__(
        self,
        token: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
        max_retries: int = 3,
    ) -> None:
        self._client = CRMClient(
            token=token,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )

        self.tasks = TasksDomain(self._client)
        self.time = TimeDomain(self._client)
        self.costs = CostsDomain(self._client)
        self.events = EventsDomain(self._client)
        self.clients = ClientsDomain(self._client)
        self.projects = ProjectsDomain(self._client)
        self.inventory = InventoryDomain(self._client)
        self.payroll = PayrollDomain(self._client)
        self.webhooks = WebhooksDomain(self._client)

    @property
    def client(self) -> CRMClient:
        """Access the underlying HTTP client for advanced usage."""
        return self._client

    def health(self) -> dict:
        """Check API health and connection."""
        return self._client.health()

    def close(self) -> None:
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self) -> CRMAgent:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def __repr__(self) -> str:
        return f"CRMAgent(base_url={self._client.base_url!r})"
