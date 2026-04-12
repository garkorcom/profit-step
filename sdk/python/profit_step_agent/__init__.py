"""
Profit Step Agent SDK — Python client for the CRM Agent API.

Usage:
    from profit_step_agent import CRMAgent

    agent = CRMAgent(token="your-40-hex-token")
    tasks = agent.tasks.list(status="next_action")
    agent.time.start(client_id="abc123")
"""

from profit_step_agent.agent import CRMAgent
from profit_step_agent.client import CRMClient
from profit_step_agent.exceptions import (
    CRMError,
    ValidationError,
    ScopeError,
    RateLimitError,
    NotFoundError,
)
from profit_step_agent.models.webhooks import WebhookEvent
from profit_step_agent.domains.webhooks import WebhooksDomain

__version__ = "0.2.0"
__all__ = [
    "CRMAgent",
    "CRMClient",
    "CRMError",
    "ValidationError",
    "ScopeError",
    "RateLimitError",
    "NotFoundError",
    "WebhookEvent",
    "WebhooksDomain",
]
