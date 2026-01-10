# Profit Step - Code Architecture Documentation

## Overview

Profit Step is a team management platform with time tracking, GTD task management, and Telegram bot integration.

---

## Module Structure

### 1. Time Tracking (`/crm/time-tracking`)

**Purpose:** Track work sessions, calculate hours and earnings.

**Files:**
```
src/pages/crm/TimeTrackingPage.tsx          # Main page (~320 lines)
src/components/time-tracking/
├── TimeTrackingFilters.tsx                 # Date, status, employee, client filters
├── TimeTrackingSummary.tsx                 # Stats cards (hours, employees, breaks, sessions)
├── TimeTrackingCharts.tsx                  # Daily activity bar chart, client pie chart
├── TimeTrackingTable.tsx                   # Sessions table with actions
└── index.ts                                # Barrel export
src/utils/dateFormatters.ts                 # formatDuration, formatDate, formatTime, getStatusColor
src/types/timeTracking.types.ts             # WorkSession interface
```

**Data Flow:**
1. `TimeTrackingPage` fetches sessions from `work_sessions` collection
2. Filters applied via `useMemo` hooks
3. Stats calculated from filtered sessions
4. Components receive data as props

**Key Functions:**
- `handleCorrection()` - Creates correction ledger entry
- `handleVoidSession()` - Creates negative correction to void session
- `handleExportCSV()` - Exports data to CSV
- `handleForceStopAll()` - Admin action to stop all active sessions

---

### 2. GTD/Lookahead (`/crm/gtd`)

**Purpose:** Kanban-style task management with 6 columns.

**Files:**
```
src/pages/crm/GTDPage.tsx                   # Slim wrapper (25 lines)
src/components/gtd/
├── GTDBoard.tsx                            # Main board logic (539 lines)
├── GTDColumn.tsx                           # Column component with drag-drop
├── GTDTaskCard.tsx                         # Task card with timer integration
├── GTDEditDialog.tsx                       # Edit task dialog
└── index.ts                                # Barrel export
src/types/gtd.types.ts                      # GTDTask, GTDStatus interfaces
```

**Columns:** Inbox → Next Actions → Projects → Waiting For → Someday/Maybe → Done

**Key Features:**
- Drag-and-drop via `@hello-pangea/dnd`
- Timer integration (Start/Stop session from card)
- Real-time sync via Firestore `onSnapshot`
- Mobile responsive with tabs

---

### 3. Telegram Bot (`functions/src/triggers/telegram/`)

**Purpose:** Remote time tracking via Telegram.

**Main File:** `onWorkerBotMessage.ts` (~1200 lines)

**Key Functions:**
```typescript
handleStart()           // /start command, shows main menu
handleSelectClient()    // Client selection keyboard
handleClientSelection() // Starts session for selected client
handleStopWork()        // Stops active session, prompts for description
handleFinishDay()       // Calculates daily totals
calculateDailyStats()   // Timezone-aware daily aggregation
handleTimezone()        // /timezone command to set user timezone
```

**Session Flow:**
1. User sends `/start` → Shows client list
2. User selects client → Creates `work_session` document (status: 'active')
3. User sends "🛑 Stop" → Prompts for description
4. User enters description → Calculates duration, earnings, closes session

**Dual-ID Query:**
Sessions can be created by Web UI (Firebase UID) or Bot (Telegram ID).
`calculateDailyStats()` queries both IDs to aggregate all user sessions.

---

## Time Calculation

### Formula (Consistent Across All Modules)
```typescript
// Duration
const durationMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);

// Earnings
const hours = durationMinutes / 60;
const sessionEarnings = parseFloat((hours * hourlyRate).toFixed(2));
```

### Break Time
- Bot subtracts `totalBreakMinutes` from duration
- GTD Board ignores breaks (quick switch)

---

## Firestore Collections

| Collection | Purpose |
|------------|---------|
| `work_sessions` | Time tracking sessions |
| `users/{uid}/gtd_tasks` | GTD tasks per user |
| `employees` | Employee records (telegram bot) |
| `clients` | Client/project records |
| `projects` | Project records |

---

## Key Interfaces

### WorkSession
```typescript
interface WorkSession {
    id: string;
    employeeId: number | string;    // Telegram ID or Firebase UID
    employeeName: string;
    clientId: string;
    clientName: string;
    startTime: Timestamp;
    endTime?: Timestamp;
    durationMinutes?: number;
    hourlyRate?: number;
    sessionEarnings?: number;
    status: 'active' | 'completed' | 'paused' | 'auto_closed';
    type?: 'regular' | 'correction' | 'manual_adjustment';
    relatedTaskId?: string;         // Links to GTD task
}
```

### GTDTask
```typescript
interface GTDTask {
    id: string;
    title: string;
    status: GTDStatus;              // inbox, next_action, projects, waiting, someday, done
    priority: 'high' | 'medium' | 'low' | 'none';
    projectId?: string;
    clientId?: string;
    createdAt: Timestamp;
}
```

---

## Common Patterns

### 1. Session Start (Web UI)
```typescript
await addDoc(collection(db, 'work_sessions'), {
    employeeId: effectiveUserId,    // Prefers telegramId if available
    startTime: Timestamp.now(),
    status: 'active',
    ...
});
```

### 2. Session Stop
```typescript
const durationMinutes = Math.round(diff / 60000);
const earnings = parseFloat((durationMinutes / 60 * rate).toFixed(2));
await updateDoc(sessionRef, {
    status: 'completed',
    endTime: Timestamp.now(),
    durationMinutes,
    sessionEarnings: earnings
});
```

### 3. Timezone-Aware Daily Stats
```typescript
const todayString = now.toLocaleDateString('en-US', { timeZone: userTimezone });
sessions.filter(s => s.endTime.toLocaleDateString('en-US', { timeZone: userTimezone }) === todayString);
```

---

## Deployment

```bash
# Build frontend
npm run build

# Deploy hosting only
firebase deploy --only hosting

# Deploy functions only
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:onWorkerBotMessage
```
