# CRM Profit Step — Agent API Reference

**Version:** 4.5.0  
**Date:** 16 April 2026  
**Base URL:** `https://profit-step.web.app/api/`  
**Direct Function URL:** `https://us-central1-profit-step.cloudfunctions.net/agentApi/api/`  
**Live OpenAPI spec:** `https://profit-step.web.app/api/docs/spec.json` (always canonical)  
**Agent system prompt:** [`AI_ASSISTANT_BOT_PROMPT.md`](./AI_ASSISTANT_BOT_PROMPT.md)

---

## Authentication

**Header:** `Authorization: Bearer <TOKEN>`

Token types:
1. **Static API Key** (`AGENT_API_KEY` env var) — for server-to-server / bot integration
2. **Firebase Auth JWT** — for browser/web clients

**Rate Limit:** 60 requests / 60 seconds per user

---

## Error Format (all endpoints)

```json
{
  "error": "Human-readable message",
  "code": "VALIDATION_ERROR | CLIENT_ERROR | DATABASE_ERROR | INTERNAL_ERROR",
  "requestId": "req_xxx_yyy",
  "details": [
    { "field": "fieldName", "message": "Issue description" }
  ]
}
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error (Zod schema) |
| 401 | Missing or invalid token |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Unhandled server error |

---

## Endpoints Summary

| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | GET | `/api/health` | Health check (public, no auth) |
| 2 | GET | `/api/dashboard` | Full dashboard context |
| — | — | **CLIENTS** | — |
| 3 | POST | `/api/clients` | Create client |
| 4 | GET | `/api/clients/list` | List clients |
| 5 | GET | `/api/clients/search?q=` | Fuzzy search clients |
| 6 | GET | `/api/clients/:id` | Client profile + related data |
| 7 | PATCH | `/api/clients/:id` | Update client |
| 8 | GET | `/api/clients/check-duplicates` | Check for duplicates before create |
| 9 | GET | `/api/clients/duplicates-scan` | Scan all clients for duplicates |
| 10 | POST | `/api/clients/merge` | Merge two clients |
| — | — | **PROJECTS** | — |
| 11 | POST | `/api/projects` | Create project |
| 12 | GET | `/api/projects/list` | List projects |
| 13 | GET | `/api/projects/:id/dashboard` | Project dashboard |
| 14 | POST | `/api/projects/:id/files` | Upload file to project |
| 15 | GET | `/api/projects/:id/files` | List project files |
| — | — | **TASKS (GTD)** | — |
| 16 | POST | `/api/gtd-tasks` | Create task |
| 17 | GET | `/api/gtd-tasks/list` | List tasks (with filters) |
| 18 | PATCH | `/api/gtd-tasks/:id` | Update task |
| 19 | DELETE | `/api/gtd-tasks/:id` | Archive task |
| 20 | POST | `/api/gtd-tasks/batch-update` | Batch update tasks |
| — | — | **ESTIMATES** | — |
| 21 | POST | `/api/estimates` | Create estimate |
| 22 | GET | `/api/estimates/list` | List estimates |
| 23 | PATCH | `/api/estimates/:id` | Update estimate |
| 24 | POST | `/api/estimates/:id/convert-to-tasks` | Convert to tasks |
| — | — | **COSTS** | — |
| 25 | POST | `/api/costs` | Create cost |
| 26 | GET | `/api/costs/list` | List costs |
| 27 | DELETE | `/api/costs/:id` | Void cost |
| — | — | **TIME TRACKING** | — |
| 28 | POST | `/api/time-tracking` | Start/Stop/Status |
| 29 | GET | `/api/time-tracking/active-all` | All active sessions |
| 30 | GET | `/api/time-tracking/summary` | Time summary by period |
| 31 | POST | `/api/time-tracking/admin-stop` | Force stop session |
| — | — | **FINANCE** | — |
| 32 | GET | `/api/projects/status` | Project financial status |
| 33 | GET | `/api/finance/context` | Finance UI context |
| 34 | POST | `/api/finance/transactions/batch` | Bulk upload bank transactions |
| 35 | POST | `/api/finance/transactions/approve` | Approve transactions |
| 36 | POST | `/api/finance/transactions/undo` | Undo approval |
| — | — | **USERS & CONTACTS** | — |
| 37 | GET | `/api/users/list` | List users |
| 38 | GET | `/api/users/search?q=` | Search users |
| 39 | POST | `/api/users/create-from-bot` | Create user from Telegram |
| 40 | POST | `/api/contacts` | Create contact |
| 41 | GET | `/api/contacts/search?q=` | Search contacts |
| — | — | **SITES** | — |
| 42 | POST | `/api/sites` | Create site |
| 43 | GET | `/api/sites?clientId=` | List sites |
| 44 | PATCH | `/api/sites/:id` | Update site |
| — | — | **INVENTORY** | — |
| 45 | POST | `/api/inventory/warehouses` | Create warehouse |
| 46 | GET | `/api/inventory/warehouses` | List warehouses |
| 47 | GET | `/api/inventory/warehouses/:id` | Warehouse details |
| 48 | PATCH | `/api/inventory/warehouses/:id` | Update warehouse |
| 49 | DELETE | `/api/inventory/warehouses/:id` | Archive warehouse |
| 50 | POST | `/api/inventory/items` | Create item |
| 51 | PATCH | `/api/inventory/items/:id` | Update item |
| 52 | DELETE | `/api/inventory/items/:id` | Delete item |
| 53 | GET | `/api/inventory/items` | List items |
| 54 | POST | `/api/inventory/transactions` | Create transaction |
| 55 | POST | `/api/inventory/transactions/task` | Task-based deduction |
| 56 | GET | `/api/inventory/transactions` | List transactions |
| 57 | POST | `/api/inventory/norms` | Create norm |
| 58 | GET | `/api/inventory/norms` | List norms |
| 59 | GET | `/api/inventory/norms/:id` | Norm details |
| 60 | POST | `/api/inventory/write-off-by-norm` | Write-off by norm |
| — | — | **ERP** | — |
| 61 | POST | `/api/change-orders` | Create change order |
| 62 | GET | `/api/change-orders` | List change orders |
| 63 | PATCH | `/api/change-orders/:id` | Update change order |
| 64 | POST | `/api/purchase-orders` | Create purchase order |
| 65 | GET | `/api/purchase-orders` | List purchase orders |
| 66 | GET | `/api/plan-vs-fact?projectId=` | Plan vs Fact report |
| — | — | **FILES** | — |
| 67 | POST | `/api/files/upload` | Upload file (base64) |
| 68 | POST | `/api/files/upload-from-url` | Upload from URL |
| 69 | GET | `/api/files/search` | Search files |
| 70 | GET | `/api/files/stats` | File statistics |
| 71 | GET | `/api/clients/:id/files` | Client files |
| 72 | GET | `/api/gtd-tasks/:id/files` | Task files |
| 73 | GET | `/api/costs/:id/receipt` | Cost receipt |
| 74 | PATCH | `/api/files/:id` | Update file metadata |
| 75 | DELETE | `/api/files/:id` | Delete file |
| — | — | **SHARING & PORTAL** | — |
| 76 | POST | `/api/clients/:id/share-tokens` | Create share link |
| 77 | GET | `/api/clients/:id/share-tokens` | List share tokens |
| 78 | DELETE | `/api/clients/:id/share-tokens/:tokenId` | Revoke token |
| 79 | GET | `/api/portal/:slug?token=` | Public client portal (no auth) |
| 80 | POST | `/api/portal/:slug/approve` | Client approves estimate |
| 81 | POST | `/api/portal/:slug/comment` | Client comments |
| — | — | **FEEDBACK & ACTIVITY** | — |
| 82 | POST | `/api/agent-feedback` | Submit bug/feedback |
| 83 | GET | `/api/agent-feedback/list` | List feedback |
| 84 | GET | `/api/activity/list` | Audit log |
| — | — | **DOCS** | — |
| 85 | GET | `/api/docs` | Swagger UI (public) |
| 86 | GET | `/api/docs/spec.json` | OpenAPI spec (public) |
| — | — | **BLUEPRINT** | — |
| 87 | POST | `/api/blueprint/split` | Split PDF into pages |
| 88 | POST | `/api/blackboard` | Create/update blackboard |
| 89 | GET | `/api/blackboard/:projectId` | Get blackboard |

---

## Detailed Endpoint Documentation

---

### HEALTH

#### `GET /api/health` (Public)

```bash
curl https://profit-step.web.app/api/health
```

Response:
```json
{
  "status": "ok",
  "version": "4.4.0",
  "uptime": 12345,
  "timestamp": "2026-04-15T12:00:00.000Z"
}
```

---

### CLIENTS

#### `POST /api/clients`

Create a new client. Has built-in duplicate detection.

```json
{
  "name": "John Smith",
  "phone": "+13055551234",
  "email": "john@example.com",
  "address": "123 Main St, Miami, FL",
  "type": "residential",
  "contactPerson": "John Smith",
  "notes": "Referred by Boris",
  "company": "Smith LLC",
  "geo": { "lat": 25.7617, "lng": -80.1918 },
  "force": false,
  "idempotencyKey": "unique-key-123"
}
```

**Duplicate Detection** (skipped if `force: true`):
- Phone exact match (normalized to E.164)
- Geo proximity (< 150m Haversine)
- Fuzzy name match (Fuse.js, threshold 0.3)

Response `201`:
```json
{
  "clientId": "abc123",
  "name": "John Smith",
  "warnings": []
}
```

Response `409` (duplicate found):
```json
{
  "error": "Potential duplicate clients found",
  "code": "DUPLICATE_DETECTED",
  "duplicates": [
    {
      "id": "existing123",
      "name": "John Smith",
      "matchReasons": ["phone_match", "geo_proximity_42m"]
    }
  ]
}
```

#### `GET /api/clients/list?limit=50&status=active`

#### `GET /api/clients/search?q=john&limit=5`

Fuzzy search across name, address, phone, email.

#### `GET /api/clients/:id`

Returns full client profile with related:
- Projects, tasks, costs, time tracking sessions, estimates, sites

#### `PATCH /api/clients/:id`

```json
{
  "phone": "+13055559999",
  "notes": "Updated contact info"
}
```

#### `GET /api/clients/duplicates-scan`

Scans ALL clients, returns groups with confidence levels (high/medium/low).

#### `POST /api/clients/merge`

```json
{
  "sourceId": "client-to-remove",
  "targetId": "client-to-keep",
  "dryRun": true
}
```

Merges references across 10 collections: projects, gtd_tasks, costs, work_sessions, estimates, sites, project_ledger, shopping_lists, project_locations, activity_logs.

---

### TASKS (GTD)

#### `POST /api/gtd-tasks`

```json
{
  "title": "Install kitchen cabinets",
  "status": "next_action",
  "priority": "high",
  "clientId": "client123",
  "projectId": "project456",
  "assigneeId": "user789",
  "dueDate": "2026-04-20T00:00:00.000Z",
  "description": "Full kitchen remodel - phase 2",
  "idempotencyKey": "task-unique-key"
}
```

**Status values:** `inbox`, `next_action`, `waiting`, `projects`, `estimate`, `someday`, `completed`, `archived`

**Priority values:** `high`, `medium`, `low`, `none`

#### `GET /api/gtd-tasks/list`

Query parameters:
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Comma-separated: `next_action,waiting` |
| `clientId` | string | Filter by client |
| `clientIds` | string | Comma-separated (max 10) |
| `clientName` | string | Fuzzy lookup |
| `projectId` | string | Filter by project |
| `assigneeId` | string | Filter by assignee |
| `priority` | enum | `high\|medium\|low\|none` |
| `dueBefore` | ISO date | Tasks due before this date |
| `dueAfter` | ISO date | Tasks due after this date |
| `sortBy` | enum | `createdAt\|dueDate\|priority\|updatedAt` |
| `sortDir` | enum | `asc\|desc` |
| `limit` | number | 1-100, default 50 |
| `offset` | number | default 0 |

Example:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://profit-step.web.app/api/gtd-tasks/list?status=next_action&sortBy=dueDate&sortDir=asc&limit=10"
```

#### `PATCH /api/gtd-tasks/:id`

```json
{
  "status": "completed",
  "description": "Done - installed 12 cabinets"
}
```

Also supports budget fields: `budgetAmount`, `paidAmount`, `budgetCategory`, `progressPercentage`, `payments[]`.

#### `DELETE /api/gtd-tasks/:id`

Soft delete (sets status = `archived`).

#### `POST /api/gtd-tasks/batch-update`

```json
{
  "taskIds": ["task1", "task2", "task3"],
  "update": {
    "status": "completed",
    "priority": "none"
  }
}
```

---

### TIME TRACKING

#### `POST /api/time-tracking`

**Start session:**
```json
{
  "action": "start",
  "taskTitle": "Painting walls - bedroom",
  "clientId": "client123",
  "projectId": "project456",
  "startTime": "2026-04-15T08:00:00.000Z"
}
```

**Stop session:**
```json
{
  "action": "stop",
  "sessionId": "session789",
  "endTime": "2026-04-15T17:00:00.000Z"
}
```

**Check status:**
```json
{
  "action": "status",
  "employeeIds": "user1,user2,user3"
}
```

#### `GET /api/time-tracking/summary?from=2026-04-01&to=2026-04-15&groupBy=employee`

Returns aggregated data with totals, hourly rates, earned amounts.

#### `GET /api/time-tracking/active-all`

Returns all currently active sessions.

#### `POST /api/time-tracking/admin-stop`

Force-stop a session (admin action):
```json
{
  "sessionId": "session789",
  "reason": "Employee forgot to clock out"
}
```

---

### COSTS

#### `POST /api/costs`

```json
{
  "amount": 150.00,
  "category": "materials",
  "clientId": "client123",
  "description": "Drywall sheets 4x8",
  "projectId": "project456",
  "idempotencyKey": "cost-unique-key"
}
```

#### `GET /api/costs/list?clientId=xxx&from=2026-04-01&to=2026-04-15&category=materials,tools`

Response includes `sum.total` and `sum.byCategory`.

---

### ESTIMATES

#### `POST /api/estimates`

```json
{
  "clientId": "client123",
  "items": [
    { "description": "Drywall installation", "quantity": 500, "unitPrice": 3.50, "total": 1750 },
    { "description": "Paint (2 coats)", "quantity": 500, "unitPrice": 2.00, "total": 1000 }
  ],
  "taxRate": 7.5,
  "notes": "Price valid for 30 days",
  "terms": "50% deposit required"
}
```

#### `POST /api/estimates/:id/convert-to-tasks`

```json
{
  "projectId": "project456",
  "assigneeId": "user789"
}
```

---

### FILES

#### `POST /api/files/upload`

```json
{
  "fileName": "receipt-home-depot.jpg",
  "contentType": "image/jpeg",
  "base64Data": "/9j/4AAQSkZJRg...",
  "category": "receipt",
  "clientId": "client123",
  "projectId": "project456",
  "tags": ["materials", "drywall"]
}
```

**Categories:** `receipt`, `photo`, `document`, `blueprint`, `contract`, `invoice`, `report`, `other`

**Max size:** 50MB

**Allowed MIME types:** images (jpg, png, gif, webp, heic, svg), documents (pdf, doc, docx, xls, xlsx, csv, txt, rtf), archives (zip), video (mp4, mov).

#### `POST /api/files/upload-from-url`

```json
{
  "url": "https://example.com/document.pdf",
  "fileName": "contract.pdf",
  "category": "contract",
  "clientId": "client123"
}
```

#### `GET /api/files/search?q=receipt&category=receipt&clientId=xxx&limit=20`

#### `GET /api/files/stats?projectId=xxx`

---

### INVENTORY

#### `POST /api/inventory/warehouses`

```json
{
  "name": "Main Warehouse",
  "type": "physical",
  "address": "456 Storage Rd, Miami, FL"
}
```

Or vehicle:
```json
{
  "name": "Work Van #3",
  "type": "vehicle",
  "licensePlate": "ABC-1234"
}
```

#### `POST /api/inventory/items`

```json
{
  "warehouseId": "warehouse123",
  "name": "Drywall 4x8 Sheet",
  "quantity": 50,
  "unit": "sheets",
  "category": "drywall",
  "costPerUnit": 12.50
}
```

#### `POST /api/inventory/transactions`

**Receive stock:**
```json
{
  "type": "in",
  "toWarehouseId": "warehouse123",
  "items": [
    { "itemId": "item456", "quantity": 20 }
  ],
  "description": "Home Depot delivery"
}
```

**Issue stock:**
```json
{
  "type": "out",
  "fromWarehouseId": "warehouse123",
  "items": [
    { "itemId": "item456", "quantity": 5 }
  ]
}
```

**Transfer:**
```json
{
  "type": "transfer",
  "fromWarehouseId": "warehouse123",
  "toWarehouseId": "van456",
  "items": [
    { "itemId": "item789", "quantity": 10 }
  ]
}
```

---

### ERP (Change Orders & Purchase Orders)

#### `POST /api/change-orders`

```json
{
  "projectId": "project123",
  "title": "Additional bathroom work",
  "items": [
    {
      "description": "Tile installation",
      "quantity": 100,
      "unitPrice": 8.00,
      "totalCost": 800,
      "totalClientPrice": 1200
    }
  ],
  "defaultMarkupPercent": 50
}
```

#### `GET /api/plan-vs-fact?projectId=xxx`

Returns variance report: estimated vs actual costs/hours by category.

---

### SHARING & CLIENT PORTAL

#### `POST /api/clients/:id/share-tokens`

```json
{
  "expiresInDays": 30
}
```

Response:
```json
{
  "tokenId": "token123",
  "slug": "john-smith",
  "token": "a1b2c3d4...",
  "url": "https://profit-step.web.app/portal/john-smith?token=a1b2c3d4...",
  "expiresAt": "2026-05-15T00:00:00.000Z"
}
```

#### `GET /api/portal/:slug?token=xxx` (Public, no auth)

Returns filtered client data safe for client viewing.

---

### FEEDBACK

#### `POST /api/agent-feedback`

```json
{
  "type": "bug",
  "severity": "high",
  "endpoint": "/api/gtd-tasks/list",
  "message": "Returns 500 when filtering by status=next_action",
  "httpStatus": 500,
  "metadata": {
    "queryParams": { "status": "next_action" },
    "timestamp": "2026-04-15T03:25:31Z"
  }
}
```

**Type:** `bug` | `error` | `suggestion` | `info`  
**Severity:** `critical` | `high` | `medium` | `low`

---

### ACTIVITY LOG

#### `GET /api/activity/list?action=task_created&limit=20`

Read-only audit trail of all agent actions.

---

## Key Patterns

### Idempotency

Most create endpoints accept `idempotencyKey`. If a request with the same key was already processed, it returns the existing resource instead of creating a duplicate.

```json
{ "idempotencyKey": "openclaw-task-2026-04-15-001" }
```

### Fuzzy Search

`/api/clients/search`, `/api/users/search`, `/api/contacts/search` use Fuse.js fuzzy matching. Score range: 0.0 (exact) to 1.0 (no match). Threshold: 0.4.

### Pagination

```
?limit=50&offset=0
```

Response always includes `total` and `hasMore` where applicable.

### Date Formats

All dates are ISO 8601: `2026-04-15T00:00:00.000Z`

### Soft Deletes

- Tasks: `DELETE` sets `status: 'archived'`
- Costs: `DELETE` sets `status: 'voided'`
- Files: `DELETE` sets `deleted: true`
- Warehouses: `DELETE` sets `archived: true`

---

## Quick Start

```bash
# 1. Health check
curl https://profit-step.web.app/api/health

# 2. Set your token
TOKEN="your-api-key-here"

# 3. Get dashboard
curl -H "Authorization: Bearer $TOKEN" \
  https://profit-step.web.app/api/dashboard

# 4. List tasks for tomorrow
curl -H "Authorization: Bearer $TOKEN" \
  "https://profit-step.web.app/api/gtd-tasks/list?status=next_action&dueBefore=2026-04-16T23:59:59Z&sortBy=dueDate&sortDir=asc"

# 5. Create a task
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Check plumbing","status":"next_action","priority":"high"}' \
  https://profit-step.web.app/api/gtd-tasks

# 6. Report a bug
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"bug","message":"Task list returns empty","endpoint":"/api/gtd-tasks/list"}' \
  https://profit-step.web.app/api/agent-feedback
```
