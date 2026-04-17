"""
01_smoke_check.py — first script to run after you get a token.

Verifies:
  1. Token is valid (auth succeeds)
  2. API is reachable
  3. SDK import + pydantic models work

Run:
    PROFIT_STEP_TOKEN=ak_... python 01_smoke_check.py
"""

import os
import sys

from profit_step_agent import CRMAgent, CRMError


def main() -> int:
    token = os.environ.get("PROFIT_STEP_TOKEN")
    if not token:
        print("ERROR: set PROFIT_STEP_TOKEN env var with your API token.")
        return 2

    print(f"Testing token {token[:8]}... against profit-step.web.app")

    try:
        with CRMAgent(token=token) as agent:
            health = agent.health()
            print(f"\n✓ Health: {health}")

            tasks = agent.tasks.list(limit=3)
            print(f"✓ Tasks endpoint reachable: {len(tasks)} returned (limit=3)")

            status = agent.time.status()
            print(f"✓ Time-tracking status: {status.get('status', 'idle')}")
    except CRMError as e:
        print(f"\n✗ API error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    print("\nAll green. Your token works.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
