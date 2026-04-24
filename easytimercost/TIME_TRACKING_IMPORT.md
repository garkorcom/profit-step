# Time Tracking Import Plan
## Phase 0: Foundation БЕЗ AI (Weeks 1-4)

> **Принцип:** базовая система должна работать **без единой AI-фичи**. AI добавляется incrementally в Phase 1 после 2 недель stabilization.

**Источник:** full scan profit-step repo (`/Users/denysharbuzov/Projects/profit-step/`) показал production-grade time tracking систему, которую мы можем портировать как fundament.

---

## 1. Что берём из profit-step (no modifications)

### 🟢 Copy as-is (готовое, proven, tested)

| # | Компонент | Путь в profit-step | Куда в EasyTimerCost | Lines |
|---|---|---|---|---|
| 1 | `WorkSession` interface | `src/types/timeTracking.types.ts` | `functions/src/types/timeTracking.ts` | ~150 |
| 2 | `PayrollPeriod` interface | `src/types/payroll.types.ts` | `functions/src/types/payroll.ts` | ~50 |
| 3 | `TimeTrackingService` | `functions/src/services/TimeTrackingService.ts` | same path | 241 |
| 4 | Payroll bucket formula | `functions/src/modules/finance/services/payroll.ts` | `functions/src/services/payroll.ts` | 94 |
| 5 | Daily payroll generator | `functions/src/scheduled/generateDailyPayroll.ts` | same path | ~200 |
| 6 | Finalize expired sessions | `functions/src/scheduled/finalizeExpiredSessions.ts` | same path | ~126 |
| 7 | Auto-stop stale timers | `functions/src/scheduled/autoStopStaleTimers.ts` | same path | ~150 |
| 8 | Long break checker | `functions/src/scheduled/checkLongBreaks.ts` | same path | ~80 |
| 9 | Payroll unit tests | `functions/test/payroll.unit.test.ts` | `functions/test/payroll.test.ts` | ~400 |
| 10 | Session close tests | `functions/test/agentApi/time-tracking.test.ts` | `functions/test/timeTracking.test.ts` | ~300 |

**Total:** ~1,800 lines of production code. **Estimated copy effort:** 2 days (not 2 weeks — logic is mature).

### 🟡 Copy + modify (нужны правки)

| # | Компонент | Что менять |
|---|---|---|
| 1 | `functions/src/agent/routes/timeTracking.ts` (1187 lines) | **Remove AI parts** (voice transcription, plannedTaskSummary), keep CRUD logic. Expected: ~800 lines after cleanup |
| 2 | `functions/src/triggers/workSessions/onWorkSessionCreate.ts` | Remove Telegram notification hook (replace with simple audit log, add TG later as optional) |
| 3 | `functions/src/triggers/workSessions/onWorkSessionUpdate.ts` | Simplify: remove AI accuracy logging, BigQuery audit can stay |
| 4 | `firestore.rules` (sessions/workers sections) | Add multi-tenant RLS (`tenants/{tenantId}/...` paths) — в profit-step one-tenant |
| 5 | `src/pages/crm/TimeTrackingPage.tsx` | Copy logic, modernize to our MUI v7 theme |
| 6 | `src/pages/crm/PayrollPeriodsPage.tsx` | Copy as-is, rebrand |

### 🔴 НЕ берём (это AI-heavy, Phase 1+)

| Компонент | Почему позже |
|---|---|
| `mediaHandler.ts` (1100+ lines) | 80% AI: face match, voice transcription. Phase 1 layer |
| `locationFlow.ts` AI-nearby-project detection | Phase 0: simple distance check only. AI later |
| Voice-to-text (`voiceStartUrl`, `voiceEndUrl`) | Phase 1 — Gemini Pro |
| `plannedTaskSummary`, `resultSummary` AI transcription | Phase 1 — optional text input для worker |
| Face recognition (faceMatch, faceConfidence) | Phase 1 — Gemini Pro vision |
| AI accuracy logging в onWorkSessionUpdate | Phase 1 — когда AI есть |

---

## 2. Data Model (Firestore schema for Phase 0)

```typescript
// functions/src/types/timeTracking.ts

export interface WorkSession {
  // ─── Identity ───
  id: string;                          // auto-generated doc ID
  tenantId: string;                    // NEW: multi-tenant (not in profit-step)
  employeeId: string | number;         // Firebase UID or Telegram ID
  employeeName: string;
  clientId: string;
  clientName: string;
  projectId?: string;
  projectName?: string;

  // ─── Lifecycle ───
  startTime: Timestamp;
  endTime?: Timestamp;
  status: 'active' | 'completed' | 'paused' | 'auto_closed';
  durationMinutes?: number;
  totalBreakMinutes?: number;
  lastBreakStart?: Timestamp;

  // ─── Financial ───
  hourlyRate?: number;                 // snapshot at session start (IMMUTABLE)
  sessionEarnings?: number;            // = (durationMinutes / 60) × hourlyRate

  // ─── Location (basic, no AI geofence) ───
  startLocation?: { lat: number; lng: number; accuracy?: number };
  endLocation?:   { lat: number; lng: number; accuracy?: number };
  locationDistanceMeters?: number;     // simple distance between start/end
  locationMismatch?: boolean;          // distance > 500m flag

  // ─── Photos (stored as files, NO AI matching in Phase 0) ───
  startPhotoId?: string;
  startPhotoUrl?: string;
  startPhotoSkipped?: boolean;
  startPhotoSkipReason?: string;
  endPhotoId?: string;
  endPhotoUrl?: string;
  endPhotoSkipped?: boolean;

  // ─── Breaks ───
  breaks?: Array<{ start: Timestamp; end?: Timestamp; durationMinutes?: number }>;

  // ─── Admin override ───
  stoppedByAdmin?: boolean;
  adminStopReason?: string;
  startedByAdmin?: boolean;
  adminStartReason?: string;

  // ─── Edit tracking ───
  isManuallyEdited?: boolean;
  editedAt?: Timestamp;
  editedBy?: string;
  editNote?: string;
  originalStartTime?: Timestamp;
  originalEndTime?: Timestamp;

  // ─── Session types ───
  type: 'regular' | 'correction' | 'manual_adjustment' | 'payment';
  isVoided?: boolean;
  voidReason?: string;
  relatedSessionId?: string;           // for corrections

  // ─── Finalization (48h immutable window) ───
  finalizationStatus?: 'pending' | 'finalized' | 'processed';
  finalizedAt?: Timestamp;
  autoClosed?: boolean;
  needsAdjustment?: boolean;

  // ─── Payroll link ───
  payrollPeriod?: string;              // "YYYY-MM"
  payrollEntryId?: string;
  processedAt?: Timestamp;

  // ─── Task link (optional) ───
  relatedTaskId?: string;
  relatedTaskTitle?: string;

  // ─── NO AI fields in Phase 0 ───
  // plannedTaskSummary, resultSummary, voiceStartUrl, voiceEndUrl,
  // aiTranscribedAt, faceConfidenceStart, etc. — ALL phase 1+
}

export interface PayrollPeriod {
  id: string;                          // "YYYY-MM"
  tenantId: string;
  status: 'open' | 'closed' | 'paid';
  startDate: Timestamp;
  endDate: Timestamp;
  totalSessions?: number;
  totalHours?: number;
  totalAmount?: number;
  employeeCount?: number;
  closedAt?: Timestamp;
  closedBy?: string;
  paidAt?: Timestamp;
  paidBy?: string;
}

export interface Worker {
  id: string;                          // Firebase UID
  tenantId: string;
  name: string;
  role: 'admin' | 'foreman' | 'worker' | 'driver';
  telegramId?: number;
  hourlyRate?: number;                 // current (snapshotted to sessions)
  crew?: string;                       // foreman's id
  activeSessionId?: string;            // pointer for fast lookup
  status: 'active' | 'inactive';
  createdAt: Timestamp;
}

export interface Client {
  id: string;
  tenantId: string;
  name: string;
  address?: string;
  geoFence?: { lat: number; lng: number; radiusMeters: number };
  status: 'active' | 'inactive';
  createdAt: Timestamp;
}
```

---

## 3. Backend API (Phase 0, no AI)

### Cloud Functions endpoints

```
POST /api/sessions/start
  body: { clientId, projectId?, location?, photo?, startTime? }
  returns: { sessionId, startTime, hourlyRate }
  rules: no active session for user, client exists in tenant

POST /api/sessions/stop
  body: { sessionId, location?, photo? }
  returns: { durationMinutes, earnings }
  triggers: update session, recalc total break time, write audit

POST /api/sessions/pause
  body: { sessionId }
  returns: { status: 'paused', breakStartedAt }

POST /api/sessions/resume
  body: { sessionId }
  returns: { status: 'active', breakDuration }

GET /api/sessions/active
  query: ?tenantId (from auth)
  returns: WorkSession[] (all currently active in tenant)

GET /api/sessions
  query: ?from=&to=&employeeId=&clientId=&status=
  returns: { sessions: WorkSession[], totals: {hours, earnings} }

PUT /api/sessions/:id  (admin only)
  body: { startTime?, endTime?, hourlyRate?, note? }
  rules: capture original values, audit trail, recalc earnings

POST /api/sessions/:id/admin-stop  (admin only)
  body: { reason }
  triggers: stop session, audit, notify worker (optional)

GET /api/payroll/periods?year=2026
  returns: PayrollPeriod[]

POST /api/payroll/periods/:id/close  (admin only)
  triggers: aggregate sessions, mark immutable

POST /api/payroll/periods/:id/pay  (admin only)
  triggers: mark as paid, create payment entries
```

### Scheduled (cron) functions

```
generateDailyPayroll       — 0 4 * * * (4 AM) — aggregate yesterday's sessions
finalizeExpiredSessions    — 0 1 * * * (1 AM) — mark 48h+ sessions immutable
autoStopStaleTimers        — every 30 min — force-stop sessions > 12h
sendSessionReminders       — every 2h — remind workers of long-running sessions
checkLongBreaks            — every 1h — auto-close breaks > 1h
autoCloseStaleSessions     — every 1h — transition active → auto_closed at 48h
```

**Все копируются из profit-step как есть.**

---

## 4. Telegram Bot (Phase 0 — keyboard only, NO AI)

```
/start
  → register worker: link telegram_id ↔ firebase_uid
  → show inline keyboard main menu

Main menu keyboard:
  🏁 Начать смену       → show client picker
  ⏸ Пауза / ▶️ Продолжить  → toggle break
  🏁 Завершить смену    → confirm dialog
  💰 Мой баланс         → show earnings summary
  📋 Мои смены          → list last 7 days
  🧾 Отправить чек      → upload photo + amount (NO OCR in Phase 0)

Session start flow:
  1. Tap "🏁 Начать смену"
  2. Inline keyboard: list of clients (from Firestore)
  3. Worker picks client
  4. Optional: send photo (saved to Storage, NO face match)
  5. Optional: send location (saved to doc, NO geofence AI)
  6. Confirm → session created, status='active'
  7. Bot replies: "✅ Смена начата на Acme. Таймер идёт."

Session stop flow:
  1. Tap "🏁 Завершить смену"
  2. Optional: send photo + location
  3. Confirm → session.status='completed', earnings calculated
  4. Bot replies: "✅ Смена 8.2ч · $369 · смотри /balance"

NO text parsing.
NO voice.
NO AI anywhere.
Just deterministic keyboard flows.
```

**Effort:** 5 days using `node-telegram-bot-api` + Firebase Admin SDK. Simpler than profit-step's 708-line dispatcher because we skip all AI.

---

## 5. Frontend (Phase 0)

### Web admin (MUI v7)

```
Pages:
- /login             (Firebase Auth)
- /dashboard         (KPIs + active sessions table)
- /sessions          (list, filters, edit, void)
- /sessions/:id      (detail view)
- /workers           (CRUD)
- /workers/:id       (profile + sessions history + balance)
- /clients           (CRUD)
- /clients/:id       (overview + sessions)
- /payroll/periods   (list, open/close/pay)
- /audit             (immutable log)

Components (port from profit-step):
- TimeTrackingTable  — sessions list with edit actions
- TimeTrackingFilters  — date range, employee, client, status
- EditSessionDialog   — admin edit with audit
- AdminStopSessionDialog  — force stop with reason
- PayrollPeriodCard   — open/close/pay actions
```

### Worker self-service (PWA)

```
Pages:
- /login             (Firebase Auth phone or email)
- /shift/active      (if active — timer + stop button)
- /shift/start       (if not — client picker + start button)
- /my/balance        (earnings, paid, outstanding)
- /my/shifts         (history)
- /my/expenses       (submit, list)
```

**Effort:** 7 days using React + MUI v7, reuse profit-step components.

---

## 6. Firestore Security Rules

```javascript
// Port from profit-step + add multi-tenant RLS

match /tenants/{tenantId}/work_sessions/{sessionId} {
  allow read: if isSignedIn() && userBelongsToTenant(tenantId);
  allow create: if isSignedIn() && userBelongsToTenant(tenantId);
  allow update: if isSignedIn() && (
    isOwnSession() ||                      // worker can update own active session
    isAdmin(tenantId)                      // admin can edit
  );
  allow delete: if false;                  // never delete, only void
}

match /tenants/{tenantId}/workers/{workerId} {
  allow read: if isSignedIn() && userBelongsToTenant(tenantId);
  allow create, update: if isAdmin(tenantId);
  allow delete: if false;                  // soft-delete via status='inactive'
}

match /tenants/{tenantId}/clients/{clientId} {
  allow read: if isSignedIn() && userBelongsToTenant(tenantId);
  allow create, update: if isAdmin(tenantId);
}

match /tenants/{tenantId}/payroll_periods/{periodId} {
  allow read: if isSignedIn() && userBelongsToTenant(tenantId);
  allow create, update: if isAdmin(tenantId);
  // Once closed, only Cloud Functions can modify
}
```

---

## 7. Testing Strategy (Phase 0)

### Unit tests (port from profit-step)

- `payroll.test.ts` — bucket formula, isReportableSession filter (port as-is)
- `timeTracking.test.ts` — session duration with breaks, rate snapshot
- `idempotency.test.ts` — payroll_runs doc prevents duplicate processing

### Integration tests (new for Phase 0)

- `session-lifecycle.test.ts` — start → pause → resume → stop → finalize
- `admin-edit.test.ts` — original values preserved, recalc earnings
- `multi-tenant.test.ts` — tenant A can't see tenant B sessions
- `auto-close.test.ts` — session stale > 48h → auto_closed
- `daily-payroll.test.ts` — aggregation is idempotent

### E2E (Cypress, critical flows only in Phase 0)

- Worker logs in → starts shift → pauses → stops
- Admin sees active session live
- Admin edits session, history visible
- Payroll period close → aggregates correctly

**Gate to Phase 1:** all tests green + 2 weeks real usage without data-loss incidents.

---

## 8. Deployment Plan (Phase 0 → prod)

### Week 4 end:
1. Create Firebase project `easytimercost-prod`
2. Deploy functions (dry-run in emulator first)
3. Deploy rules + indexes
4. Deploy hosting (admin + worker PWA)
5. Setup Telegram bot webhook
6. Create 1 test tenant ("Acme Construction")
7. Create 2-3 test workers, 2-3 test clients
8. Run smoke test: full session lifecycle end-to-end
9. Invite first real customer (beta) — Денис + 3-5 workers

### Week 5-6 (stabilization):
- Monitor Firebase Console daily
- Collect feedback via our _feedback.html UI
- Fix bugs (target: <2 day turnaround)
- Weekly review: are success metrics met?

---

## 9. Effort estimate (Phase 0 · total)

| Week | Focus | Days | Files produced |
|---|---|---|---|
| 1 | Data + Backend | 7 | ~15 files (types, services, APIs, scheduled) |
| 2 | Worker UI + Bot | 7 | ~10 files (PWA + bot handlers) |
| 3 | Admin UI | 7 | ~15 files (pages + dialogs + components) |
| 4 | Testing + Deploy | 7 | ~10 test files + deployment config |

**Total:** ~28 working days = 5-6 calendar weeks with review/iteration.

**Team:** 1 engineer full-time (или Claude Code + Денис).

**Cost:** ~$50-200/mo Firebase (emulator dev free, prod minimal).
**NO AI cost in Phase 0.** Saving is real.

---

## 10. Known adaptations from profit-step

### Multi-tenant isolation (NEW)
profit-step is single-tenant. We need multi-tenant RLS:
- All collections prefixed `tenants/{tenantId}/...`
- Firestore rules check `userBelongsToTenant(tenantId)`
- User doc has `tenantId` claim
- Firebase custom claims for roles per-tenant

### Currency flexibility (NEW)
profit-step = USD only. Add `tenant.currency` field (defaults USD).

### Branding per-tenant (NEW)
Admin UI shows tenant's company name/logo (not "profit-step").

### Remove construction-specific legacy
- Drop `siteDashboard/`, `estimator/`, `ElectricalEstimator*` (profit-step domain-specific)
- Keep time tracking generic: construction OR other labor-hourly work

---

## 11. Coupling concerns (what breaks if we don't)

### Payroll formula drift
profit-step has payroll formula **duplicated** in 2 places (`functions/src/modules/finance/services/payroll.ts` + `src/modules/finance/services/payroll.ts`). They must stay in sync or balances don't match between bot and UI.

**Our solution:** single file `functions/src/services/payroll.ts` + import in frontend via shared types package. OR keep both и mirror tests.

### Cross-platform ID resolution
profit-step supports Firebase UID + Telegram ID. Queries must handle both (`employeeId == uid || employeeId == tgId as number || employeeId == tgId as string`).

**Our solution:** copy this pattern as-is — it's necessary for telegram bot flow.

### Pointer pattern (user.activeSessionId)
profit-step uses pointer for fast active session lookup. **Must update atomically with session state** or you get phantom sessions.

**Our solution:** Firestore transaction (reads before writes, already in profit-step code).

### Void-as-correction (not delete)
profit-step never deletes sessions — creates `type: 'correction'` with negative earnings linked via `relatedSessionId`.

**Our solution:** preserve this pattern. Audit compliance requires it.

---

## 12. What's NOT in Phase 0 (deferred)

| Feature | Defer to |
|---|---|
| Receipt OCR | Phase 1 week 7 |
| Voice transcription | Phase 1 week 8 |
| Face match | Phase 1 week 10 |
| AI chat NLU | Phase 1 week 8 |
| Agent orchestration | Phase 1 week 11-12 |
| WhatsApp | Phase 2 |
| Workspace Marketplace | Phase 2 |
| Permits database | Phase 3 |
| Brand avatar videos | Phase 2 (Nano Banana 2) |
| BigQuery analytics | Phase 3 |

---

## 13. Success criteria for Phase 0

**Business:**
- 5+ real workers using daily
- 50+ completed sessions in week 4-6
- Admin approves 95%+ without disputes
- Zero data loss incidents
- Bug backlog < 5 at end of week 6

**Technical:**
- All tests green
- p95 API latency < 500ms
- Firestore cost < $20/mo at this scale
- Zero Cloud Function errors for 7 days straight

**UX:**
- Worker can start shift in < 30 seconds
- Admin can approve session in < 10 seconds
- Payroll period close runs in < 1 minute

**If all met:** ✅ Move to Phase 1 AI augmentation.
**If not:** ↻ Iterate Phase 0. Don't add AI to broken foundation.

---

## Next step

Once this doc is approved, `NEXT_SESSION.md` will be updated to reflect **Phase 0 Week 1 Day 1** as the starting point:

> **Day 1:** Create Firebase project · port `WorkSession` types · init Firestore collections with test data · deploy rules · smoke test emulator.

No A2A envelopes. No AI router. No Channel Router. Just working CRUD + auth + Firestore.

Build the foundation. AI will come when the foundation is solid.
