---
title: "07.5 AI Anomaly detection"
section: "07-ai"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# AI Anomaly detection

> Если actualDurationMinutes ≫ estimatedDurationMinutes на N задачах подряд для assignee — alert PM. Цель: catch проблемы рано (новый рабочий не справляется, задачи систематически недооцениваются, неисправный инструмент замедляет работу).

## Trigger

`onTaskUpdate` Cloud Function: когда задача меняет lifecycle на `completed`:

```typescript
if (after.lifecycle === 'completed' && before.lifecycle !== 'completed') {
  await checkAnomalyForAssignee(after.assignedTo.id);
}
```

## Алгоритм

1. Для assignee — query последние N задач (e.g. last 5) с `lifecycle in [completed, accepted]`
2. Для каждой — рассчитать ratio `actualDurationMinutes / estimatedDurationMinutes`
3. Если **N подряд** имеют ratio > threshold (e.g. 1.5x) → anomaly detected
4. Send notification PM:
   ```
   ⚠️ Anomaly: assignee Sergey
   Last 5 tasks all took 1.7x longer than estimated.
   Possible causes:
   - Estimates too aggressive
   - Worker needs training
   - Task complexity underestimated
   ```

## Параметры

- **N** — конфигурируемо per company (default 5)
- **Threshold ratio** — конфигурируемо (default 1.5)

Хранятся в `companies/{companyId}.settings.anomalyDetection`:

```typescript
interface AnomalyDetectionSettings {
  enabled: boolean;
  windowSize: number;      // N задач (default 5)
  thresholdRatio: number;  // ratio actual/estimated (default 1.5)
  notifyChannels: ('telegram' | 'email' | 'in-app')[];
}
```

## Что НЕ делаем

- **НЕ автоматически менять estimate'ы** — это требует human review (может быть систематическая ошибка estimating, может быть worker performance issue)
- **НЕ blame assignee** в notification — explicitly список possible causes, не «sergey is slow»
- **НЕ запускать чаще раз в час** для одного assignee — иначе spam (de-dup через `lastAnomalyAlertSentAt` на user)

## Suggested actions (в notification)

PM получает алерт + suggested actions:

1. **Review estimates** — открыть последние 5 задач, посмотреть пропорции
2. **Schedule 1-on-1 с воркером** — обсудить причины
3. **Adjust future estimates** — увеличить multiplier для этого worker'а
4. **Consider tools/training** — может, нужно training или новый инструмент

## UI

Notification в Inbox PM:
```
┌──────────────────────────────────────┐
│ ⚠️ Anomaly detected — Sergey          │
│                                       │
│ Last 5 completed tasks took 1.7x     │
│ longer than estimated:                │
│                                       │
│ 1. Demo bathroom: 8h vs 5h           │
│ 2. Plumbing rough: 6h vs 4h          │
│ 3. Drywall hang: 10h vs 6h           │
│ 4. Tile install: 14h vs 8h           │
│ 5. Finish trim: 5h vs 3h             │
│                                       │
│ [Open dashboard] [Mark resolved]     │
└──────────────────────────────────────┘
```

## Storage

Anomaly detection events пишутся в:

```typescript
// anomalyAlerts/{alertId}
interface AnomalyAlert {
  id: string;
  companyId: string;
  assigneeId: string;
  detectedAt: Timestamp;
  windowSize: number;
  thresholdRatio: number;
  taskIds: string[];          // tasks которые подпали под anomaly
  averageRatio: number;
  status: 'open' | 'resolved' | 'dismissed';
  notes?: string;             // PM может оставить заметку
}
```

## AI involvement

В будущем — Claude prompt для глубокой analysis:
> «Проанализируй эти 5 задач assignee Sergey, найди common patterns, suggest reason»

Возвращает structured insights. Но Phase 3 — без AI prompt'а, просто mechanical detection.

## Edge cases

- **Assignee новый (< 5 completed tasks)** — не алертить, нет baseline
- **Все 5 задач одного типа** — может, не worker issue, а systematic estimate issue для этого типа. Включить hint: «5 задач все типа `tile install` — возможно estimate template нужно update»
- **Один очень длинный task смещает average** — использовать median, не mean

---

**См. также:**
- [Integration overview](integration-overview.md)
- [Auto-shift](auto-shift.md) — связана фича (suggest disable autoShift)
- [Bonus/penalty cron](bonus-penalty-cron.md) — другая «automated payroll» категория
- [`../05-api/triggers.md`](../05-api/triggers.md) — onTaskUpdate trigger
