"""
SDK exceptions mapped to API error codes.

Hierarchy:
    CRMError
    ├── ValidationError   (400 + VALIDATION_ERROR)
    ├── ScopeError        (403 + FORBIDDEN)
    ├── NotFoundError     (404)
    ├── RateLimitError    (429)
    └── ServerError       (500+)
"""

from __future__ import annotations

from typing import Any


class CRMError(Exception):
    """Base exception for all CRM API errors."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        code: str | None = None,
        request_id: str | None = None,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.request_id = request_id
        self.details = details or []

    def __repr__(self) -> str:
        parts = [f"CRMError({self.status_code}"]
        if self.code:
            parts[0] += f" {self.code}"
        parts[0] += f"): {self}"
        return parts[0]


class ValidationError(CRMError):
    """Request validation failed (400)."""

    pass


class ScopeError(CRMError):
    """Insufficient token scopes (403)."""

    pass


class NotFoundError(CRMError):
    """Resource not found (404)."""

    pass


class RateLimitError(CRMError):
    """Rate limit exceeded (429). Check retry_after_seconds."""

    def __init__(self, message: str, retry_after: float = 60.0, **kwargs: Any) -> None:
        super().__init__(message, status_code=429, **kwargs)
        self.retry_after_seconds = retry_after


class ServerError(CRMError):
    """Server-side error (500+)."""

    pass


def raise_for_status(status_code: int, body: dict[str, Any]) -> None:
    """Raise the appropriate exception based on HTTP status and body."""
    if status_code < 400:
        return

    msg = body.get("error", "Unknown error")
    code = body.get("code")
    request_id = body.get("requestId")
    details = body.get("details", [])

    kwargs: dict[str, Any] = {
        "status_code": status_code,
        "code": code,
        "request_id": request_id,
        "details": details,
    }

    if status_code == 400 and code == "VALIDATION_ERROR":
        raise ValidationError(msg, **kwargs)
    if status_code == 403:
        raise ScopeError(msg, **kwargs)
    if status_code == 404:
        raise NotFoundError(msg, **kwargs)
    if status_code == 429:
        raise RateLimitError(msg, retry_after=60.0, **kwargs)
    if status_code >= 500:
        raise ServerError(msg, **kwargs)

    raise CRMError(msg, **kwargs)
