# profit-step-agent

Python SDK для [Profit Step CRM Agent API](https://profit-step.web.app/api/docs/spec.json).

Build external AI agents (Telegram bots, Slack notifiers, bookkeeping scripts) that talk to the CRM with typed pydantic models, proper auth modes, and retry/rate-limit handling.

## Install

```bash
pip install profit-step-agent
```

Requires Python ≥ 3.10.

## Quickstart

```python
from profit_step_agent import CRMAgent

agent = CRMAgent(token="<your-api-token>")

# List tasks assigned as "next_action"
tasks = agent.tasks.list(status="next_action")
for t in tasks:
    print(t.title)

# Start/stop a timer
agent.time.start(client_id="abc123")
agent.time.stop()

# File a cost entry
agent.costs.create(amount=150.0, category="materials",
                   description="Wire 12 AWG", client_id="abc123")

# Subscribe to events
for event in agent.events.stream(event_type="task"):
    print(event.summary)
```

The token can also be passed via env var:

```bash
export PROFIT_STEP_TOKEN=...
python your_script.py
```

## Auth modes

Three modes, all via a single `token` parameter. The SDK auto-detects which.

### 1. Master key (server-to-server)

Static API key issued by admin. Has full `admin` scope — sees everything.
Good for internal daily-report bots, reconciliation scripts, batch jobs.

```python
agent = CRMAgent(token="ak_...")
```

### 2. Per-employee impersonation token

Master key + `X-Impersonate-User` header so the call acts as a specific
user. Enforces RLS on that user's role (worker/foreman/manager/etc).

```python
agent = CRMAgent(token="ak_...")
with agent.impersonate("employee-uid-123"):
    # Now all calls are scoped to that employee's data via RLS
    own_tasks = agent.tasks.list()
```

### 3. Firebase JWT (browser-side agents)

Pass a Firebase ID token instead of a static key — useful when you're
embedding agent logic in a web client that already has a signed-in user.

```python
agent = CRMAgent(token=firebase_id_token)
```

## Rate limits

- 60 requests/min per token (soft limit, 429 if exceeded)
- Long-running webhooks and `/events/stream` don't count
- The SDK auto-retries on 429 with exponential backoff + jitter
- Respects `Retry-After` response header

If you need higher limits, talk to the admin — there's a per-partner
allow-list.

## Errors

All errors subclass `CRMError`:

```python
from profit_step_agent import CRMError, ValidationError, ScopeError, RateLimitError, NotFoundError

try:
    agent.tasks.create(title="")
except ValidationError as e:
    print(e.field_errors)   # {"title": "must not be empty"}
except ScopeError as e:
    print("Token lacks scope:", e.required_scope)
except NotFoundError as e:
    print("Not found:", e.resource)
except RateLimitError as e:
    print("Rate limited, retry after:", e.retry_after)
```

## Escape hatch for uncovered endpoints

SDK v0.1 covers 8 domains (tasks, time, costs, events, clients, projects,
payroll, webhooks). For the other 12 domains in the Agent API (inventory,
finance, files, etc.), use the raw client:

```python
agent = CRMAgent(token="...")
warehouses = agent.client.get("/api/inventory/warehouses")
```

Phase 2 will expand coverage. See [PYTHON_SDK_SPEC.md](../../docs/tasks/PYTHON_SDK_SPEC.md)
for the roadmap.

## Examples

Three runnable examples in [`examples/`](examples/):

1. **`01_smoke_check.py`** — auth works + token valid
2. **`02_daily_report.py`** — yesterday's hours/earnings/top projects
3. **`03_webhook_subscriber.py`** — Flask endpoint validating HMAC signatures

Run any with your token:

```bash
cd examples
PROFIT_STEP_TOKEN=... python 01_smoke_check.py
```

## Versioning

Semver. `0.x` = beta, API may break. `1.0.0` marks stability.

Breaking changes in minor versions issue `DeprecationWarning` one minor in
advance. Check [CHANGELOG.md](CHANGELOG.md).

## Getting a token

Contact the profit-step admin:
- **Master key** (server-to-server, full access) — for internal tools
- **Per-employee token** — for agents acting as a specific worker
- **Firebase JWT** — provision via Firebase Auth in your app

Token format: `ak_` prefix + 40 hex chars (master), or standard Firebase ID token (JWT).

**Never commit tokens.** Add `.env` to `.gitignore` and use
`PROFIT_STEP_TOKEN` env var.

## Development

```bash
git clone https://github.com/garkorcom/profit-step
cd profit-step/sdk/python
pip install -e '.[dev]'
pytest
ruff check .
```

## License

MIT. See [LICENSE](LICENSE).

## Links

- API spec: https://profit-step.web.app/api/docs/spec.json
- CRM app: https://profit-step.web.app
- Report issues: https://github.com/garkorcom/profit-step/issues
