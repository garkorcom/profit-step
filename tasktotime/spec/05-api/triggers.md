---
title: "05.3 Triggers (Cloud Functions)"
section: "05-api"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Triggers (Cloud Functions)

> Firestore + scheduled triggers с обязательными idempotency guards. Каждый trigger описан со своим source collection, type (onCreate/onUpdate/scheduled), что читает, что пишет, и infinite-loop guards. **Критично:** один неправильный onUpdate trigger без guard = $10,000+ billing bomb за пару дней (CLAUDE.md §2.1).

## Полный список

```
onTaskCreate    — notification + send Telegram + write transition log
onTaskUpdate    — audit (only watched fields), cascade auto-shift dependent tasks
onTaskTransition— side effects per action (start → notify, complete → unblock blocked-by-this, accept → archive eventually)
onWorkSessionCompleted — agg actuals (вынести из clientJourneyTriggers — это task-domain trigger)
onWikiUpdate    — NEW v0.2 — version snapshot + parent rollup invalidation
recomputeCriticalPath — NEW v0.2 — pubsub triggered, CPM batch для project
deadlineReminders — hourly cron
overdueEscalation — NEW: penalty/bonus auto-apply
dayPlan         — 7am EST cron
```

## Idempotency rules (обязательно для всех)

CLAUDE.md §2.1:

- **`processedEvents/{eventId}`** для cross-trigger dedup
- **`metricsProcessedAt`** маркер на сессии для агрегации
- **`before === after`** early return в onUpdate

Без этих — risk infinite loop. **Тестировать в emulator** перед деплоем.

## Trigger deep-dive

### `onTaskCreate`

- **Source:** `tasktotime_tasks/{taskId}` onCreate
- **Reads:** new task data
- **Writes:**
  - Notification через Telegram bot — assignee и reviewer
  - `tasktotime_transitions/` — initial entry `{ from: null, to: 'draft' or 'ready', action: 'create' }`
  - Если `parentTaskId` → update parent's `subtaskIds[]` через `arrayUnion`, и `isSubtask: true` на child
- **Idempotency:** `processedEvents/${taskId}_create` 5-min TTL

### `onTaskUpdate`

- **Source:** `tasktotime_tasks/{taskId}` onUpdate
- **Reads:** before + after data
- **Writes (conditionally — based on what changed):**
  - **Watched fields only:** `lifecycle`, `dueAt`, `actualEndAt`, `assignedTo`, `dependsOn`, `wiki.contentMd`, `parentTaskId`
  - Если `lifecycle` изменился → write to `tasktotime_transitions/`
  - Если `actualEndAt` или `completedAt` изменился → cascade auto-shift dependent tasks (см. [`../08-modules/graph-dependencies/auto-shift-cascade.md`](../08-modules/graph-dependencies/auto-shift-cascade.md))
  - Если `dependsOn` изменился → update reverse `blocksTaskIds[]` для каждого target
  - Если any subtask changed → recompute `parent.subtaskRollup` (transaction)
  - Если `parentTaskId` изменился → update old parent's `subtaskIds[]` (remove), new parent's (add)
- **Critical guard:** `if (deepEqual(before, after)) return null;` — early return если ничего не поменялось
- **Critical guard:** список watched fields — НЕ ре-агировать на изменения computed полей (`subtaskRollup`, `isCriticalPath`) — иначе бесконечный loop

### `onTaskTransition`

- **Source:** `tasktotime_transitions/{transitionId}` onCreate (отдельная collection — append-only)
- **Reads:** transition entry + related task
- **Writes:**
  - **`action === 'start'`:** notify reviewer, suggest add to «активные сейчас» dashboard
  - **`action === 'complete'`:**
    - Aggregate actuals: read all `work_sessions` where `relatedTaskId`, sum minutes → `task.actualDurationMinutes`
    - Cascade unblock: задачи где `dependsOn` includes this task получают check «ready to start?»
    - Suggest parent rollup transition (если все subtasks completed)
  - **`action === 'accept'`:**
    - Trigger payroll calc: если `completedAt ≤ dueAt && bonusOnTime` → создать payroll entry. Если `completedAt > dueAt && penaltyOverdue` → то же.
    - После N дней (TBD) — trigger archive (`bucket = 'archive'`, `archivedAt = now`)
  - **`action === 'cancel'`:** cascade warning «зависимость отменена» dependent task'ам
- **Idempotency:** `processedEvents/${transitionId}_processed` (transitionId уникальный)

### `onWorkSessionCompleted`

**Вытащить из `clientJourneyTriggers`** — это task-domain trigger.

- **Source:** `work_sessions/{sessionId}` onUpdate где `before.completedAt === null && after.completedAt !== null`
- **Reads:** session.relatedTaskId
- **Writes:**
  - Increment `task.actualDurationMinutes` += `session.durationMinutes`
  - Increment `task.totalEarnings` += (session.durationMinutes / 60) * task.hourlyRate (или user.hourlyRate)
- **Guard:** `if (after.metricsProcessedAt) return null;`. Set `metricsProcessedAt = now` после агрегации.

### `onWikiUpdate` (NEW v0.2)

- **Source:** `tasktotime_tasks/{taskId}` onUpdate где `wiki.contentMd` или `wiki.attachments` изменился
- **Reads:** before.wiki, after.wiki
- **Writes:**
  - Если `versionHistory.length >= 10` → append last version to `tasktotime_tasks/{taskId}/wiki_history/{versionId}` subcollection
  - Reset `versionHistory[]` (keep last 10 inline)
  - Increment `wiki.version`
  - Если subtask с `wikiInheritsFromParent: true` — invalidate parent rollup cache (если есть)
- **Guard:** `if (before.wiki?.contentMd === after.wiki?.contentMd) return null;`

См.: [`../08-modules/wiki/storage.md`](../08-modules/wiki/storage.md)

### `recomputeCriticalPath` (NEW v0.2)

- **Source:** Pub/Sub topic `recomputeCriticalPath`
- **Trigger:** publish from `onTaskUpdate` когда `dependsOn`, `estimatedDurationMinutes`, `plannedStartAt` поменялись на любой задаче проекта
- **Reads:** все задачи проекта (`projectId`)
- **Writes:** updates `task.isCriticalPath` и `task.slackMinutes` для всех задач проекта (CPM forward + backward pass)
- **Performance target:** < 200ms для 100 задач, < 2s для 1000
- **Debounce:** 5 sec — не запускать чаще чем раз в 5 секунд per project
- **Guard:** check published timestamp; если последний run < 5 sec назад — skip

См.: [`../08-modules/graph-dependencies/computed-fields.md`](../08-modules/graph-dependencies/computed-fields.md)

## Scheduled triggers (cron)

### `deadlineReminders`

- **Schedule:** every hour (`0 * * * *`)
- **Reads:** все tasks где `lifecycle in [ready, started, blocked] && dueAt < now + 24h`
- **Writes:** notification через Telegram + email assignee'у. Update `task.lastReminderSentAt`
- **Guard:** не отправлять если `lastReminderSentAt > now - 24h` (max 1 reminder/24h)

### `overdueEscalation` (NEW)

- **Schedule:** every hour (`30 * * * *`)
- **Reads:** все tasks где `lifecycle === 'completed' && completedAt && (bonusOnTime || penaltyOverdue)`
- **Writes:** payroll entries для bonus/penalty (если ещё не записано)
- **Guard:** check `payrollProcessedAt` маркер на task

См.: [`../07-ai/bonus-penalty-cron.md`](../07-ai/bonus-penalty-cron.md)

### `dayPlan`

- **Schedule:** 7am EST daily (`0 7 * * *` с TZ)
- **Reads:** для каждого active user — его tasks
- **Writes:** вызывает callable `generateDayPlan(userId)`, рассылает morning summary через Telegram

## Cross-trigger guards таблица

| Guard type | Где используется |
|---|---|
| `processedEvents/{eventId}` | onTaskCreate, onTaskTransition |
| `before === after` early return | onTaskUpdate, onWikiUpdate |
| `metricsProcessedAt` маркер | onWorkSessionCompleted |
| `lastReminderSentAt > now - 24h` | deadlineReminders |
| `payrollProcessedAt` маркер | overdueEscalation |
| Pub/Sub debounce 5s | recomputeCriticalPath |

---

**См. также:**
- [REST endpoints](rest-endpoints.md) — какие endpoints запускают какие triggers
- [Callables](callables.md) — отдельный layer для AI flows
- [Backwards compat](backwards-compat.md) — proxy /api/gtd-tasks/*
- [`../08-modules/graph-dependencies/auto-shift-cascade.md`](../08-modules/graph-dependencies/auto-shift-cascade.md) — детали cascade
- [`../08-modules/hierarchy/auto-rollup.md`](../08-modules/hierarchy/auto-rollup.md) — детали rollup
- [`../08-modules/wiki/storage.md`](../08-modules/wiki/storage.md) — детали wiki version history
