# Telegram Worker Bot — 50 Use Cases for Improvement

**Date:** 2026-04-10
**Context:** Full audit of onWorkerBotMessage.ts (2,813 lines) + research Workyard, Connecteam, Fieldwire, LogLoon, Procore, BusyBusy, ClockShark, CrewTracks
**Goal:** Максимально удобный бот для бригады 5-20 человек, стройка, Флорида

---

## Current Pain Points (from code audit)

| # | Problem | Impact |
|---|---------|--------|
| 1 | Clock-in = 6+ шагов (кнопка → локация → проект → чеклист × 3 → фото → голос) | Workers skip steps, send "skip" |
| 2 | Задачи НЕ привязаны к сессии (`relatedTaskId` never populated) | Нет связи "работал 3ч над задачей X" |
| 3 | Нет "Переключить проект" — нужно завершить + начать заново | 2 минуты вместо 5 секунд |
| 4 | Нет `/mybalance`, `/myhours`, `/mypay` — баланс только при закрытии смены | Работники постоянно спрашивают админа |
| 5 | Tasks показывает ВСЕ задачи, не фильтрует по текущему проекту | Нужно скроллить 50+ задач |
| 6 | End-of-day: требует локацию + фото + голос + текст = 4+ шага | Забывают, пропускают |
| 7 | Нет Quick Report ("нужны материалы", "проблема", "заблокирован") | Пишут в общий чат |
| 8 | Нет travel time между проектами | Теряются 30-60 мин/день |
| 9 | Нет smart defaults — каждый день спрашивает тот же проект | Раздражает |
| 10 | Фото среди дня не категоризируются (прогресс/проблема/чек) | Всё в одну кучу |

---

## 50 Use Cases — Grouped by Category

### A. QUICK START (Clock-In) — Cases 1-8

#### Case 1: One-Tap Start at Known Location
**Current:** 6+ steps
**Target:** 2 steps

```
Worker opens bot → sees:
┌────────────────────────────────┐
│ Good morning, Alex!            │
│ Start at Johnson House?        │
│                                │
│ [Start here] [Other project]   │
└────────────────────────────────┘
```

**Logic:** If worker started at same project yesterday AND it's within 1km of last known location → pre-suggest.

**Files:** `onWorkerBotMessage.ts` → new `suggestQuickStart()`, check `work_sessions` for previous day

---

#### Case 2: Voice Clock-In
**Current:** Not supported
**Target:** Worker sends voice "Starting work at Johnson" → bot auto-matches project, starts session

```
Worker: [voice] "Начинаю работу у Джонсона"
Bot: ✅ Смена начата: Johnson House
     ⏱ Таймер запущен
     [Stop] [Break] [Switch]
```

**Logic:** Route voice in idle state through AI with intent="CLOCK_IN", extract project name, fuzzy-match against clients.

---

#### Case 3: QR Code Clock-In (for managed sites)
**Current:** Not supported
**Target:** Scan QR on job site → auto start

Admin prints QR with deep link: `https://t.me/profitbot?start=clockin_CLIENTID`
Worker scans → bot starts session immediately.

---

#### Case 4: Skip Checklist for Repeat Visit
**Current:** 3 checklist questions every time
**Target:** Skip if same project + within 24h

```
First visit: Materials? Tools? Access? (3 questions)
Second visit same day: Skipped (auto-yes, logged)
```

---

#### Case 5: Deferred Photo
**Current:** Photo blocks clock-in
**Target:** Clock-in starts immediately, photo requested in background

```
Bot: ✅ Смена начата: Johnson House, 7:00 AM
     ⏱ Таймер запущен

     📸 When you have a moment, send a start photo.
     [Skip photo]
```

**Logic:** Set `awaitingDeferredStartPhoto: true`, timer already running. Don't block work.

---

#### Case 6: Location from Telegram Live Share
**Current:** One-time location required
**Target:** Accept Telegram's native "Share live location" as clock-in trigger

When worker shares live location for 1h → use first coordinate as start location, auto-match project.

---

#### Case 7: Foreman Batch Clock-In
**Current:** Each worker clocks in individually
**Target:** Foreman command: `/clockin team Johnson House`

```
Foreman: /clockin team Johnson House
Bot: Starting shift for your crew at Johnson House:
     ✅ Alex — started
     ✅ Ivan — started
     ⚠️ Sergei — no Telegram, notify manually
```

---

#### Case 8: Weather-Aware Start
**Current:** No weather context
**Target:** Show weather at start, auto-log conditions

```
Bot: ☀️ 85°F, Humidity 78%. UV Index: High
     Stay hydrated! Water breaks every 30 min.

     [Start shift] [Rain delay]
```

---

### B. TASK MANAGEMENT IN-SHIFT — Cases 9-20

#### Case 9: Auto-Show Project Tasks at Clock-In
**Current:** Tasks button shows ALL tasks
**Target:** After clock-in, show only THIS project's tasks

```
Bot: ✅ Смена начата: Johnson House

     📋 Your tasks today:
     1. [ ] Finish drywall bedroom 2
     2. [ ] Install outlets kitchen
     3. [ ] Paint hallway primer coat

     [Start task 1] [Start task 2] [Start task 3]
     [Add new task]
```

**Logic:** Query `gtd_tasks` where `clientId == session.clientId AND assigneeId == userId AND status IN ['next','in_progress']`

---

#### Case 10: Start Task = Link to Timer
**Current:** `relatedTaskId` never set
**Target:** Tapping "Start task" links task to current work session

```
Worker taps [Start task 1]
Bot: 🔨 Working on: Finish drywall bedroom 2
     ⏱ Timer linked to this task
     [Done] [Switch task] [Break]
```

**Update:** `work_sessions.relatedTaskId = taskId`, `work_sessions.relatedTaskTitle = title`

---

#### Case 11: Complete Task Mid-Shift
**Current:** Task completion separate from timer
**Target:** [Done] → photo proof → task marked complete → auto-suggest next

```
Worker taps [Done]
Bot: 📸 Send a photo of completed work (or skip)
Worker: [sends photo]
Bot: ✅ Task "Finish drywall" completed!
     📊 Time spent: 2h 15min

     Next task:
     [Start: Install outlets kitchen]
     [Start: Paint hallway]
     [Add new task]
```

---

#### Case 12: Switch Task Without Stopping Timer
**Current:** Must finish shift + restart
**Target:** [Switch task] keeps timer, changes task linkage

```
Worker taps [Switch task]
Bot: ⏱ Timer continues (2h 15min on drywall)

     Switch to:
     [Install outlets kitchen]
     [Paint hallway primer]
     [Other / New task]

Worker taps [Install outlets kitchen]
Bot: 🔄 Switched to: Install outlets kitchen
     Previous: Drywall bedroom 2 — 2h 15min logged
```

**Logic:** Close current task-session segment, open new one. Same work_session, but create `task_segments` sub-entries.

---

#### Case 13: Add Task via Voice During Work
**Current:** `/task` creates in Inbox, not linked to project
**Target:** Voice → AI creates task linked to current project

```
Worker: [voice] "Need to fix the trim around the door in kitchen"
Bot: 📋 New task created:
     "Fix trim around kitchen door"
     Project: Johnson House
     [Start now] [Add to today] [Later]
```

---

#### Case 14: Quick Task from Photo
**Current:** Mid-shift photos go to general storage
**Target:** Photo + category → creates task

```
Worker: [sends photo of cracked tile]
Bot: What is this?
     [Progress photo] [Problem → Create task] [Receipt] [Just save]

Worker taps [Problem → Create task]
Bot: 📋 Task created: "Fix — see photo"
     Project: Johnson House
     Priority: Normal
     [Edit title] [Assign to someone] [OK]
```

---

#### Case 15: Checklist Progress Tracking
**Current:** Checklists on tasks exist but hard to update from bot
**Target:** Inline checklist with tappable items

```
Bot: 📋 Drywall Bedroom 2:
     [✅] Hang boards
     [✅] Tape joints
     [ ] First mud coat
     [ ] Sand
     [ ] Second coat

     [Check: First mud coat] [All done]
```

---

#### Case 16: Task Time Estimate vs Actual
**Current:** AI estimates exist but not shown to worker
**Target:** Show remaining estimate

```
Bot: 🔨 Install outlets kitchen
     Estimated: 3h | Spent: 1h 45min | Left: ~1h 15min
     ████████░░░ 58%
```

---

#### Case 17: Blocked Task with Reason
**Current:** No quick "blocked" action
**Target:** One-tap block with reason picker

```
Worker taps [Blocked]
Bot: Why is it blocked?
     [Need materials] [Need help] [Waiting for other task]
     [Access problem] [Weather] [Other]

Worker taps [Need materials]
Bot: 🎤 Send voice or text: what materials?
Worker: [voice] "Need 50 feet of romex wire"
Bot: ⚠️ Task blocked: Need materials
     📦 Material request sent to admin:
     "50 feet of romex wire"
     [Unblock] [Switch task]
```

---

#### Case 18: Daily Task Queue / Priority Order
**Current:** Tasks unordered
**Target:** AI-suggested order based on dependencies and priority

```
Bot: 📋 Suggested order for today:
     1. 🔴 Fix leak (URGENT)
     2. 🟡 Finish drywall (due tomorrow)
     3. 🟢 Paint hallway (no deadline)

     [Start #1] [Rearrange]
```

---

#### Case 19: Task Delegation from Bot
**Current:** Delegation exists but buried in GTD menu
**Target:** Quick delegate during work

```
Worker: [long press task / tap delegate button]
Bot: Delegate to:
     [Alex (on site)] [Ivan (on site)] [Sergei (off)]

Worker taps [Alex]
Bot: ✅ Delegated "Paint hallway" to Alex
     Alex gets: "📋 New task from [Worker]: Paint hallway"
```

---

#### Case 20: Recurring Daily Tasks
**Current:** Recurring tasks generate at midnight
**Target:** Show "standing tasks" at clock-in

```
Bot: 📋 Daily tasks:
     [ ] Morning safety check
     [ ] Clean workspace end of day
     [ ] Tool inventory
     Plus 3 project tasks...
```

---

### C. SWITCH PROJECT / MULTI-SITE — Cases 21-25

#### Case 21: Switch Project Button
**Current:** Stop + Start = 12+ steps
**Target:** [Switch project] = 2 steps

```
Worker taps [Switch project]
Bot: Switching from Johnson House...

     Where to?
     [Smith Remodel] [Davis Kitchen] [Other]

Worker taps [Smith Remodel]
Bot: ✅ Johnson House: 3h 15min logged
     ✅ Smith Remodel: Started
     [Tasks] [Break] [Switch] [End day]
```

**Logic:** `autoFinishActiveSession()` + `initWorkSession()` in one flow, skip checklist/photo/voice

---

#### Case 22: Travel Time Between Sites
**Current:** Gap between sessions = lost time
**Target:** Auto-detect and offer to log

```
After switching:
Bot: 🚗 Travel time: 25 min
     [Log as travel] [Skip]

Worker taps [Log as travel]
Bot: ✅ 25 min logged as travel (Johnson → Smith)
```

---

#### Case 23: Day Timeline View
**Current:** Only current session info
**Target:** `/timeline` shows full day

```
Worker: /timeline
Bot: 📊 Today's Timeline:

     7:00-10:15  Johnson House     3h 15m  $113.75
       └─ Drywall bedroom 2
     10:15-10:40 🚗 Travel          25m
     10:40-now   Smith Remodel      2h 20m  $81.67
       └─ Paint living room

     ═══════════════════════════════
     Total: 5h 35m | Earned: $195.42
     Break: 30m (10:00-10:15)
```

---

#### Case 24: Multi-Project Summary at End of Day
**Current:** Summary shows only last session
**Target:** Full day summary across all projects

```
Bot: 🌙 Day Summary:

     Johnson House:     3h 15m    $113.75
     Smith Remodel:     4h 30m    $157.50
     Travel:            25m
     ─────────────────────────────
     Total:            8h 10m     $271.25
     Breaks:           45m

     [Confirm & close day] [Edit]
```

---

#### Case 25: Foreman Crew Map
**Current:** No real-time crew view
**Target:** `/crew` shows who's where

```
Foreman: /crew
Bot: 👷 Crew Status:

     📍 Johnson House (2):
       Alex — working 3h (drywall)
       Ivan — break since 10:30

     📍 Smith Remodel (1):
       Dmitry — working 1h (painting)

     ⚫ Not clocked in:
       Sergei, Nikolai

     [Message all] [Message Johnson crew]
```

---

### D. SELF-SERVICE COMMANDS — Cases 26-30

#### Case 26: /mybalance — YTD Salary Balance
**Current:** Only shown at end of shift
**Target:** Available anytime

```
Worker: /mybalance
Bot: 💰 Balance: Alex

     Earned (YTD):    $12,450.00
     Paid (YTD):      $10,800.00
     ─────────────────────────────
     Balance due:      $1,650.00

     Last payment: $2,400 on Mar 28 (Cash)

     📦 PO Balance: $150.00 (1 open advance)
```

---

#### Case 27: /myhours — Hours This Week
**Current:** Not available
**Target:** Weekly hours with daily breakdown

```
Worker: /myhours
Bot: ⏱ Hours This Week: Alex

     Mon:  8h 15m  Johnson House
     Tue:  7h 30m  Johnson House
     Wed:  8h 00m  Smith Remodel
     Thu:  6h 45m  Smith + Johnson
     Fri:  (today) 3h 20m so far
     ─────────────────────────────
     Week total: 33h 50m
     Remaining to 40h: 6h 10m
```

---

#### Case 28: /mypay — Last Period Pay Stub
**Current:** Not available
**Target:** Text pay stub in bot

```
Worker: /mypay
Bot: 📃 Pay Stub: March 2026

     EARNINGS:
     Johnson House  85.5h × $35  $2,992.50
     Smith Remodel  42.0h × $35  $1,470.00
     ─────────────────────────────
     GROSS PAY:                   $4,462.50

     DEDUCTIONS:
     PO advance repayment          -$150.00
     ─────────────────────────────
     NET PAY:                     $4,312.50

     PAYMENTS:
     Mar 15 (Cash)                $2,000.00
     Mar 28 (Zelle)               $2,000.00
     ─────────────────────────────
     BALANCE:                       $312.50
```

---

#### Case 29: /mypo — Advance Balance
**Current:** PO info only at shift end
**Target:** Detailed advance view

```
Worker: /mypo
Bot: 📦 Your Advances:

     1. "Materials for Johnson" — $500
        Spent: $350 (3 receipts)
        Remaining: $150
        [Add expense] [Return cash]

     No other open advances.
```

---

#### Case 30: /schedule — My Week Schedule
**Current:** Not available
**Target:** Show assigned tasks/projects for the week

```
Worker: /schedule
Bot: 📅 Your Week:

     Mon: Johnson House — Drywall
     Tue: Johnson House — Drywall + Electrical
     Wed: Smith Remodel — Painting
     Thu: Smith Remodel — Painting
     Fri: Johnson House — Cleanup

     Source: Foreman assigned
```

---

### E. END OF DAY — Cases 31-36

#### Case 31: One-Tap End Day (Auto-Summary)
**Current:** Location + Photo + Voice + Text = 4+ steps
**Target:** [End day] → auto-summary → confirm

```
Worker taps [End day]
Bot: 🌙 End of Day Summary:

     Johnson House: 4h 15m, 2 tasks done
     Smith Remodel: 3h 45m, 1 task done
     Total: 8h 00m | Earned: $280.00
     Photos: 5 | Problems: 0

     [Confirm & go home] [Add notes (voice)]
```

---

#### Case 32: End Day with Voice Notes Only
**Current:** Requires location + photo + voice + text
**Target:** Skip location/photo, just voice summary

```
Worker taps [End day]
Bot: 🎤 Quick voice summary of your day?
Worker: [voice] "Finished drywall, tomorrow need to sand and paint"
Bot: ✅ Day closed. See you tomorrow!
     Earned today: $280.00
```

---

#### Case 33: Forgot to Clock Out (Smart Auto-Close)
**Current:** 12h warning, then auto-close by cron at 1 AM
**Target:** Smart prompt at typical end time

```
At 5:30 PM (worker usually leaves at 5):
Bot: 🕔 Still working, Alex?
     You started at 7:00 AM (10h 30m ago)

     [End shift now] [Still working] [End at 5:00 PM]
```

---

#### Case 34: Tomorrow Planning at End of Day
**Current:** Not prompted
**Target:** AI suggests tomorrow's plan

```
After confirming end of day:
Bot: 📋 Tomorrow at Johnson House:
     1. Sand drywall bedroom 2
     2. Second mud coat
     3. Prime hallway

     [Looks good] [Edit plan]
```

---

#### Case 35: Daily Photo Report
**Current:** Photos stored but no compilation
**Target:** Auto-compiled photo report

```
Bot: 📸 Today's Photos:
     [Photo 1] 7:05 — Start (selfie)
     [Photo 2] 9:30 — Drywall progress
     [Photo 3] 11:00 — Problem: cracked beam
     [Photo 4] 14:00 — Drywall finished
     [Photo 5] 17:00 — End result

     Sent to admin as daily report.
```

---

#### Case 36: Weekly Summary (Auto Friday)
**Current:** weeklyTaskSummary exists for tasks but not payroll
**Target:** Combined weekly digest

```
Friday 5 PM:
Bot: 📊 Week Summary: Alex

     Hours: 38h 45m (Mon-Fri)
     Earned: $1,356.25
     Tasks completed: 8
     Projects: Johnson House, Smith Remodel

     [View details] [See next week plan]
```

---

### F. QUICK REPORTING — Cases 37-42

#### Case 37: Quick Report Menu
**Current:** Not available
**Target:** Persistent [Report] button

```
Worker taps [Report]
Bot: What's happening?
     [Need materials] [Problem found]
     [Task blocked] [Safety issue]
     [Running late] [Need help]
```

---

#### Case 38: Material Request via Voice
**Current:** Shopping list separate, not linked to project
**Target:** "Need materials" → voice → parsed list → routed

```
Worker: [voice] "Need 20 sheets of drywall and 5 bags of joint compound"
Bot: 📦 Material Request:
     - 20x Drywall sheets
     - 5x Joint compound bags
     Project: Johnson House

     [Send to admin] [Edit] [Add to shopping list]
```

---

#### Case 39: Problem Report with Photo
**Current:** Photo goes to general storage
**Target:** Problem → Photo → auto-task

```
Worker taps [Problem found]
Bot: 📸 Send a photo of the problem
Worker: [sends photo of water damage]
Bot: 🎤 Describe the problem (voice or text)
Worker: [voice] "Water leaking from upstairs bathroom"
Bot: ⚠️ Problem reported:
     "Water leak from upstairs bathroom"
     📸 Photo attached
     Priority: HIGH (water damage)

     Admin notified immediately.
     Task created: "Fix water leak — Johnson House"
```

---

#### Case 40: Safety Issue (Immediate Escalation)
**Current:** No safety flow
**Target:** Safety → instant admin alert

```
Worker taps [Safety issue]
Bot: ⚠️ SAFETY REPORT

     [Injury/Near miss] [Hazard found]
     [Equipment failure] [Weather danger]

Worker taps [Hazard found]
Bot: 📸 Photo + 🎤 Voice: describe the hazard
Worker: [photo + voice] "Exposed wiring in basement near water pipe"
Bot: 🚨 Safety hazard reported!
     Admin notified IMMEDIATELY.
     All crew at Johnson House alerted.

     DO NOT proceed until cleared.
```

---

#### Case 41: Running Late Notification
**Current:** No way to notify
**Target:** One-tap

```
Worker taps [Running late]
Bot: What time will you arrive?
     [15 min late] [30 min late] [1 hour late] [Custom]

Worker taps [30 min late]
Bot: ✅ Foreman notified: Alex arriving 30 min late
```

---

#### Case 42: Equipment/Tool Request
**Current:** Not supported
**Target:** Quick request

```
Worker taps [Need help]
Bot: What do you need?
     [Extra person] [Tool/equipment] [Delivery] [Supervision]

Worker taps [Tool/equipment]
Bot: 🎤 What tool do you need?
Worker: "A tile saw"
Bot: ✅ Request sent: Tile saw for Johnson House
     Admin will respond shortly.
```

---

### G. BOT UX & CONVENIENCE — Cases 43-50

#### Case 43: Smart Main Menu (Context-Aware)
**Current:** Static keyboard layout
**Target:** Dynamic based on state + time of day

```
Morning (no active session):
     [Start at Johnson House]    ← smart default
     [Other project] [Schedule]

Working:
     [Done with task] [Break]
     [Switch task] [Report]
     [End day]

After 5 PM still working:
     [End day now]               ← prominent
     [Still working]
     [Status]
```

---

#### Case 44: Unified Voice Dispatcher
**Current:** Voice handling varies by state
**Target:** Voice works in ANY state, AI routes

```
Idle + voice "Starting at Johnson" → Clock in
Working + voice "Finished drywall" → Complete task
Working + voice "Need 10 bags of cement" → Material request
Working + voice "Stopping for the day" → End shift
Any + voice "How much have I earned?" → Balance query
```

---

#### Case 45: Photo Categories After Upload
**Current:** All photos = generic
**Target:** Categorize after upload

```
Worker sends photo during shift:
Bot: Photo saved! What is it?
     [Progress] [Problem] [Receipt]
     [Before] [After] [Just save]
```

---

#### Case 46: Emoji Status in Group Chat
**Current:** Admin notifications only
**Target:** Worker status visible to team

```
Group chat auto-update:
🟢 Alex — Johnson House (3h)
🟡 Ivan — Break (Johnson)
🔴 Sergei — Not clocked in
🟢 Dmitry — Smith Remodel (1h)
```

---

#### Case 47: Undo Last Action
**Current:** No undo
**Target:** 30-second undo window

```
Worker accidentally taps [End day]:
Bot: Day ended. Earned: $280.
     [UNDO — made a mistake] (30 sec)
```

---

#### Case 48: Multi-Language Support
**Current:** Mix of Russian + English
**Target:** Auto-detect or `/lang en|ru|es`

Construction crews in FL often have Spanish-speaking workers.

```
Worker: /lang es
Bot: Idioma cambiado a Español
     [Iniciar turno] [Mi estado]
```

---

#### Case 49: Offline Resilience Guidance
**Current:** Skip buttons exist but no explanation
**Target:** Smart connectivity detection + guidance

```
When bot response is slow:
Bot: 📶 Slow connection detected.
     Your data is saved locally.
     Photos will upload when signal improves.

     [Lightweight mode ON]
```

Lightweight mode: no AI transcription, no photo verification, text-only responses.

---

#### Case 50: Onboarding Tutorial for New Worker
**Current:** `/help` shows text
**Target:** Interactive walkthrough on first login

```
New worker registers:
Bot: Welcome Alex! Let me show you how this works.

     Step 1/4: Starting your shift
     [Try it now — demo mode]

     Step 2/4: Taking breaks
     Step 3/4: Completing tasks
     Step 4/4: Ending your day

     [Skip tutorial]
```

---

## Implementation Priority

| Phase | Cases | Effort | Impact |
|-------|-------|--------|--------|
| **Phase 1: Quick Wins** | 1, 5, 9, 10, 21, 26-28, 31, 43 | 3-4 days | Huge — daily pain removed |
| **Phase 2: Task Flow** | 11-13, 15, 17, 18, 32, 44 | 3-4 days | Core workflow improved |
| **Phase 3: Multi-Site** | 22-24, 33, 34, 36, 45 | 2-3 days | Multi-project support |
| **Phase 4: Reporting** | 37-42, 46, 47 | 2-3 days | Safety + communication |
| **Phase 5: Polish** | 2-4, 6-8, 14, 16, 19, 20, 25, 29-30, 35, 48-50 | 5+ days | Full coverage |

### Phase 1 (Start Here):
1. **Case 1** — Smart quick-start (remember last project)
2. **Case 9** — Auto-show project tasks at clock-in
3. **Case 10** — Link task to work session timer
4. **Case 21** — Switch project button (no stop/start)
5. **Case 26-28** — `/mybalance`, `/myhours`, `/mypay`
6. **Case 31** — One-tap end day with auto-summary
7. **Case 43** — Context-aware main menu
