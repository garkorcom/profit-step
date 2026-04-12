"""
Low-level HTTP client with retry, timeout, and error mapping.

CRMClient is the foundation — domain classes wrap it with typed methods.
"""

from __future__ import annotations

import os
import time
import logging
from typing import Any

import httpx

from profit_step_agent.exceptions import raise_for_status, RateLimitError

logger = logging.getLogger("profit_step_agent")

DEFAULT_BASE_URL = "https://us-central1-profit-step.cloudfunctions.net/agentApi"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 3


class CRMClient:
    """
    Thin HTTP wrapper around the Agent API.

    Features:
    - Bearer token auth (admin key or per-employee 40-hex token)
    - Automatic retry on 429 (rate limit) and 503 (service unavailable)
    - Exponential backoff with jitter
    - Request/response logging at DEBUG level
    """

    def __init__(
        self,
        token: str | None = None,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        self.token = token or os.environ.get("PROFIT_STEP_TOKEN", "")
        if not self.token:
            raise ValueError(
                "Token required. Pass token= or set PROFIT_STEP_TOKEN env var."
            )

        self.base_url = (base_url or os.environ.get("PROFIT_STEP_API_URL", DEFAULT_BASE_URL)).rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries

        self._http = httpx.Client(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "User-Agent": "profit-step-agent-sdk/0.1.0",
            },
            timeout=timeout,
        )

    # ─── Core request method ────────────────────────────────────────

    def request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Send an HTTP request with retry logic.

        Returns parsed JSON body. Raises CRMError subclass on failure.
        """
        # Strip None values from params
        if params:
            params = {k: v for k, v in params.items() if v is not None}

        last_error: Exception | None = None

        for attempt in range(1, self.max_retries + 1):
            try:
                logger.debug(
                    "%s %s (attempt %d/%d) params=%s",
                    method.upper(), path, attempt, self.max_retries, params,
                )

                resp = self._http.request(
                    method, path, json=json, params=params,
                )

                logger.debug("Response %d (%d bytes)", resp.status_code, len(resp.content))

                # Parse body
                try:
                    body = resp.json()
                except Exception:
                    body = {"error": resp.text or "Empty response"}

                # Success
                if resp.status_code < 400:
                    return body

                # Rate limit — retry with backoff
                if resp.status_code == 429:
                    retry_after = float(resp.headers.get("Retry-After", "60"))
                    wait = min(retry_after, 2 ** attempt)
                    logger.warning("Rate limited (429). Waiting %.1fs...", wait)
                    time.sleep(wait)
                    last_error = RateLimitError(
                        body.get("error", "Rate limited"), retry_after=retry_after
                    )
                    continue

                # Server error — retry
                if resp.status_code >= 500 and attempt < self.max_retries:
                    wait = 2 ** attempt
                    logger.warning("Server error %d. Retrying in %ds...", resp.status_code, wait)
                    time.sleep(wait)
                    continue

                # Client error or final retry — raise
                raise_for_status(resp.status_code, body)

            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as e:
                last_error = e
                if attempt < self.max_retries:
                    wait = 2 ** attempt
                    logger.warning("Connection error: %s. Retrying in %ds...", e, wait)
                    time.sleep(wait)
                    continue
                raise

        # Should not reach here, but just in case
        if last_error:
            raise last_error
        raise RuntimeError("Max retries exhausted")

    # ─── Convenience methods ────────────────────────────────────────

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        return self.request("GET", path, params=params)

    def post(self, path: str, data: dict[str, Any] | None = None, **params: Any) -> dict[str, Any]:
        return self.request("POST", path, json=data, params=params)

    def patch(self, path: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.request("PATCH", path, json=data)

    def delete(self, path: str) -> dict[str, Any]:
        return self.request("DELETE", path)

    # ─── Health check ───────────────────────────────────────────────

    def health(self) -> dict[str, Any]:
        """Check API health and auth validity."""
        return self.get("/api/health")

    # ─── Lifecycle ──────────────────────────────────────────────────

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> CRMClient:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
