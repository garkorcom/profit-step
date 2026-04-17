"""Webhook configuration models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class WebhookConfig(BaseModel):
    """Webhook configuration for a token."""

    webhook_url: str | None = Field(default=None, alias="webhookUrl")
    webhook_secret: str | None = Field(default=None, alias="webhookSecret")
    webhook_events: list[str] | None = Field(default=None, alias="webhookEvents")
    has_webhook: bool = Field(default=False, alias="hasWebhook")

    model_config = {"populate_by_name": True, "extra": "allow"}


class WebhookUpdateResult(BaseModel):
    """Result of updating webhook config."""

    updated: bool = False
    token_id: str = Field(default="", alias="tokenId")
    webhook_url: str | None = Field(default=None, alias="webhookUrl")
    webhook_events: list[str] | None = Field(default=None, alias="webhookEvents")
    webhook_secret: str | None = Field(default=None, alias="webhookSecret")
    warning: str | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}


class WebhookEvent(BaseModel):
    """An event received via webhook push notification."""

    id: str | None = None
    type: str = ""
    action: str = ""
    entity_id: str = Field(default="", alias="entityId")
    entity_type: str = Field(default="", alias="entityType")
    summary: str = ""
    data: dict | None = None
    employee_id: str | None = Field(default=None, alias="employeeId")
    source: str = ""
    timestamp: str = ""

    model_config = {"populate_by_name": True, "extra": "allow"}

    @property
    def event_key(self) -> str:
        """Return event key in 'type.action' format."""
        return f"{self.type}.{self.action}"
