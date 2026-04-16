# Agent Setup Guide — Profit Step CRM

> ⚠️ **Частично устарел (2026-04-16).** Разделы 2–3 описывают режим авторизации
> «per-employee 40-hex-token» из коллекции `agent_tokens`, который **в коде не реализован**
> (`functions/src/agent/agentMiddleware.ts` поддерживает только два режима: static
> `AGENT_API_KEY` env var и Firebase JWT).
>
> **Для AI-ботов (openclaw, Telegram, GPT Assistants)** используй актуальный system prompt:
> 👉 [`docs/AI_ASSISTANT_BOT_PROMPT.md`](./AI_ASSISTANT_BOT_PROMPT.md)
>
> Остальные разделы (API reference, examples, error handling) ещё актуальны.

> Full guide for setting up an AI agent on a remote machine to work with Profit Step CRM.
> Covers: authentication, API access, Python SDK, Telegram bridge, event system, bug reporting.

**CRM Production URL:** `https://profit-step.web.app`
**API Base URL:** `https://us-central1-profit-step.cloudfunctions.net/agentApi`
**Alternative API URL:** `https://profit-step.web.app/api` (Firebase Hosting rewrite)

---

## Table of Contents

1. [Quick Start (5 min)](#1-quick-start)
2. [Authentication Deep Dive](#2-authentication)
3. [Getting Your Token](#3-getting-your-token)
4. [Python SDK Setup](#4-python-sdk)
5. [API Reference — All Endpoints](#5-api-reference)
6. [Event System (Webhooks + Polling)](#6-events)
7. [Telegram Integration](#7-telegram)
8. [Error Handling & Self-Correction](#8-errors)
9. [Rate Limits](#9-rate-limits)
10. [Filing Bugs & Improvements (TZ)](#10-agent-feedback)
11. [Security Rules](#11-security)
12. [Troubleshooting](#12-troubleshooting)
13. [Full Working Examples](#13-examples)

---

## 1. Quick Start

### Minimum Requirements
- Python 3.10+ OR any HTTP client (curl, Node.js, etc.)
- API token (get from Denis / admin)
- Internet access to `profit-step.web.app`

### 30-second test

```bash
# Check API is alive (no auth needed)
curl https://us-central1-profit-step.cloudfunctions.net/agentApi/api/health

# Should return:
# {"status":"ok","version":"4.2.0","uptime":...}
```

### First authenticated request

```bash
# Master token = value of AGENT_API_KEY on the backend (ask Denis)
export PROFIT_STEP_TOKEN="<master-token-from-denis>"

curl -H "Authorization: Bearer $PROFIT_STEP_TOKEN" \
     -H "Content-Type: application/json" \
     https://profit-step.web.app/api/dashboard
```

If you see dashboard JSON — you're in. If you get 401 — token is wrong or unset. See [`AI_ASSISTANT_BOT_PROMPT.md`](./AI_ASSISTANT_BOT_PROMPT.md) for details.

---

## 2. Authentication

> **Verified against prod code on 2026-04-16** — `agentMiddleware.ts` at `functions/src/agent/agentMiddleware.ts:58-145`.
>
> Earlier versions of this guide described a third "Per-employee token" mode backed
> by an `agent_tokens` collection. **That mode is not wired into the middleware.**
> There is migration code for the collection (`POST /api/users/migrate-multi-user`),
> but the auth layer only checks the two modes below. Tokens created via the old
> admin UI will return 401 until the feature is finished.

The API supports **2 authentication modes**, both using the same header:

```
Authorization: Bearer <token>
```

| Mode | Who Uses It | Token Source | Access Level |
|------|-------------|--------------|--------------|
| **Static master token** | Server-to-server, AI agents, bots (OpenClaw, `@crmapiprofit_bot`, etc.) | Value of `AGENT_API_KEY` env var on Firebase Functions | Full admin |
| **Firebase JWT** | Browser / React frontend | `getIdToken()` from Firebase Auth | Full admin (for logged-in users) |

### How it works

```
Your Agent → HTTP Request
               ↓
         Authorization: Bearer <token>
               ↓
         agentMiddleware.ts validates:
           IF token === process.env.AGENT_API_KEY  → master
           ELSE admin.auth().verifyIdToken(token)  → JWT
           ELSE 401 "Invalid authorization token"
               ↓
         Sets on request:
           req.agentUserId    = OWNER_UID (master) or decoded.uid (JWT)
           req.agentUserName  = OWNER_DISPLAY_NAME or decoded.name
           req.agentTokenType = 'master' | 'jwt'
           req.effectiveRole  = 'admin' (both modes default to admin)
               ↓
         Rate limit check (60 req/min)
               ↓
         Route handler (business logic)
```

### Acting as another user (master token only)

A request with the master token may include `X-Impersonate-User: <firebaseUid>` to
act on behalf of that user. The middleware loads the user's role/scopes/team and
populates `req.effective*` fields. JWT mode ignores this header.

### Headers — Every Request

```
Authorization: Bearer <your-token>
Content-Type: application/json
```

Optional:
```
X-Source: agent         # Marks source in audit logs
X-Idempotency-Key: <uuid>  # Prevents duplicate creates
```

---

## 3. Getting Your Token

### Ask Denis for the master token

The master token is the value of the `AGENT_API_KEY` environment variable on the
Firebase Functions deployment. Denis can retrieve it via:

```bash
# On Denis's machine — reveals current master token
firebase functions:config:get        # if still using functions.config()
# or
cat functions/.env                   # if migrated to dotenv
# or check Firebase Console → Functions → Environment
```

Denis hands this value to you (via secure channel — 1Password, signal, etc.).
Store it in your platform's secrets manager:

| Platform | Where to store |
|---|---|
| OpenClaw | Bot settings → Secrets → `PROFIT_STEP_TOKEN` |
| Local dev | `export PROFIT_STEP_TOKEN="..."` in `.env` (gitignored) |
| Cloud Run / other | Secret Manager or platform-native secret |

### Token rotation

If the master token is leaked or you want to rotate it:

```bash
# Denis generates a new random token, e.g.:
openssl rand -hex 32

# Denis updates AGENT_API_KEY on Firebase and redeploys agentApi
firebase functions:secrets:set AGENT_API_KEY         # then paste new value
firebase deploy --only functions:agentApi

# Denis distributes new token to all agent platforms
```

All clients using the old token will start getting 401 until updated.

### Role and scope enforcement

With only a master token, every call is treated as **admin** (full access).
Individual route handlers do not currently enforce scopes — once you have the
master token, you can call any endpoint.

If/when per-employee tokens are finished, the scopes table below will apply. For
now it is **aspirational documentation**, not enforced at runtime:

<details>
<summary>Planned RBAC scopes (not yet enforced)</summary>

| Scope | What It Will Allow |
|-------|---------------|
| `tasks:read` | List/view GTD tasks |
| `tasks:write` | Create/update/archive tasks |
| `time:read` | View time tracking sessions |
| `time:write` | Start/stop time tracking |
| `costs:read` | View expenses |
| `costs:write` | Create expenses |
| `clients:read` | Search/view clients |
| `clients:write` | Create/update clients |
| `projects:read` | List/view projects |
| `projects:write` | Create/update projects |
| `estimates:read` | View estimates |
| `estimates:write` | Create/update estimates |
| `inventory:read` | View warehouse/stock |
| `inventory:write` | Stock operations (in/out/transfer) |
| `erp:read` | View change orders, POs |
| `erp:write` | Create change orders, POs |
| `events:read` | Poll event queue |
| `dashboard:read` | View dashboards |
| `admin` | **Full access** (all of the above) |

</details>

---

## 4. Python SDK

### Installation

```bash
# From the repo (recommended)
cd sdk/python
pip install -e .

# Or install just the requirements
pip install httpx
```

### Configuration

```python
import os
os.environ["PROFIT_STEP_TOKEN"] = "<master-token-from-denis>"
# Optional: override URL
# os.environ["PROFIT_STEP_API_URL"] = "https://..."

from profit_step_agent import CRMAgent

agent = CRMAgent()
# or explicitly:
agent = CRMAgent(token="your-token", timeout=30.0, max_retries=3)
```

### Available Domains

```python
agent.tasks      # TasksDomain — create, list, update GTD tasks
agent.time       # TimeDomain — start/stop time tracking
agent.costs      # CostsDomain — create/list/void expenses
agent.events     # EventsDomain — poll events, stream
agent.clients    # ClientsDomain — search, create, update clients
agent.projects   # ProjectsDomain — create, list, dashboard
agent.payroll    # PayrollDomain — my_balance, my_hours, my_pay
agent.webhooks   # WebhooksDomain — register webhook URL
```

### Basic Usage

```python
from profit_step_agent import CRMAgent

with CRMAgent(token="abc123...") as agent:
    # Health check
    print(agent.health())  # {'status': 'ok', 'version': '4.2.0'}

    # === TASKS ===
    # List tasks
    tasks = agent.tasks.list(status="next_action", limit=10)
    for t in tasks:
        print(f"[{t['priority']}] {t['title']}")

    # Create task
    new_task = agent.tasks.create(
        title="Install outlet in kitchen",
        client_id="client_123",
        priority="high",
        status="next_action",
        task_type="install",
        description="3 outlets on the south wall"
    )
    print(f"Created: {new_task['taskId']}")

    # Update task
    agent.tasks.update(new_task['taskId'], status="completed")

    # === TIME TRACKING ===
    agent.time.start(client_id="client_123")
    # ... work ...
    agent.time.stop()

    # === COSTS ===
    agent.costs.create(
        amount=150.0,
        category="materials",
        description="Wire 12 AWG 100ft",
        client_id="client_123"
    )

    # === EVENTS ===
    # Poll recent events
    events = agent.events.poll(since="2026-04-12T00:00:00Z", types=["task", "inventory"])

    # Stream events (blocking generator)
    for event in agent.events.stream(event_type="task"):
        print(f"{event['type']}.{event['action']}: {event['summary']}")

    # === INVENTORY ===
    # Use raw client for V2 endpoints
    catalog = agent.client.request("GET", "/api/inventory/v2/catalog")
    print(f"Catalog items: {len(catalog['items'])}")

    # === PAYROLL ===
    balance = agent.payroll.my_balance()
    print(f"YTD Balance: ${balance['running_balance']}")
```

### Error Handling

```python
from profit_step_agent.exceptions import (
    CRMError,
    ValidationError,
    ScopeError,
    RateLimitError,
    NotFoundError,
)

try:
    agent.tasks.create(title="")  # empty title
except ValidationError as e:
    print(f"Validation: {e.details}")
    # [{'field': 'title', 'message': 'String must contain at least 1 character(s)'}]
except ScopeError as e:
    print(f"Missing scope: {e.required}")
    # ['tasks:write']
except RateLimitError as e:
    print(f"Rate limited. Retry after: {e.retry_after}ms")
except NotFoundError:
    print("Entity not found")
except CRMError as e:
    print(f"API error {e.status_code}: {e.message}")
```

---

## 5. API Reference

### System
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/docs` | No | Swagger UI |
| GET | `/api/docs/spec.json` | No | OpenAPI 3.0 spec |

### Tasks (GTD)
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/gtd-tasks` | `tasks:write` | Create task |
| GET | `/api/gtd-tasks/list` | `tasks:read` | List tasks (filters, pagination) |
| PATCH | `/api/gtd-tasks/:id` | `tasks:write` | Update task |
| DELETE | `/api/gtd-tasks/:id` | `tasks:write` | Archive task (soft-delete) |
| POST | `/api/gtd-tasks/batch-update` | `tasks:write` | Batch update (max 50) |

### Time Tracking
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/time-tracking` | `time:write` | Start/stop/status |
| GET | `/api/time-tracking/active-all` | `time:read` | All active sessions |
| GET | `/api/time-tracking/summary` | `time:read` | Summary report |
| POST | `/api/time-tracking/admin-stop` | `admin` | Force-stop session |

### Clients
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/clients` | `clients:write` | Create client |
| GET | `/api/clients/list` | `clients:read` | List clients |
| GET | `/api/clients/search` | `clients:read` | Search by name |
| GET | `/api/clients/:id` | `clients:read` | Client details |
| PATCH | `/api/clients/:id` | `clients:write` | Update client |

### Projects
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/projects` | `projects:write` | Create project |
| GET | `/api/projects/list` | `projects:read` | List projects |
| GET | `/api/projects/:id/dashboard` | `projects:read` | Project dashboard |
| POST | `/api/projects/:id/files` | `projects:write` | Upload file |
| GET | `/api/projects/:id/files` | `projects:read` | List files |

### Costs
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/costs` | `costs:write` | Create expense |
| GET | `/api/costs/list` | `costs:read` | List expenses |
| POST | `/api/costs/:id/void` | `costs:write` | Void expense |

### Estimates
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/estimates` | `estimates:write` | Create estimate |
| GET | `/api/estimates/list` | `estimates:read` | List estimates |
| PATCH | `/api/estimates/:id` | `estimates:write` | Update estimate |
| POST | `/api/estimates/:id/convert-to-tasks` | `estimates:write` | Convert to GTD tasks |

### Inventory (V1 — deprecated, use V2)
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/inventory/warehouses` | `inventory:write` | Create warehouse |
| GET | `/api/inventory/warehouses` | `inventory:read` | List warehouses |
| GET | `/api/inventory/warehouses/:id` | `inventory:read` | Warehouse + items |
| PATCH | `/api/inventory/warehouses/:id` | `inventory:write` | Update warehouse |
| DELETE | `/api/inventory/warehouses/:id` | `inventory:write` | Archive warehouse |
| POST | `/api/inventory/items` | `inventory:write` | Create item |
| GET | `/api/inventory/items` | `inventory:read` | List items |
| PATCH | `/api/inventory/items/:id` | `inventory:write` | Update item |
| DELETE | `/api/inventory/items/:id` | `inventory:write` | Delete item |
| POST | `/api/inventory/transactions` | `inventory:write` | Record movement |
| POST | `/api/inventory/transactions/task` | `inventory:write` | Bulk task consumption |
| GET | `/api/inventory/transactions` | `inventory:read` | Transaction history |
| POST | `/api/inventory/norms` | `inventory:write` | Create norm |
| GET | `/api/inventory/norms` | `inventory:read` | List norms |
| GET | `/api/inventory/norms/:id` | `inventory:read` | Norm details |
| POST | `/api/inventory/write-off-by-norm` | `inventory:write` | Write off by norm |

### Inventory V2 (recommended)
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| GET | `/api/inventory/v2/catalog` | `inventory:read` | List catalog (scoped) |
| GET | `/api/inventory/v2/catalog/:id` | `inventory:read` | Catalog item + history |
| POST | `/api/inventory/v2/catalog` | `inventory:admin` | Create catalog item |
| PATCH | `/api/inventory/v2/catalog/:id` | `inventory:admin` | Update metadata (not stock) |
| GET | `/api/inventory/v2/locations` | `inventory:read` | List locations (scoped) |
| GET | `/api/inventory/v2/my-locations` | `inventory:read` | My locations |
| POST | `/api/inventory/v2/locations` | `inventory:admin` | Create location |
| PATCH | `/api/inventory/v2/locations/:id` | `inventory:admin` | Update location |
| POST | `/api/inventory/v2/locations/:id/check-in` | `inventory:write` | Check into vehicle |
| POST | `/api/inventory/v2/locations/:id/check-out` | `inventory:write` | Leave vehicle |
| POST | `/api/inventory/v2/transactions` | `inventory:write` | Commit transaction |
| POST | `/api/inventory/v2/transactions/self-checkout` | `inventory:write` | Self-checkout |
| GET | `/api/inventory/v2/transactions` | `inventory:read` | Transaction history |
| POST | `/api/inventory/v2/recalculate/:id` | `admin` | Rebuild stock from journal |
| GET | `/api/inventory/v2/category-policies` | `inventory:read` | List policies |
| PATCH | `/api/inventory/v2/category-policies/:id` | `inventory:admin` | Update policy |
| POST | `/api/inventory/v2/seed-policies` | `admin` | Seed default policies |

### ERP (Change Orders, POs)
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/erp/change-orders` | `erp:write` | Create change order |
| GET | `/api/erp/change-orders` | `erp:read` | List change orders |
| PATCH | `/api/erp/change-orders/:id` | `erp:write` | Update change order |
| POST | `/api/erp/purchase-orders` | `erp:write` | Create purchase order |
| GET | `/api/erp/purchase-orders` | `erp:read` | List purchase orders |
| GET | `/api/erp/plan-vs-fact/:projectId` | `erp:read` | Plan vs fact report |

### Payroll
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| GET | `/api/payroll/my-balance` | `admin` | YTD balance |
| GET | `/api/payroll/my-hours` | `admin` | Weekly hours |
| GET | `/api/payroll/my-pay` | `admin` | Pay stub |
| GET | `/api/payroll/overtime-check` | `admin` | Overtime check |
| POST | `/api/payroll/period/:id/validate` | `admin` | Validate period |

### Events
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| GET | `/api/events` | `events:read` | Poll events |
| GET | `/api/events/types` | `events:read` | Available event types |

### Agent Tokens (admin only)
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/agent-tokens` | `admin` | Create token |
| GET | `/api/agent-tokens` | `admin` | List tokens |
| DELETE | `/api/agent-tokens/:id` | `admin` | Revoke token |
| POST | `/api/agent-tokens/:id/rotate` | `admin` | Rotate token |
| PATCH | `/api/agent-tokens/:id/webhook` | `admin` | Configure webhook |

### Agent Feedback (bug reports, TZ)
| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/agent-feedback` | Any authenticated | File bug/improvement |
| GET | `/api/agent-feedback` | `admin` | List all feedback |
| PATCH | `/api/agent-feedback/:id` | `admin` | Update status |

---

## 6. Events

### Polling (simplest)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://us-central1-profit-step.cloudfunctions.net/agentApi/api/events?since=2026-04-12T00:00:00Z&types=task,inventory&limit=50"
```

Response:
```json
{
  "events": [
    {
      "id": "evt_abc",
      "type": "task",
      "action": "completed",
      "entityId": "task_123",
      "summary": "Task 'Install outlets' completed by Vasya",
      "data": { "taskId": "task_123", "assigneeId": "user_456" },
      "createdAt": "2026-04-12T15:30:00Z"
    }
  ],
  "count": 1
}
```

**Event Types:** `task`, `session`, `cost`, `estimate`, `project`, `inventory`, `payroll`, `alert`

### Webhook (recommended for production)

1. Set your webhook URL:
```bash
curl -X PATCH \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookUrl": "https://your-server.com/webhook",
    "webhookEvents": ["task.*", "inventory.low_stock", "alert.*"]
  }' \
  https://us-central1-profit-step.cloudfunctions.net/agentApi/api/agent-tokens/<tokenId>/webhook
```

2. Receive events on your server:
```python
# Your webhook server
from flask import Flask, request
import hmac, hashlib

app = Flask(__name__)
WEBHOOK_SECRET = "your-webhook-secret-from-token-creation"

@app.route("/webhook", methods=["POST"])
def handle_webhook():
    # Verify signature
    signature = request.headers.get("X-Webhook-Signature", "")
    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET.encode(), request.data, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(signature, expected):
        return "Invalid signature", 401

    event = request.json
    print(f"Event: {event['type']}.{event['action']} — {event['summary']}")

    # Handle the event
    if event['type'] == 'task' and event['action'] == 'completed':
        # Auto write-off materials, update time tracking, etc.
        pass

    return "OK", 200
```

### Webhook Pattern Matching

| Pattern | Matches |
|---------|---------|
| `task.*` | All task events |
| `*.completed` | All completion events |
| `task.assigned` | Specific event |
| `alert.budget_warning` | Specific alert |
| `*.*` | All events |

**Delivery:** 3 retries with exponential backoff (1s, 2s, 4s). HMAC-SHA256 signed.

---

## 7. Telegram Integration

Agents automatically forward events to employees via Telegram if the employee has `telegramId` in their user profile.

### Bot: @ProfitStepWorkerBot

- Workers interact with the bot for time tracking, task management, costs
- The bot uses `WORKER_BOT_TOKEN` (configured on the server)
- Events published by the API are automatically forwarded to the employee's Telegram

### FCM Push Notifications

If the employee has registered FCM tokens (via the web app), events also push to their browser/mobile as notifications.

---

## 8. Error Handling

### Error Response Format

```json
{
  "error": "Human-readable message",
  "code": "VALIDATION_ERROR",
  "requestId": "req_abc123",
  "details": [
    { "field": "title", "message": "String must contain at least 1 character(s)" }
  ]
}
```

### HTTP Status Codes

| Code | Meaning | Agent Should |
|------|---------|-------------|
| 200 | Success | Process response |
| 201 | Created | Process response |
| 400 | Validation error | Fix request body and retry |
| 401 | Invalid/expired token | Get new token from admin |
| 403 | Insufficient scope | Request scope upgrade |
| 404 | Entity not found | Verify ID exists |
| 409 | Conflict/duplicate | Check idempotency or state |
| 429 | Rate limited | Wait `retryAfterMs` then retry |
| 500 | Server error | Retry with backoff |
| 503 | Temporarily unavailable | Retry in 30s |

### Self-Correction Pattern

```python
def safe_create_task(agent, title, **kwargs):
    """Create task with automatic self-correction."""
    try:
        return agent.tasks.create(title=title, **kwargs)
    except ValidationError as e:
        # Fix common issues
        for detail in e.details:
            if detail['field'] == 'clientId':
                # Client ID invalid — try search
                clients = agent.clients.search(query=kwargs.get('client_name', ''))
                if clients:
                    kwargs['client_id'] = clients[0]['id']
                    return agent.tasks.create(title=title, **kwargs)
        raise
    except NotFoundError:
        # Maybe the project doesn't exist yet
        print("Entity not found. Filing feedback...")
        agent.client.request("POST", "/api/agent-feedback", json={
            "type": "bug",
            "title": f"Entity not found when creating task: {title}",
            "endpoint": "POST /api/gtd-tasks",
            "severity": "medium",
        })
        raise
```

---

## 9. Rate Limits

| Parameter | Value |
|-----------|-------|
| Window | 60 seconds |
| Limit | 60 requests per window |
| Per | User (agentUserId) |
| Response | HTTP 429 + `retryAfterMs` |

```python
# Auto-handled by Python SDK (3 retries with backoff)
# For raw HTTP:
import time

resp = requests.get(url, headers=headers)
if resp.status_code == 429:
    wait_ms = resp.json().get("retryAfterMs", 60000)
    time.sleep(wait_ms / 1000)
    resp = requests.get(url, headers=headers)  # retry
```

---

## 10. Filing Bugs & Improvements (TZ)

When something doesn't work, the agent can file a bug or improvement request directly into the CRM.

### POST /api/agent-feedback

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "bug",
    "title": "Inventory V2: timeout on large catalog queries",
    "description": "GET /api/inventory/v2/catalog with >500 items returns 504 after 30s",
    "severity": "high",
    "endpoint": "GET /api/inventory/v2/catalog",
    "errorMessage": "ETIMEDOUT after 30000ms",
    "stepsToReproduce": [
      "Create 500+ catalog items",
      "GET /api/inventory/v2/catalog without filters",
      "Observe timeout"
    ],
    "expectedBehavior": "Paginated response within 5s",
    "actualBehavior": "504 Gateway Timeout"
  }' \
  https://us-central1-profit-step.cloudfunctions.net/agentApi/api/agent-feedback
```

### Feedback Types

| Type | When to Use |
|------|-------------|
| `bug` | Something broken, error, crash |
| `improvement` | Existing feature works but could be better |
| `feature_request` | New capability needed |
| `performance` | Slow response, timeout, high latency |

### Severity Levels

| Severity | Meaning | SLA |
|----------|---------|-----|
| `critical` | Blocks all work, data loss risk | Auto-creates GTD task, Denis notified |
| `high` | Major feature broken | Review within 24h |
| `medium` | Non-critical issue | Backlog |
| `low` | Nice-to-have, cosmetic | Someday |

### Python SDK Usage

```python
# When something fails, file a report
try:
    result = agent.client.request("POST", "/api/inventory/v2/transactions", json={...})
except Exception as e:
    agent.client.request("POST", "/api/agent-feedback", json={
        "type": "bug",
        "title": f"Transaction commit failed: {str(e)[:100]}",
        "severity": "high",
        "endpoint": "POST /api/inventory/v2/transactions",
        "errorMessage": str(e),
        "stepsToReproduce": ["Attempted stock write-off", f"Item: {item_id}", f"Qty: {qty}"],
    })
```

### View Feedback (admin)

```bash
# List all feedback
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://us-central1-profit-step.cloudfunctions.net/agentApi/api/agent-feedback?status=open&limit=20"

# Update status
curl -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_review", "assignedTo": "dev-uid"}' \
  https://us-central1-profit-step.cloudfunctions.net/agentApi/api/agent-feedback/<feedbackId>
```

---

## 11. Security Rules

### DO

- Store token in environment variable, never in code
- Use idempotency keys for POST requests (prevents duplicates on retry)
- Handle 429 rate limits with backoff
- File feedback when encountering errors
- Use the minimum scopes needed

### DON'T

- Never log or print the token value
- Never share tokens between different agents/employees
- Never store tokens in git, config files, or databases
- Never make more than 60 requests per minute
- Never modify data you don't own (respect scopes)

### Token Lifecycle

```
Create (admin) → Active → [Optional: Rotate] → Revoke → Dead
                   ↓
              Expires (auto)
```

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Token invalid, expired, or revoked | Get new token from admin |
| `403 Forbidden` | Missing required scope | Ask admin to add scope to token |
| `429 Too Many Requests` | Rate limit (60/min) | Wait `retryAfterMs` and retry |
| `400 Validation failed` | Bad request body | Read `details[]` array for field errors |
| `404 Not found` | Entity doesn't exist | Verify ID, search first |
| `409 Conflict` | Duplicate or state conflict | Check idempotency key, entity state |
| `500 Internal Server Error` | Server bug | Retry once; file feedback if persists |
| `ECONNREFUSED` | Server down or wrong URL | Check API health endpoint |
| `Timeout` | Large query or server load | Add filters, reduce limit |

### Health Check Script

```python
#!/usr/bin/env python3
"""Quick diagnostic for agent connectivity."""
import os, sys, httpx

TOKEN = os.environ.get("PROFIT_STEP_TOKEN", "")
BASE = "https://us-central1-profit-step.cloudfunctions.net/agentApi"

print("1. Health check (no auth)...")
r = httpx.get(f"{BASE}/api/health")
print(f"   Status: {r.status_code} — {r.json().get('status')}")

if not TOKEN:
    print("   PROFIT_STEP_TOKEN not set. Skipping auth checks.")
    sys.exit(0)

print("2. Auth check...")
r = httpx.get(f"{BASE}/api/events/types", headers={"Authorization": f"Bearer {TOKEN}"})
if r.status_code == 200:
    print(f"   OK — {len(r.json().get('types', {}))} event types")
elif r.status_code == 401:
    print("   FAIL — Token invalid or expired")
elif r.status_code == 403:
    print("   FAIL — Token valid but missing events:read scope")
else:
    print(f"   Unexpected: {r.status_code}")

print("3. Task list check...")
r = httpx.get(f"{BASE}/api/gtd-tasks/list?limit=1",
              headers={"Authorization": f"Bearer {TOKEN}"})
if r.status_code == 200:
    print(f"   OK — {r.json().get('total', '?')} tasks total")
elif r.status_code == 403:
    print("   SKIP — No tasks:read scope")
else:
    print(f"   Status: {r.status_code}")

print("\nDone.")
```

---

## 13. Full Working Examples

### Example 1: Daily Report Agent

```python
"""Agent that runs daily, summarizes work, files issues."""
from profit_step_agent import CRMAgent
from datetime import datetime, timedelta

with CRMAgent() as agent:
    yesterday = (datetime.utcnow() - timedelta(days=1)).isoformat() + "Z"

    # Get yesterday's completed tasks
    tasks = agent.tasks.list(status="completed", limit=100)
    completed = [t for t in tasks if t.get('completedAt', '') > yesterday]

    # Get active time sessions
    sessions = agent.client.request("GET", "/api/time-tracking/summary",
                                     params={"period": "today"})

    # Get recent events
    events = agent.events.poll(since=yesterday, types=["alert"])
    for event in events:
        if event['action'] == 'budget_warning':
            print(f"ALERT: {event['summary']}")

    print(f"Completed: {len(completed)} tasks")
    print(f"Active sessions: {sessions.get('activeSessions', 0)}")
```

### Example 2: Inventory Monitor Agent

```python
"""Agent that monitors stock levels and files TZ for improvements."""
from profit_step_agent import CRMAgent

with CRMAgent() as agent:
    try:
        catalog = agent.client.request("GET", "/api/inventory/v2/catalog",
                                        params={"limit": 200})
        low_stock = [
            item for item in catalog.get('items', [])
            if item.get('totalStock', 0) < item.get('minStock', 0)
            and item.get('minStock', 0) > 0
        ]

        if low_stock:
            names = ', '.join(i['name'] for i in low_stock[:5])
            print(f"Low stock items: {names}")

    except Exception as e:
        # Something failed — file a bug
        agent.client.request("POST", "/api/agent-feedback", json={
            "type": "bug",
            "title": "Inventory catalog query failed",
            "severity": "high",
            "endpoint": "GET /api/inventory/v2/catalog",
            "errorMessage": str(e),
        })
```

### Example 3: Auto-Feedback on Any Error

```python
"""Wrapper that auto-files feedback on unhandled errors."""
from profit_step_agent import CRMAgent
from profit_step_agent.exceptions import CRMError
import traceback

class SmartAgent:
    def __init__(self):
        self.agent = CRMAgent()

    def safe_call(self, method, path, **kwargs):
        """Call API with automatic feedback on failure."""
        try:
            return self.agent.client.request(method, path, **kwargs)
        except CRMError as e:
            if e.status_code >= 500:
                self.agent.client.request("POST", "/api/agent-feedback", json={
                    "type": "bug",
                    "title": f"Server error on {method} {path}",
                    "severity": "high",
                    "endpoint": f"{method} {path}",
                    "errorMessage": str(e),
                    "stepsToReproduce": [
                        f"Request: {method} {path}",
                        f"Params: {kwargs}",
                    ],
                })
            raise
```

---

## Environment Variables Summary (for `.env` on your machine)

```bash
# Required — master token, value of AGENT_API_KEY on the Firebase Functions side
PROFIT_STEP_TOKEN=<master-token-from-denis>

# Optional — override base URL
PROFIT_STEP_API_URL=https://profit-step.web.app/api
```

That's it. One token, one URL. Everything else is handled by the API.

---

*Last updated: 2026-04-16 — auth sections rewritten to match actual middleware (removed fictional per-employee token mode)*
*CRM version: 4.5.0*
*Guide version: 2.0*
