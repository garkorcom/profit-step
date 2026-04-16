# OpenClaw Agent Integration Guide — Profit Step CRM API

> **Version:** 5.1.0 | **Updated:** 2026-04-16 | **API Version:** 4.5.0
> **Live Swagger UI:** https://profit-step.web.app/api/docs
> **Spec JSON:** https://profit-step.web.app/api/docs/spec.json
> **Auth canonical reference:** [`docs/AI_ASSISTANT_BOT_PROMPT.md`](./docs/AI_ASSISTANT_BOT_PROMPT.md)
>
> Auth section (§2) verified against prod `agentMiddleware.ts` on 2026-04-16 — only
> two modes exist: static master token (`AGENT_API_KEY`) and Firebase Auth JWT.
> Any mention of per-employee 40-hex tokens elsewhere in the repo is outdated.

---

## 1. Architecture Overview

```
┌──────────────────────┐         ┌──────────────────────────────────┐
│  OpenClaw Agent      │  HTTP   │  Firebase Cloud Functions         │
│  (LangGraph/Pydantic)│ ──────> │  agentApi (Express)              │
│                      │         │                                  │
│  ~/.openclaw/agents/ │         │  functions/src/agent/            │
│    profit_step/      │         │    agentApi.ts      (entry)     │
│    skills/           │         │    agentMiddleware.ts (auth)    │
│      *.py            │         │    routes/          (14 modules)│
│                      │         │    schemas/         (10 files)  │
└──────────────────────┘         └──────────────────────────────────┘
```

**Key principles:**
- **Zod + Pydantic mirror** — Backend validates with Zod, agent types with Pydantic. Both schemas must match.
- **Self-correction** — On `400` errors, Zod returns field-level details so the agent can auto-fix and retry.
- **Resolution-first** — Always search for entity IDs (client, project) before creating child records.

### File Structure (Backend)

```
functions/src/agent/
├── agentApi.ts              # Express app, route registration
├── agentMiddleware.ts       # Auth (API key + JWT), rate limiting
├── routes/
│   ├── index.ts             # Barrel export
│   ├── activity.ts          # Activity feed
│   ├── clients.ts           # Client CRUD + search + duplicate check
│   ├── costs.ts             # Cost tracking
│   ├── dashboard.ts         # Dashboard context
│   ├── docs.ts              # Swagger UI (public)
│   ├── erp.ts               # Change orders, purchase orders, plan-vs-fact
│   ├── estimates.ts         # Estimates + convert-to-tasks
│   ├── finance.ts           # Finance context, transactions, approvals
│   ├── inventory.ts         # Warehouses, items, norms, write-off
│   ├── portal.ts            # Client portal (public, token-auth)
│   ├── projects.ts          # Projects, files, blueprints, blackboard
│   ├── sharing.ts           # Share tokens
│   ├── sites.ts             # Site management
│   ├── tasks.ts             # GTD tasks (CRUD + batch)
│   ├── timeTracking.ts      # Time tracking + admin controls
│   └── users.ts             # Users + contacts
└── schemas/
    ├── index.ts
    ├── clientSchemas.ts
    ├── costSchemas.ts
    ├── erpSchemas.ts
    ├── estimateProjectSchemas.ts
    ├── financeSchemas.ts
    ├── inventorySchemas.ts
    ├── taskSchemas.ts
    ├── timeTrackingSchemas.ts
    └── userSchemas.ts
```

---

## 2. Authentication

Two modes, same header format:

```
Authorization: Bearer <token>
```

### Mode 1: Static API Key (OpenClaw / server-to-server)

```python
headers = {"Authorization": f"Bearer {AGENT_API_KEY}"}
```

- Token matches `process.env.AGENT_API_KEY` on the backend
- Automatically impersonates the configured owner (`OWNER_UID` / `OWNER_DISPLAY_NAME`)
- Use for all agent-initiated calls

### Mode 2: Firebase Auth JWT (browser / frontend)

```python
headers = {"Authorization": f"Bearer {firebase_id_token}"}
```

- Token is a valid Firebase Auth ID token
- User identity extracted from JWT (`uid`, `name`, `email`)
- Use when the agent acts on behalf of a specific logged-in user

### Rate Limiting

- **60 requests / 60 seconds** per authenticated user
- Returns `429 Too Many Requests` when exceeded

### Error Format

All errors follow a standard structure:

```json
{
  "error": "Human-readable message",
  "code": "VALIDATION_ERROR | CLIENT_ERROR | DATABASE_ERROR | INTERNAL_ERROR",
  "requestId": "uuid-v4",
  "details": [
    { "field": "clientId", "message": "String must contain at least 1 character(s)" }
  ]
}
```

---

## 3. Base URL

| Environment | URL |
|---|---|
| **Production** | `https://us-central1-profit-step.cloudfunctions.net/agentApi` |
| **Via Hosting** | `https://profit-step.web.app/api/...` (rewrite) |
| **Emulator** | `http://localhost:5001/profit-step/us-central1/agentApi` |

All endpoints below are relative: `/api/...`

---

## 4. Complete Endpoint Reference

### 4.1. System

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check — returns API status and version |
| GET | `/api/docs` | No | Swagger UI (interactive documentation) |
| GET | `/api/docs/spec.json` | No | Raw OpenAPI 3.0 spec |

### 4.2. Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Full dashboard context (active sessions, recent tasks, budget overview) |

### 4.3. Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/clients` | Create client (with duplicate check + phone normalization) |
| PATCH | `/api/clients/:id` | Update client fields (phone auto-normalized) |
| GET | `/api/clients/list` | List all clients (paginated) |
| GET | `/api/clients/search` | Fuzzy search (Fuse.js) by name, phone, email, address |
| GET | `/api/clients/check-duplicates` | Check for duplicates before creating |
| GET | `/api/clients/:id` | Get single client by ID |

**New in v4.3 — Duplicate Detection:**

```
POST /api/clients
{
  "name": "John Smith",
  "phone": "305-965-0408",
  "force": false          // set true to skip duplicate check
}

// Response if duplicate found (200, not 201):
{
  "warning": "POSSIBLE_DUPLICATE",
  "matches": [
    { "id": "abc123", "name": "John Smith LLC", "score": 0.15 }
  ],
  "message": "Similar client found. Set force=true to create anyway."
}
```

**New in v4.3 — Phone Normalization:**
All phone fields (`phone`, `contacts[].phone`) are auto-normalized to E.164 format on create/update:
- `305-965-0408` → `+13059650408`
- `+1 (305) 965-0408` → `+13059650408`

**New in v4.3 — Field Warnings:**
POST response includes `warnings[]` for missing recommended fields:
```json
{
  "id": "new-client-id",
  "warnings": ["Missing phone or email", "Missing address"]
}
```

**New in v4.3 — Check Duplicates Endpoint:**
```
GET /api/clients/check-duplicates?name=John%20Smith&phone=3059650408
```
Returns exact phone matches + fuzzy name/address matches without creating anything.

### 4.4. Tasks (GTD)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/gtd-tasks` | Create a GTD task |
| GET | `/api/gtd-tasks/list` | List tasks with filters |
| PATCH | `/api/gtd-tasks/:id` | Update task fields |
| DELETE | `/api/gtd-tasks/:id` | Delete a task |
| POST | `/api/gtd-tasks/batch-update` | Batch update multiple tasks |

**Key filters for list:**

| Param | Type | Description |
|-------|------|-------------|
| `status` | string | `inbox`, `next_action`, `waiting`, `projects`, `someday`, `done` |
| `priority` | string | `low`, `medium`, `high`, `urgent` |
| `clientId` | string (min 1 char) | Filter by single client |
| `clientIds` | string | Comma-separated client IDs (max 10), e.g. `id1,id2,id3` |
| `assigneeId` | string | Filter by assignee |
| `projectId` | string | Filter by project |
| `limit` | number | Default 20 |

### 4.5. Costs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/costs` | Create a cost entry |
| GET | `/api/costs/list` | List costs with filters |
| DELETE | `/api/costs/:id` | Delete a cost entry |

**Filters:** `clientId`, `projectId`, `from`, `to` (date strings)

### 4.6. Time Tracking

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/time-tracking` | Start/stop/status timer |
| GET | `/api/time-tracking/active-all` | List all active sessions |
| GET | `/api/time-tracking/summary` | Time summary for date range |
| POST | `/api/time-tracking/admin-stop` | Admin force-stop a timer |
| POST | `/api/time-tracking/admin-start` | Admin start timer for user |
| POST | `/api/time-tracking/auto-stop-stale` | Auto-stop stale sessions |

**Start timer example:**
```json
POST /api/time-tracking
{
  "action": "start",
  "taskTitle": "Install kitchen cabinets",
  "clientId": "abc123",
  "startTime": "2026-04-13T08:00:00Z"
}
```

### 4.7. Finance

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/finance/context` | Finance dashboard overview |
| GET | `/api/projects/status` | Project financial status (budget vs actual) |
| POST | `/api/finance/transactions/batch` | Batch create transactions |
| POST | `/api/finance/transactions/approve` | Approve pending transactions |
| POST | `/api/finance/transactions/undo` | Undo transaction approval |

### 4.8. Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/projects` | Create a project |
| GET | `/api/projects/list` | List active projects |
| GET | `/api/projects/:id/dashboard` | Full project dashboard |
| POST | `/api/projects/:id/files` | Upload project files |
| GET | `/api/projects/:id/files` | List project files |
| POST | `/api/blueprint/split` | AI blueprint splitting |
| POST | `/api/blackboard` | Create blackboard entry |
| GET | `/api/blackboard/:projectId` | Get project blackboard |

### 4.9. Estimates

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/estimates` | Create estimate |
| GET | `/api/estimates/list` | List estimates |
| PATCH | `/api/estimates/:id` | Update estimate |
| POST | `/api/estimates/:id/convert-to-tasks` | Convert estimate line items to GTD tasks |

### 4.10. ERP

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/change-orders` | Create change order |
| GET | `/api/change-orders` | List change orders |
| PATCH | `/api/change-orders/:id` | Update change order |
| POST | `/api/purchase-orders` | Create purchase order |
| GET | `/api/purchase-orders` | List purchase orders |
| GET | `/api/plan-vs-fact` | Plan vs fact comparison |

### 4.11. Inventory & Warehouse

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/inventory/warehouses` | Create warehouse |
| GET | `/api/inventory/warehouses` | List warehouses |
| GET | `/api/inventory/warehouses/:id` | Get warehouse details |
| PATCH | `/api/inventory/warehouses/:id` | Update warehouse |
| DELETE | `/api/inventory/warehouses/:id` | Delete warehouse |
| POST | `/api/inventory/items` | Create inventory item |
| GET | `/api/inventory/items` | List inventory items |
| PATCH | `/api/inventory/items/:id` | Update inventory item |
| DELETE | `/api/inventory/items/:id` | Delete inventory item |
| POST | `/api/inventory/transactions` | Create inventory transaction |
| POST | `/api/inventory/transactions/task` | Transaction from task |
| GET | `/api/inventory/transactions` | List transactions |
| POST | `/api/inventory/norms` | Create inventory norm |
| GET | `/api/inventory/norms` | List norms |
| GET | `/api/inventory/norms/:id` | Get norm details |
| POST | `/api/inventory/write-off-by-norm` | Write-off by norm |

### 4.12. Users & Contacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/list` | List team members (with role filter, pagination) |
| GET | `/api/users/search` | Search users |
| POST | `/api/users/create-from-bot` | Create user from Telegram bot |
| POST | `/api/contacts` | Create external contact |
| GET | `/api/contacts/search` | Search contacts |

### 4.13. Activity Log

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/activity/list` | List activity records |

**Filters:** `action`, `userId`, `from`, `to`, `limit`, `offset`

### 4.14. Sharing & Portal

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/clients/:id/share-tokens` | Bearer | Create share token |
| GET | `/api/clients/:id/share-tokens` | Bearer | List share tokens |
| DELETE | `/api/clients/:id/share-tokens/:tokenId` | Bearer | Delete share token |
| GET | `/api/portal/:slug` | Token | Client portal page (public) |
| POST | `/api/portal/:slug/approve` | Token | Client approval via portal |
| POST | `/api/portal/:slug/comment` | Token | Client comment via portal |

### 4.15. Sites

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sites` | Create site |
| GET | `/api/sites` | List sites |
| PATCH | `/api/sites/:id` | Update site |

---

## 5. Common Workflows for Agent

### 5.1. Resolution Pattern (always first!)

Before creating any task, cost, or time entry, the agent **must** resolve entity IDs:

```python
# Step 1: Find client
response = get("/api/clients/search", params={"q": "Farmer's Milk"})
client_id = response["results"][0]["id"]

# Step 2: Find or create project  
response = get("/api/projects/list", params={"clientId": client_id})
project_id = response["projects"][0]["id"]

# Step 3: Now create the task
post("/api/gtd-tasks", json={
    "title": "Send invoice for $500",
    "clientId": client_id,
    "projectId": project_id,
    "priority": "high"
})
```

### 5.2. Create Client with Duplicate Check

```python
# Step 1: Check for duplicates first
dupes = get("/api/clients/check-duplicates", params={
    "name": "John Smith",
    "phone": "305-965-0408"
})

if dupes["matches"]:
    # Ask user: "Found similar client: John Smith LLC. Use existing?"
    return dupes["matches"]

# Step 2: Create (with force=true if user confirmed no duplicate)
result = post("/api/clients", json={
    "name": "John Smith",
    "phone": "305-965-0408",   # auto-normalized to +13059650408
    "address": "123 Main St, Miami FL",
    "type": "residential",
    "force": True
})

# Check warnings
if result.get("warnings"):
    # e.g. ["Missing email"] — inform user
    pass
```

### 5.3. Time Tracking Flow

```python
# Start timer
post("/api/time-tracking", json={
    "action": "start",
    "taskTitle": "Cabinet installation",
    "clientId": "abc123"
})

# Check active timers
active = get("/api/time-tracking/active-all")

# Stop timer
post("/api/time-tracking", json={
    "action": "stop",
    "taskId": active["sessions"][0]["taskId"]
})

# Get summary for payroll
summary = get("/api/time-tracking/summary", params={
    "from": "2026-04-01",
    "to": "2026-04-13"
})
```

### 5.4. Full Dashboard Context

```python
# Single call for full overview
dashboard = get("/api/dashboard")
# Returns: active timers, recent tasks, budget status, etc.
```

---

## 6. Pydantic Tool Examples

### 6.1. Search Client Tool

```python
from pydantic import BaseModel, Field
from typing import Optional

class SearchClientInput(BaseModel):
    """Search for a client by name, phone, or email."""
    query: str = Field(..., min_length=1, description="Search query (name, phone, or email)")
    limit: int = Field(default=5, ge=1, le=20, description="Max results")

class SearchClientResult(BaseModel):
    id: str
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    score: float  # Fuse.js similarity score (lower = better match)
```

### 6.2. Create Task Tool

```python
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime

class CreateTaskInput(BaseModel):
    """Create a GTD task in the CRM."""
    title: str = Field(..., min_length=1, max_length=500)
    status: Literal["inbox", "next_action", "waiting", "projects", "someday"] = "inbox"
    priority: Literal["low", "medium", "high", "urgent"] = "medium"
    client_id: Optional[str] = Field(None, min_length=1, alias="clientId")
    project_id: Optional[str] = Field(None, min_length=1, alias="projectId")
    assignee_id: Optional[str] = Field(None, min_length=1, alias="assigneeId")
    due_date: Optional[datetime] = Field(None, alias="dueDate")
    notes: Optional[str] = None
```

### 6.3. Create Cost Tool

```python
class CreateCostInput(BaseModel):
    """Record a project cost/expense."""
    amount: float = Field(..., gt=0)
    category: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    client_id: Optional[str] = Field(None, min_length=1, alias="clientId")
    project_id: Optional[str] = Field(None, min_length=1, alias="projectId")
```

### 6.4. Time Tracking Tool

```python
class TimeTrackingInput(BaseModel):
    """Start, stop, or check timer status."""
    action: Literal["start", "stop", "status"]
    task_title: Optional[str] = Field(None, alias="taskTitle")
    task_id: Optional[str] = Field(None, alias="taskId")
    client_id: Optional[str] = Field(None, min_length=1, alias="clientId")
    start_time: Optional[datetime] = Field(None, alias="startTime")
    end_time: Optional[datetime] = Field(None, alias="endTime")
```

### 6.5. Create Client Tool

```python
class CreateClientInput(BaseModel):
    """Create a new CRM client with duplicate check."""
    name: str = Field(..., min_length=1)
    phone: Optional[str] = Field(None, description="Auto-normalized to E.164")
    email: Optional[str] = None
    address: Optional[str] = None
    type: Literal["person", "company"] = "person"
    status: Literal["new", "contacted", "qualified", "customer", "churned", "done"] = "new"
    force: bool = Field(default=False, description="Skip duplicate check")
    contacts: Optional[list] = Field(default=None, description="Array of contact persons")
```

### 6.6. Check Duplicates Tool

```python
class CheckDuplicatesInput(BaseModel):
    """Check for existing clients before creating a new one."""
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
```

---

## 7. Error Handling & Self-Correction

When the agent receives a `400` error, parse the `details` array:

```python
import httpx

def call_api(method: str, path: str, **kwargs) -> dict:
    response = httpx.request(method, f"{BASE_URL}{path}", headers=AUTH_HEADERS, **kwargs)
    
    if response.status_code == 400:
        error = response.json()
        # Extract field-level errors for self-correction
        details = error.get("details", [])
        for d in details:
            print(f"Field '{d['field']}': {d['message']}")
        # Return error to LLM for auto-correction
        return {"error": True, "details": details, "message": error.get("error")}
    
    if response.status_code == 429:
        # Rate limited — wait and retry
        time.sleep(2)
        return call_api(method, path, **kwargs)
    
    response.raise_for_status()
    return response.json()
```

**Common validation errors:**
- `clientId: String must contain at least 1 character(s)` — Don't pass empty string, use `null` or omit
- `POSSIBLE_DUPLICATE` (on POST /api/clients) — Client might already exist, check matches or set `force: true`
- `title: Required` — Title field is mandatory for tasks

---

## 8. Phone Number Handling

All phone numbers in the API are **auto-normalized to E.164** on write operations.

| Input | Stored as | Display |
|-------|-----------|---------|
| `305-965-0408` | `+13059650408` | `+1 (305) 965-0408` |
| `7542520827` | `+17542520827` | `+1 (754) 252-0827` |
| `+1 (305) 965-0408` | `+13059650408` | `+1 (305) 965-0408` |
| `+44 20 7946 0958` | `+442079460958` | `+44 207 946 0958` |

**Search by phone** works regardless of format — the query is normalized before fuzzy matching:
```
GET /api/clients/search?q=305-965-0408
# Finds client with phone +13059650408
```

---

## 9. Local Development & Testing

### Start emulators:
```bash
cd /path/to/profit-step
npm run emulator
# Functions at http://localhost:5001
# Firestore at http://localhost:8080
```

### Test an endpoint:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:5001/profit-step/us-central1/agentApi/api/health
```

### Run agent tool tests:
```bash
# From agent directory
cd ~/.openclaw/agents/profit_step
python -m pytest tests/ -v
```

---

## 10. Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  PROFIT STEP AGENT API — QUICK REFERENCE                   │
├─────────────────────────────────────────────────────────────┤
│  AUTH:  Authorization: Bearer <AGENT_API_KEY>               │
│  BASE:  https://profit-step.web.app/api/                    │
│  DOCS:  https://profit-step.web.app/api/docs                │
│  RATE:  60 req/min per user                                 │
├─────────────────────────────────────────────────────────────┤
│  CLIENTS    POST /api/clients           Create              │
│             GET  /api/clients/search     Fuzzy search        │
│             GET  /api/clients/check-duplicates  Dup check   │
│             PATCH /api/clients/:id       Update              │
│  TASKS      POST /api/gtd-tasks          Create             │
│             GET  /api/gtd-tasks/list     List + filter       │
│             PATCH /api/gtd-tasks/:id     Update              │
│  COSTS      POST /api/costs              Create             │
│             GET  /api/costs/list         List + filter       │
│  TIME       POST /api/time-tracking      Start/stop         │
│             GET  /api/time-tracking/active-all  Active       │
│             GET  /api/time-tracking/summary     Report       │
│  FINANCE    GET  /api/finance/context    Overview            │
│             GET  /api/projects/status    Budget vs actual    │
│  PROJECTS   POST /api/projects           Create             │
│             GET  /api/projects/list      List                │
│  INVENTORY  Full CRUD at /api/inventory/*                    │
│  ERP        /api/change-orders, /api/purchase-orders         │
│  USERS      GET  /api/users/list         Team members       │
│  ACTIVITY   GET  /api/activity/list      Audit log          │
│  PORTAL     GET  /api/portal/:slug       Client view        │
├─────────────────────────────────────────────────────────────┤
│  70+ endpoints total — see Swagger UI for full details      │
└─────────────────────────────────────────────────────────────┘
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 5.0.0 | 2026-04-13 | Complete rewrite: 70+ endpoints, phone normalization, duplicate detection, activity log, inventory, ERP, portal, sharing |
| 1.0.0 | 2025-11-XX | Initial 4-endpoint guide (tasks, expenses, time tracking, search) |
