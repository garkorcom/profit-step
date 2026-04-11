# Profit Step — Bot & API Technical Reference

> **For AI agents working on this codebase.**
> Last updated: 2026-04-11
> Owner: Denis (Telegram: @denysharbuzov)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Telegram Worker Bot](#2-telegram-worker-bot)
3. [Bot Commands Reference](#3-bot-commands-reference)
4. [Bot Handler Modules](#4-bot-handler-modules)
5. [Callback Data Patterns](#5-callback-data-patterns)
6. [Bot State Machine](#6-bot-state-machine)
7. [Agent REST API](#7-agent-rest-api)
8. [API Routes Reference](#8-api-routes-reference)
9. [Firestore Collections](#9-firestore-collections)
10. [Scheduled Functions](#10-scheduled-functions)
11. [Callable Functions](#11-callable-functions)
12. [Firestore Triggers](#12-firestore-triggers)
13. [Environment Variables](#13-environment-variables)
14. [Key Business Flows](#14-key-business-flows)
15. [Safety Rules for AI Agents](#15-safety-rules-for-ai-agents)

---

## 1. Architecture Overview

```
Telegram Bot Webhook (HTTPS)
    |
    v
onWorkerBotMessage (Cloud Function, 1st Gen)
    |
    +-- Text commands --> Command Router
    +-- Photos        --> Shopping / Work Session / Inbox
    +-- Voice         --> Shopping / Work Session / Inbox (AI transcription)
    +-- Location      --> Geo-match project --> Start/Finish shift
    +-- Callbacks     --> Inline button handler (40+ prefixes)
    |
    +-- Handler Modules:
        +-- selfServiceHandler.ts  (/mybalance, /myhours, /mypay, switch project)
        +-- smartStartHandler.ts   (smart start, tasks, end day, reports, timeline)
        +-- gtdHandler.ts          (GTD task management, AI planner)
        +-- shoppingHandler.ts     (shopping lists, receipts, OCR)
        +-- poHandler.ts           (advance accounts, expense tracking)
        +-- inboxHandler.ts        (notes, voice memos, documents)

Agent REST API (Express on Cloud Function)
    |
    +-- /api/health          (public)
    +-- /api/portal/:slug    (token-based, client portal)
    +-- /api/*               (Bearer token auth)
        +-- /clients, /costs, /estimates, /gtd-tasks,
            /time-tracking, /finance, /projects, /sites,
            /erp, /inventory, /users, /contacts, /sharing

Firebase Infrastructure:
    +-- Firestore (40+ collections)
    +-- Cloud Functions (70+ exports)
    +-- Storage (photos, voices, documents)
    +-- Hosting (React SPA at profit-step.web.app)
    +-- Auth (platform users, not bot workers)
```

---

## 2. Telegram Worker Bot

**Entry point:** `functions/src/triggers/telegram/onWorkerBotMessage.ts`
**Type:** Firebase Cloud Function (1st Gen, HTTPS trigger)
**Webhook:** Set via Telegram Bot API to Cloud Function URL

### Message Processing Pipeline

```
1. Idempotency check (processed_messages collection)
2. Auth check (employees collection, password: 9846)
3. GTD state check (bot_gtd_state) — if active GTD flow, route there
4. PO state check (bot_po_state) — if active PO flow, route there
5. Main command router:
   - /start, /menu        --> Reset stuck states + sendMainMenu + suggestQuickStart
   - /help, /?            --> Help text
   - Text commands        --> Route to handler
   - Button text          --> Route to handler
   - Location             --> Geo-match or finish shift
   - Photo/Video/Document --> Work session media or Inbox
   - Voice                --> Shopping / Work session / Inbox
   - Callback query       --> handleCallbackQuery (40+ prefixes)
6. Fallback: AI Assistant (Gemini) for unrecognized text
```

### Persistent Keyboard (Reply Keyboard)

**Idle state (no active session):**
```
[Start shift]
[Balance] [My status]
[Tasks] [Help]
[Shopping] [PO / Advances]
```

**Working state (active session):**
```
[Stop shift] [Break]
[Switch project] [End day]
[Balance] [My status]
[Shopping] [Tasks]
[PO / Advances]
```

**Break state (paused session):**
```
[Resume work]
[Stop shift]
[My status] [Help]
[PO / Advances]
```

---

## 3. Bot Commands Reference

### Timer & Shift

| Command / Button | Handler | Description |
|---|---|---|
| `/start`, `/menu` | Main handler | Show main menu, reset stuck states, suggest quick-start |
| `Start shift` button | Main handler | Prompt for location/photo to start |
| `Stop shift` button | `handleFinishWorkRequest()` | Start finish flow (location -> photo -> voice) |
| `End day` button | `SmartStartHandler.handleEndDay()` | One-tap end with auto-summary across all sessions |
| `Break` button | `pauseWorkSession()` | Pause active timer |
| `Resume` button | `resumeWorkSession()` | Resume from break |
| `/switch`, `Switch project` | `SelfServiceHandler.handleSwitchProject()` | Switch project without stop/start |
| `Finish Late` button | `handleFinishLateRequest()` | Late close with time adjustment |

### Self-Service

| Command | Handler | Description |
|---|---|---|
| `/mybalance`, `Balance` | `SelfServiceHandler.handleMyBalance()` | YTD salary: earned, paid, balance, last payment, PO balance |
| `/myhours` | `SelfServiceHandler.handleMyHours()` | Weekly hours: daily breakdown, projects per day, 40h tracker |
| `/mypay` | `SelfServiceHandler.handleMyPay()` | Last month pay stub: earnings by project, deductions, payments |
| `/myweek` | `SelfServiceHandler.handleMyWeek()` | Weekly summary: bar chart, per-project, tasks completed |
| `/timeline` | `SmartStartHandler.handleTimeline()` | Today's timeline: all sessions, travel gaps, running total |
| `/me` | `handleMe()` | Show user profile (name, ID, rate) |
| `/name <new>` | `handleNameChange()` | Change display name |

### Tasks

| Command | Handler | Description |
|---|---|---|
| `/tasks`, `Tasks` | `GtdHandler.sendTasksMenu()` | GTD kanban menu (columns) |
| `/mytasks` | `GtdHandler.sendMyTasks()` | Top 3 urgent tasks |
| `/task <text>` | `GtdHandler.handleQuickTask()` | AI-powered quick task creation |
| `/plan` | `GtdHandler.handlePlanCommand()` | AI day planner |
| `/template` | `GtdHandler.handleTemplateCommand()` | Project task templates |
| `/team` | `GtdHandler.handleTeamCommand()` | Team overview (who's working where) |
| `/pool` | `GtdHandler.handlePoolCommand()` | Unassigned tasks pool |

### Reporting

| Command | Handler | Description |
|---|---|---|
| `/report`, `Report` | `SmartStartHandler.showReportMenu()` | Quick report: materials, problem, safety, late, help |
| `/help`, `/?` | Main handler | Full help text with all commands |

### Other

| Command | Handler | Description |
|---|---|---|
| `/shopping`, `Shopping` | `ShoppingHandler.handleShoppingCommand()` | Shopping lists and receipts |
| `/inbox`, `Inbox` | Main handler | Inbox mode instructions |
| `/po`, `PO / Advances` | `POHandler.handlePOCommand()` | Advance accounts management |
| `/cancel` | `handleCancel()` | Cancel current operation |

---

## 4. Bot Handler Modules

### 4.1. Self-Service Handler

**File:** `functions/src/triggers/telegram/handlers/selfServiceHandler.ts`

| Export | Purpose |
|---|---|
| `handleMyWeek(chatId, userId)` | Weekly summary with bar chart |
| `handleMyBalance(chatId, userId)` | YTD salary balance |
| `handleMyHours(chatId, userId)` | Weekly hours breakdown |
| `handleMyPay(chatId, userId)` | Last period pay stub |
| `handleSwitchProject(chatId, userId)` | Show project picker for switching |
| `handleSwitchProjectCallback(chatId, userId, clientId, callbackQueryId)` | Execute project switch |
| `handleLogTravelCallback(chatId, userId, data)` | Log travel time between projects |

**Helper:** `resolveEmployeeIds(userId)` maps Telegram ID to all Firebase UID variants.

### 4.2. Smart Start Handler

**File:** `functions/src/triggers/telegram/handlers/smartStartHandler.ts`

| Export | Purpose |
|---|---|
| `suggestQuickStart(chatId, userId)` | Suggest yesterday's project on /start |
| `handleQuickStartCallback(chatId, userId, clientId)` | One-tap restart |
| `showProjectTasks(chatId, userId, clientId)` | Auto-show project tasks at clock-in |
| `handleStartTaskCallback(chatId, userId, taskId)` | Link task to timer |
| `handleDoneTaskCallback(chatId, userId, taskId)` | Complete task, show next |
| `handleSwitchTaskCallback(chatId, userId)` | Switch to different task |
| `handleEndDay(chatId, userId)` | Full-day summary + close |
| `handleEndDayCallback(chatId, userId, action)` | Confirm/voice/cancel end-day |
| `quickCloseSession(chatId, userId)` | Force-close skipping all steps |
| `handleBlockTask(chatId, taskId)` | Show block reason picker |
| `handleBlockReasonCallback(chatId, userId, taskId, reason)` | Block with reason |
| `handleUnblockTask(chatId, userId, taskId)` | Unblock task |
| `handleTimeline(chatId, userId)` | Day timeline with gap detection |
| `showPhotoCategoryPicker(chatId, sessionId, photoFileId)` | Photo category picker |
| `handlePhotoCategoryCallback(chatId, sessionId, category, photoFileId)` | Save category |
| `showReportMenu(chatId)` | Quick report type selector |
| `handleReportCallback(chatId, userId, reportType)` | Route report by type |
| `handleLateCallback(chatId, userId, minutes)` | Log late arrival |
| `handleReportDetails(chatId, userId, text, reportType, projectName, clientId)` | Save report |

### 4.3. GTD Handler

**File:** `functions/src/triggers/telegram/handlers/gtdHandler.ts`

**Constants:**
- `GTD_COLUMNS`: inbox, next_action, projects, waiting, pending_approval, someday, done
- `WAITING_REASONS`: materials, inspection, permit, client, subcontractor, other
- `PHASE_TAGS`: demo, rough, finish, punch_list, warranty
- `PRIORITY_EMOJI`: high=red, medium=orange, low=blue, none=white

**Key Exports:**
- `sendTasksMenu()` / `sendMyTasks()` / `sendTaskList()` - Task display
- `handleQuickTask()` / `createTasksFromVoiceReport()` - AI task creation
- `handleGtdCallback()` - Routes 30+ callback prefixes
- `moveTask()` / `handlePlanCommand()` - Task operations
- `handlePhase2Callback()` - Comments, progress, delegate, photos
- `handlePhase4Callback()` - Templates, waiting reasons, phase tags, proof, approval
- `handlePhase6Callback()` - Team overview, self-assign, smart-assign
- `getGtdState()` / `handleGtdFlowMessage()` - Multi-step flow management

### 4.4. Shopping Handler

**File:** `functions/src/triggers/telegram/handlers/shoppingHandler.ts`

- `handleShoppingCommand()` - Menu with shopping lists
- `handleShoppingCallback()` - All shop: callbacks
- `handleShoppingQuickAddText()` - Text item add
- `handleShoppingVoiceInput()` - Voice -> AI parse -> items
- `handleShoppingPhotoInput()` - Photo -> OCR -> items
- `handleShoppingReceiptPhoto()` / `handleGoodsPhoto()` - Dual-proof receipt flow
- `handleDraftCallback()` - Confirm/edit parsed items

### 4.5. PO (Advance) Handler

**File:** `functions/src/triggers/telegram/handlers/poHandler.ts`

- `handlePOCommand()` - Show advances summary
- `handlePOCallback()` - All po_ callbacks
- `handlePOFlowMessage()` - Multi-step expense/return flow
- `getPOState()` - Current PO flow state from bot_po_state collection

### 4.6. Inbox Handler

**File:** `functions/src/triggers/telegram/handlers/inboxHandler.ts`

- `handleInboxText()` / `handleInboxVoice()` / `handleInboxPhoto()` / `handleInboxDocument()` / `handleInboxForward()` - Capture everything to notes collection
- `createNote()` - Unified note creation

### 4.7. Telegram Utilities

**File:** `functions/src/triggers/telegram/telegramUtils.ts`

| Export | Purpose |
|---|---|
| `sendMessage(chatId, text, replyMarkup?)` | Send Telegram message (supports keyboard, inline_keyboard) |
| `editMessage(chatId, messageId, text)` | Edit existing message |
| `getActiveSession(userId)` | Get active OR paused work_session |
| `getActiveSessionStrict(userId)` | Get ONLY active (not paused) |
| `sendMainMenu(chatId, userId)` | Build status + persistent keyboard |
| `buildStatusAndKeyboard(session, name)` | Pure function: status + buttons |
| `findPlatformUser(telegramId)` | Lookup user in users collection |
| `logBotAction(userId, targetId, action, meta?)` | Audit log |
| `sendAdminNotification(text)` | Send to ADMIN_GROUP_ID |
| `calculateDistanceMeters(lat1, lon1, lat2, lon2)` | Geo distance |

### 4.8. Rate Utilities

**File:** `functions/src/triggers/telegram/rateUtils.ts`

- `resolveHourlyRate(telegramId)` - Priority: platformUser.defaultRate -> platformUser.hourlyRate -> employee.hourlyRate -> 0. Returns `{ hourlyRate, platformUser, platformUserId, companyId, employeeName }`.

---

## 5. Callback Data Patterns

All inline button callbacks are routed in `handleCallbackQuery()`. Format: `prefix:param1:param2:...`

### Work Session Callbacks

| Pattern | Handler | Description |
|---|---|---|
| `start_client_{clientId}` | `handleClientSelection()` | Select project to start |
| `svc\|{clientId}\|{index}` | `handleServiceSelection()` | Select service within project |
| `cancel_selection` | Main | Cancel project selection |
| `force_finish_work` | `handleFinishWorkRequest()` | Confirm finish |
| `cancel_close_session` | Main | Cancel finish |
| `extend_1h` / `extend_2h` / `still_working` | `extendSession()` | Extend active session |
| `location_confirm_start` | `handleLocationConfirmStart()` | Confirm geo-detected project |
| `location_pick_other` | `handleLocationPickOther()` | Choose different project |
| `location_cancel` | `handleLocationCancel()` | Cancel start |
| `location_new_client_{id}` | `handleLocationNewClient()` | Pick from list |
| `location_confirm_finish` | `handleLocationConfirmFinish()` | Confirm finish location |
| `location_cancel_finish` | `handleLocationCancelFinish()` | Cancel finish |
| `checklist_yes_{step}` / `checklist_no_{step}` | `handleChecklistCallback()` | Answer checklist |

### Smart Start Callbacks

| Pattern | Handler | Description |
|---|---|---|
| `quick_start:{clientId}` | `SmartStartHandler` | One-tap restart (`other` = show list) |
| `start_task:{taskId}` | `SmartStartHandler` | Link task to session (`new` / `skip`) |
| `done_task:{taskId}` | `SmartStartHandler` | Mark task complete |
| `switch_task` | `SmartStartHandler` | Show task picker |
| `end_day:{action}` | `SmartStartHandler` | confirm / voice / cancel |
| `block_task:{taskId}` | `SmartStartHandler` | Show block reason picker |
| `block_reason:{taskId}:{reason}` | `SmartStartHandler` | Block with reason |
| `unblock_task:{taskId}` | `SmartStartHandler` | Unblock task |
| `photo_cat:{sessionId}:{category}:{fileId}` | `SmartStartHandler` | Categorize photo |
| `photo_task:{sessionId}:{fileId}` | `SmartStartHandler` | Create task from problem photo |
| `report:{type}` | `SmartStartHandler` | materials/problem/safety/late/help/cancel |
| `late:{minutes}` | `SmartStartHandler` | 15/30/60 min late notification |

### Self-Service Callbacks

| Pattern | Handler | Description |
|---|---|---|
| `switch_project:{clientId}` | `SelfServiceHandler` | Switch to project (`cancel` to abort) |
| `log_travel:{from}:{to}:{min}` | `SelfServiceHandler` | Log travel time (`skip` to skip) |

### GTD Task Callbacks

| Pattern | Handler | Description |
|---|---|---|
| `tasks:{status}` | `GtdHandler` | View column (inbox, next_action, etc.) |
| `tasks_back` | `GtdHandler` | Back to menu |
| `tasks_plan` | `GtdHandler` | AI day planner |
| `task_view:{taskId}` | `GtdHandler` | Task detail card |
| `task_done:{taskId}` | `GtdHandler` | Mark done |
| `task_move:{taskId}:{status}` | `GtdHandler` | Move to column |
| `task_comment:{taskId}` | `GtdHandler` | Add comment |
| `task_progress:{taskId}` | `GtdHandler` | Update progress % |
| `task_checklist:{taskId}` | `GtdHandler` | Edit checklist items |
| `task_delegate:{taskId}` | `GtdHandler` | Delegate |
| `task_photo:{taskId}` | `GtdHandler` | Attach photo |
| `task_approve:{taskId}` | `GtdHandler` | Approve |
| `task_reject:{taskId}` | `GtdHandler` | Reject |
| `task_proof:{taskId}` | `GtdHandler` | Completion photo proof |
| `task_selfassign:{taskId}` | `GtdHandler` | Self-assign |
| `task_suggest:{taskId}` | `GtdHandler` | AI suggest assignee |
| `task_assign_to:{userId}` | `GtdHandler` | Assign to specific user |
| `task_finance:{taskId}` | `GtdHandler` | View task financials |
| `task_set_waiting:{taskId}` | `GtdHandler` | Mark as waiting |
| `task_wait_reason:{taskId}:{reason}` | `GtdHandler` | Set waiting reason |
| `task_set_phase:{taskId}` | `GtdHandler` | Set construction phase |
| `task_phase:{taskId}:{phase}` | `GtdHandler` | Set phase tag |
| `tmpl_*` | `GtdHandler` | Template operations |
| `team_*` | `GtdHandler` | Team operations |

### Shopping / PO Callbacks

| Pattern | Handler |
|---|---|
| `shop:*` | `ShoppingHandler` |
| `draft:*` | `ShoppingHandler` |
| `po_*` | `POHandler` |

### Zombie Button Protection

Callbacks from messages older than 5 minutes are rejected, EXCEPT for these always-valid prefixes:
`tasks:`, `task_view:`, `task_done:`, `task_move:`, `shop:`, `draft:`, `checklist_`, `po_`, `tmpl_`, `team_`, `switch_project:`, `quick_start:`, `start_task:`, `done_task:`, `switch_task`, `end_day:`, `block_task:`, `block_reason:`, `unblock_task:`, `photo_cat:`, `report:`, `late:`, `log_travel:`, `photo_task:`

---

## 6. Bot State Machine

### Work Session States

```
[no session] --location--> pending_starts --confirm--> active
                                          --cancel---> [no session]

active --break--> paused --resume--> active
active --finish--> awaitingEndLocation --> awaitingEndPhoto --> awaitingEndVoice --> awaitingDescription --> completed
active --quick_close (end day)--> completed (skip all steps)
active --switch_project--> completed + new active (skip setup)

(any awaiting state) --/start--> emergency reset (clear all flags)
```

### Work Session Document Fields

```typescript
{
  employeeId: number | string,    // Telegram user ID
  employeeName: string,
  platformUserId?: string,        // Firebase UID (if linked)
  companyId?: string,
  clientId: string,               // Firestore client doc ID
  clientName: string,
  startTime: Timestamp,
  endTime?: Timestamp,
  status: 'active' | 'paused' | 'completed' | 'auto_closed',
  hourlyRate: number,
  durationMinutes?: number,
  sessionEarnings?: number,
  service?: string,
  type?: 'payment' | 'correction' | 'manual_adjustment' | 'travel',

  // Setup flow flags
  awaitingLocation: boolean,
  awaitingChecklist: boolean,
  checklistStep: number,
  checklistAnswers: Record<string, boolean>,
  awaitingStartPhoto: boolean,
  awaitingDeferredPhoto?: boolean,  // Non-blocking photo request
  awaitingStartVoice?: boolean,
  awaitingEndLocation?: boolean,
  awaitingEndPhoto?: boolean,
  awaitingEndVoice?: boolean,
  awaitingDescription?: boolean,
  awaitingReportDetails?: boolean,
  reportType?: string,

  // Task linking
  relatedTaskId?: string,
  relatedTaskTitle?: string,

  // Geo
  startLocation?: { latitude, longitude },
  endLocation?: { latitude, longitude },

  // Media
  startPhotoUrl?: string,
  endPhotoUrl?: string,
  photoUrls?: string[],

  // Switch tracking
  switchedFromProject?: string,
  switchedToProject?: string,
}
```

---

## 7. Agent REST API

**Base URL:** `https://profit-step.web.app/api/` (Firebase Hosting rewrite to agentApi Cloud Function)
**Auth:** `Authorization: Bearer {AGENT_API_KEY}` (env var)
**Public routes:** `/api/health`, `/api/docs`, `/api/docs/spec.json`, `/api/portal/:slug`

**Source:** `functions/src/agent/`
- `agentApi.ts` - Express app + middleware chain
- `agentMiddleware.ts` - Auth, rate-limit, CORS, logging
- `agentHelpers.ts` - Shared utilities (resolveClient, pagination)
- `routes/*.ts` - Route modules

### Middleware Chain
```
CORS -> requestLogger -> [public routes] -> authMiddleware -> rateLimiter -> routes -> errorHandler
```

### Response Patterns

**Created (201):**
```json
{ "entityId": "abc123", "name": "value", "createdAt": "2026-04-11T..." }
```

**List (200):**
```json
{ "items": [...], "count": 5, "total": 100, "hasMore": false }
```

**Deduplicated (200):**
```json
{ "entityId": "abc123", "deduplicated": true }
```

**Error:**
```json
{ "error": "message", "code": "VALIDATION_ERROR|CLIENT_ERROR|DATABASE_ERROR" }
```

---

## 8. API Routes Reference

### Clients — `routes/clients.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/clients` | name, address, contactPerson, phone, email, notes, type, company, geo, idempotencyKey | Create client |
| PATCH | `/api/clients/:id` | body fields | Update client |
| GET | `/api/clients/list` | limit?, status? | List clients (cached) |
| GET | `/api/clients/search` | q (min 2 chars), limit? | Fuzzy search |
| GET | `/api/clients/:id` | - | Full client profile with related data |

### GTD Tasks — `routes/tasks.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/gtd-tasks` | title, status, priority, clientId, assigneeId, dueDate, etc. | Create task |
| GET | `/api/gtd-tasks/list` | status?, clientId?, assigneeId?, priority?, offset?, limit? | List tasks |
| PATCH | `/api/gtd-tasks/:id` | body fields | Update task |
| POST | `/api/gtd-tasks/batch-update` | taskIds[], update{} | Batch update |

### Time Tracking — `routes/timeTracking.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/time-tracking` | action (start/stop/status), taskTitle?, clientId?, startTime?, endTime? | Start/stop/status |
| GET | `/api/time-tracking/active-all` | - | All active sessions |
| GET | `/api/time-tracking/summary` | from, to, employeeId? | Summary by employee |
| PATCH | `/api/time-tracking/sessions/:id` | body fields | Update session |
| POST | `/api/time-tracking/sessions/:id/end-manual` | endTime, durationMinutes, sessionEarnings | Manual end |

### Costs — `routes/costs.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/costs` | amount, category, description, clientId, clientName, projectId?, idempotencyKey | Create cost |
| GET | `/api/costs/list` | clientId?, category?, from?, to?, sortBy?, offset?, limit? | List with filters |
| DELETE | `/api/costs/:id` | - | Soft-delete (void) |

### Estimates — `routes/estimates.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/estimates` | items[], clientId, address, estimateType, notes, terms, taxRate | Create estimate |
| GET | `/api/estimates/list` | clientId?, status?, offset?, limit? | List estimates |
| PATCH | `/api/estimates/:id` | status?, items?, notes?, terms? | Update estimate |
| POST | `/api/estimates/:id/convert-to-tasks` | - | Convert items to tasks (atomic) |

### Finance — `routes/finance.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/finance/context` | - | Active projects, cost categories, rules |
| POST | `/api/finance/transactions/batch` | transactions[] | Load bank transactions |
| POST | `/api/finance/transactions/approve` | transactions[] | Approve + generate costs |
| POST | `/api/finance/transactions/undo` | transactionIds[] | Undo approval |

### ERP — `routes/erp.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/change-orders` | projectId, title, items[], defaultMarkupPercent | Create CO |
| GET | `/api/change-orders` | projectId?, clientId?, status? | List COs |
| PATCH | `/api/change-orders/:id` | title?, items?, status? | Update CO |
| POST | `/api/purchase-orders` | projectId, vendor, items[], category | Create PO |
| GET | `/api/purchase-orders` | projectId?, clientId?, status? | List POs |
| GET | `/api/plan-vs-fact` | clientId, projectId? | Plan vs actual analysis |

### Inventory — `routes/inventory.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/inventory/warehouses` | name, clientId?, type (physical/vehicle) | Create warehouse |
| GET | `/api/inventory/warehouses` | clientId?, type?, limit? | List warehouses |
| GET/PATCH/DELETE | `/api/inventory/warehouses/:id` | - | CRUD warehouse |
| POST | `/api/inventory/items` | warehouseId, name, quantity, unit, category | Add item |
| GET/PATCH/DELETE | `/api/inventory/items/:id` | - | CRUD item |
| POST | `/api/inventory/transactions` | type (in/out/transfer), itemId, quantity | Record movement |
| POST | `/api/inventory/transactions/task` | taskId, items[] | Bulk deduct for task |
| POST/GET | `/api/inventory/norms` | name, items[] | Consumption templates |
| POST | `/api/inventory/write-off-by-norm` | normId, quantity, warehouseId | Apply norm |

### Projects — `routes/projects.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/projects` | name, clientId, address, type, areaSqft | Create project |
| GET | `/api/projects/list` | clientId?, status?, type?, limit? | List projects |

### Sites — `routes/sites.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/api/sites` | clientId, name, address, city, state, zip, sqft | Create site |
| GET | `/api/sites` | clientId (required) | List client sites |
| PATCH | `/api/sites/:id` | body fields | Update site |

### Users & Contacts — `routes/users.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/users/search` | q, limit? | Fuzzy search users |
| POST | `/api/users/create-from-bot` | telegramId, displayName, hourlyRate, role | Create/update from bot |
| POST | `/api/contacts` | name, phones, emails, roles[], messengers | Create contact |
| GET | `/api/contacts/search` | q, role?, projectId? | Search contacts |

### Portal & Sharing — `routes/portal.ts`, `routes/sharing.ts`

| Method | Path | Parameters | Description |
|---|---|---|---|
| GET | `/api/portal/:slug` | token (query) | Client portal dashboard |
| POST | `/api/portal/:slug/approve` | token, estimateId, sectionId, decision | Approve estimate |
| POST | `/api/portal/:slug/comment` | token, text | Client question |
| POST | `/api/clients/:id/share-tokens` | expiresInDays? | Create portal token |
| GET | `/api/clients/:id/share-tokens` | - | List tokens |
| DELETE | `/api/clients/:id/share-tokens/:tokenId` | - | Revoke token |

### Dashboard — `routes/dashboard.ts`, `routes/dashboardClient.ts`

| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard` | Global dashboard metrics |
| GET | `/api/dashboard/client/:id/summary` | Client financial summary |
| GET | `/api/dashboard/client/:id/labor-log` | Employee labor breakdown |
| GET | `/api/dashboard/client/:id/timeline` | Activity timeline |
| GET | `/api/dashboard/client/:id/costs-breakdown` | Costs by category |

---

## 9. Firestore Collections

### Core Business Data

| Collection | Purpose | Key Fields |
|---|---|---|
| `clients` | Projects/clients | name, address, status (active/done), services[], contactPerson |
| `projects` | Project records | name, clientId, status, type, areaSqft |
| `gtd_tasks` | Task management | title, status (inbox/next_action/waiting/projects/pending_approval/done), priority, assigneeId, clientId, dueDate |
| `costs` | Expenses | amount, category, description, clientId, isVoided |
| `estimates` | Price estimates | clientId, status (draft/sent/accepted), items[], totalAmount, taxRate |
| `work_sessions` | Time tracking | employeeId, clientId, status (active/paused/completed), startTime, endTime, hourlyRate, sessionEarnings |
| `sites` | Job sites | clientId, name, address, geo, sqft |

### Payroll & Finance

| Collection | Purpose | Key Fields |
|---|---|---|
| `payroll_ledger` | Payroll records | employeeId, sessionId, amount, type (work_session), date |
| `payroll_periods` | Period management | startDate, endDate, status (open/closed/locked/paid), totalAmount |
| `advance_accounts` | PO/advance accounts | employeeId, amount, status (open/closed), description |
| `advance_transactions` | PO transactions | advanceId, amount, type (expense_report/payroll_deduction/return), status |
| `bank_transactions` | Bank imports | amount, merchant, status (draft/approved), matchedCostId |
| `finance_rules` | Auto-categorization | merchant, category, projectId |

### Users & Employees

| Collection | Purpose | Key Fields |
|---|---|---|
| `users` | Platform users | email, displayName, companyId, role, telegramId, hourlyRate |
| `employees` | Bot workers | name, telegramId, hourlyRate, role |
| `contacts` | Contact database | name, phones, emails, roles[], messengers |

### Inventory

| Collection | Purpose | Key Fields |
|---|---|---|
| `warehouses` | Storage locations | name, clientId, type (physical/vehicle), archivedAt |
| `inventory_items` | Items in stock | warehouseId, name, quantity, unit, category, minStock |
| `inventory_transactions` | Movement history | type (in/out/transfer), itemId, quantity, fromWarehouseId |
| `inventory_norms` | Templates | name, items[], description |

### Bot State & Media

| Collection | Purpose | Key Fields |
|---|---|---|
| `bot_gtd_state` | GTD flow state | userId, chatId, flow, step, context |
| `bot_po_state` | PO flow state | userId, chatId, flow, step, advanceId, amount |
| `pending_starts` | Location-start buffer | userId, matchedClientId, location, createdAt |
| `processed_messages` | Idempotency | updateId, processedAt |
| `work_session_media` | Session photos | sessionId, fileId, url, type, category, context |
| `bot_logs` | Bot diagnostics | userId, action, metadata |

### Reporting & Notifications

| Collection | Purpose | Key Fields |
|---|---|---|
| `quick_reports` | Bot quick reports | employeeId, type (materials/problem/safety/help), description, clientId |
| `safety_reports` | Safety incidents | employeeId, projectName, status, awaitingDetails |
| `activity_logs` | Activity timeline | projectId, type, content, mediaUrl, performedBy |
| `notes` | Inbox items | userId, content, type (text/voice/photo/document) |
| `shopping_items` | Shopping lists | name, clientId, quantity, price, status |
| `receipts` | Shopping receipts | totalAmount, status, photoFileId |

### Portal & Sharing

| Collection | Purpose | Key Fields |
|---|---|---|
| `client_portal_tokens` | Access tokens | clientId, slug, tokenHash, expiresAt, revoked |
| `client_portal_comments` | Client questions | clientId, estimateId, text |
| `estimate_approvals` | Approval audit | clientId, estimateId, sectionId, decision |

### ERP

| Collection | Purpose | Key Fields |
|---|---|---|
| `companies/{id}/change_orders` | Change orders | projectId, coNumber (CO-001), items[], status |
| `companies/{id}/purchase_orders` | Purchase orders | projectId, vendor, items[], plannedTotal, actualTotal |

### System

| Collection | Purpose |
|---|---|
| `_idempotency` | Dedup keys (24h TTL) |
| `_cache/active_clients` | Client list cache |

---

## 10. Scheduled Functions

**File:** `functions/src/scheduled/`

| Function | Schedule | Purpose |
|---|---|---|
| `finalizeExpiredSessions` | Every 5 min | Mark sessions >2h old as finalized |
| `autoCloseStaleSessions` | Every 30 min | Auto-close sessions >14h |
| `generateDailyPayroll` | Daily 4 AM ET | Create payroll_ledger from yesterday's sessions |
| `reconcileBalances` | Sunday 2 AM ET | Recompute running balances, fix drift |
| `sendDeadlineReminders` | Daily 8 AM ET | Telegram reminders for tasks due today |
| `sendDailyTaskDigest` | Daily 7 AM ET | Morning task summary to workers |
| `autoTaskPriority` | Daily 6 AM ET | Auto-escalate by deadline proximity |
| `taskHealthCheck` | Every 6h | Stale tasks, overrun detection, WIP limits |
| `weeklyTaskSummary` | Friday 5 PM ET | Friday weekly report to all workers |
| `generateRecurringTasks` | Daily midnight ET | Create instances of recurring tasks |
| `shiftHandoff` | Daily 6 PM ET | Shift handoff summary |
| `checkLongBreaks` | Every 15 min | Warn workers on breaks >1h |
| `scheduledDayPlan` | Daily 6:30 AM ET | AI generate suggested day plans |

---

## 11. Callable Functions

**File:** `functions/src/callable/`

### Payroll
- `closePayrollPeriod` - Close period, aggregate totals, auto-deduct advances (FL min wage guard)
- `lockPayrollPeriod` - Lock closed period (admin only, irreversible)
- `forceFinishAllSessions` - Admin: close all active sessions

### GTD
- `moveGtdTask` - Move task between columns with validation
- `generateDayPlan` - AI day planner
- `projectTemplates` - Instantiate project from template
- `taskFinancials` - Task cost/time summary
- `teamOverview` - Team workload, unassigned tasks, smart assign

### AI
- `generateLeadSummary` - Summarize lead data
- `estimateTask` - AI effort estimation
- `parseSmartInput` - Natural language to structured data
- `parseClientWebsite` - Extract client info from URL
- `analyzeBlueprintV3` - Blueprint analysis (Gemini)
- `generateAiTask` / `modifyAiTask` - AI task creation/update
- `verifyEstimatePlausibility` - Estimate validation

### Finance
- `uploadBankStatement` - Upload bank CSV
- `categorizeBankTransactions` - AI categorize transactions

### Quality
- `submitForReview` / `verifyTask` - Task verification workflow

---

## 12. Firestore Triggers

**File:** `functions/src/triggers/`

| Trigger | Collection | Event | Purpose |
|---|---|---|---|
| `onWorkSessionCreate` | work_sessions | create | Period lock guard, flag violations |
| `onWorkSessionUpdate` | work_sessions | update | Auto-finalize, calculate earnings, update ledger |
| `onAdvanceCreated` | advance_accounts | create | Auto-create related GTD task |
| `onNoteCreated` | notes | create | AI process note (extract tasks, categorize) |
| `onWorkerBotMessage` | - | HTTPS | Telegram worker bot webhook |
| `onCostsBotMessage` | - | HTTPS | Telegram costs bot webhook |
| `onTelegramMessage` | - | HTTPS | AI assistant bot webhook |

---

## 13. Environment Variables

### Bot (functions/.env)

| Variable | Purpose |
|---|---|
| `WORKER_BOT_TOKEN` | Telegram bot token for worker bot |
| `WORKER_PASSWORD` | Registration password (default: 9846) |
| `ADMIN_GROUP_ID` | Telegram group chat ID for admin notifications |
| `GEMINI_API_KEY` | Google Generative AI for voice transcription, task parsing, planner |
| `COSTS_BOT_TOKEN` | Telegram bot token for costs bot |

### Agent API (functions/.env)

| Variable | Purpose |
|---|---|
| `AGENT_API_KEY` | Bearer token for REST API auth |
| `OWNER_UID` | Firebase UID of admin user |
| `OWNER_DISPLAY_NAME` | Admin display name |
| `OWNER_COMPANY_ID` | Company ID for multi-tenant queries |
| `NODE_ENV` | production / development |

---

## 14. Key Business Flows

### A. Clock-In Flow

```
1. Worker sends Location (or /start)
2. Geo-match: findNearbyProject() checks all clients with saved locations
3. If match found:
   - Show: "Start at {project}? [Yes] [Other]"
   - On confirm: create work_session (active)
4. If no match:
   - Show client list as inline buttons
5. After session created:
   a. Skip checklist if same project within 24h (Case 4)
   b. Otherwise: 3 checklist questions (materials? tools? access?)
   c. Timer starts immediately (not blocked by photo)
   d. Photo requested as "deferred" (non-blocking, Case 5)
   e. Show project tasks inline (Case 9)
   f. Smart start suggestion for next /start (Case 1)
```

### B. End-of-Day Flow

```
Option 1: Full flow (Stop shift button)
  Location -> Photo -> Voice report -> AI summarize -> Complete

Option 2: Quick close (End Day button, Case 31)
  Bot shows full-day summary across ALL sessions
  [Confirm] -> auto-close active session, skip all steps
  [Voice notes] -> record voice, then close
```

### C. Project Switch (Case 21)

```
1. Worker taps "Switch project" or /switch
2. Bot shows inline keyboard of active clients (excluding current)
3. Worker taps new project
4. Old session: auto-close with calculated earnings
5. New session: create immediately (skip checklist/photo/voice)
6. Bot offers travel time: [15min] [30min] [45min] [Skip]
```

### D. Payroll Period Lifecycle

```
open -> close (closePayrollPeriod callable)
  - Aggregate: total hours, amount, employee count
  - Auto-deduct open advances (FIFO, FL min wage guard $13/h)
  - Create work_sessions type=manual_adjustment for deductions
  - Create advance_transactions type=payroll_deduction
  - Block: sessions with endTime in closed period get flagged

closed -> lock (lockPayrollPeriod callable)
  - Admin only, irreversible
  - Locked periods: no new sessions can be backdated

locked -> paid (manual, future)
```

### E. Advance (PO) Auto-Link

```
1. Costs bot receives expense from worker
2. Lookup worker's open advance_accounts
3. FIFO: pick oldest open advance
4. Create advance_transaction type=expense_report with costDocId
5. If advance fully spent: mark status=settled
6. Bot shows: "Списано с аванса: $X. Остаток: $Y"
```

---

## 15. Safety Rules for AI Agents

1. **NEVER modify `onWorkerBotMessage.ts` without testing** - live bot used daily by workers
2. **NEVER write to the same document a trigger watches** without idempotency guard (infinite loop = $10k+ billing)
3. **NEVER `git push --force`** on main/feature branches
4. **NEVER commit .env, secrets, or service account keys**
5. **NEVER deploy triggers without emulator testing first**
6. **Always use deterministic doc IDs** for financial writes (prevents duplicates on retry)
7. **Always normalize employee IDs** (telegramId vs Firebase UID — see `resolveEmployeeIds()`)
8. **Pre-existing TS errors exist** (TS2307 for axios/openai/@google types) — don't add new ones
9. **Payroll changes = ask Denis** — any error can cost real money
10. **Bot keyboard changes affect ALL workers immediately** — test in emulator first

---

*Generated 2026-04-11. Source of truth: codebase in `functions/src/`.*
