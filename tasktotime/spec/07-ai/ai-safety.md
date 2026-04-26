---
title: "07.7 AI safety"
section: "07-ai"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# AI Safety

> Все AI-flows должны быть **reversible** и **transparent**. AI может ошибаться (особенно `modifyTask` команды, `decomposeEstimate`); если applying silently — юзер не доверяет, не понимает что произошло. Эти правила — фундамент.

Из ТЗ §7.3.

## 4 правила безопасности

### 1. `aiAuditLogId` на каждом mutation

Каждое AI-вмешательство пишет запись в `aiAuditLogs/{id}`:

```typescript
interface AiAuditLog {
  id: string;
  companyId: string;
  taskId?: string;
  flow: 'generateTask' | 'confirmTask' | 'modifyTask' | 'estimateTask' | 'decomposeEstimate' | 'wikiAssist';
  model: 'claude-sonnet-4.7' | 'gemini-2.5-pro';
  promptTokens: number;
  completionTokens: number;
  cost: number;
  inputSummary: string;     // первые 200 chars input'а для debugging
  outputSummary: string;
  appliedAt?: Timestamp;
  appliedBy?: UserRef;
  undoneAt?: Timestamp;
  undoneBy?: UserRef;
  createdAt: Timestamp;
}
```

Поле `task.aiAuditLogId` — последняя AI-операция над этой task (для quick reference).

Полная история через query `aiAuditLogs where taskId == task.id`.

### 2. Preview/diff перед apply

Все AI-mutations имеют `dryRun: true` режим — возвращают proposed changes без apply:

```typescript
modifyTask({ taskId, command, dryRun: true })
  → { proposedChanges: Partial<Task>, summary: string, applied: false }
```

UI показывает diff (как Git diff):

```
Title:        "Demo bathroom" → "Demo bathroom + remove old tub"
Estimated:    480 min → 600 min
Materials:    +bathtub (qty: 1)
Dependencies: + dependsOn task-id-789 (FS, lag 0)

[Apply] [Cancel]
```

Юзер подтверждает → второй call с `dryRun: false` (или отдельный `confirmModify`).

### 3. Undo snackbar 4s после apply

После apply — snackbar внизу экрана:

```
┌────────────────────────────────────────────┐
│ ✓ AI добавил 3 материала и сместил дедлайн │
│                              [Undo] (4s)   │
└────────────────────────────────────────────┘
```

Click Undo:
- Calls `POST /api/tasktotime/tasks/:id/undo-ai { auditLogId }`
- Откатывает changes используя snapshot before
- Mark audit log as `undoneAt = now`

После 4 seconds — snackbar dismisses, undo unavailable through this UI.

Через `taskHistory` — можно открыть и сделать **manual undo** через permission'ы (если remained snapshot).

### 4. Rate limit: max 1 AI mutation на задачу за 60 секунд

Защита от:
- AI loops (если AI suggest другую AI mutation)
- Spam от юзера (multiple modify requests подряд)
- Cost explosions

Реализация:
```typescript
const recentAiMutation = await db.collection('aiAuditLogs')
  .where('taskId', '==', taskId)
  .where('appliedAt', '>', new Date(Date.now() - 60000))
  .limit(1)
  .get();

if (!recentAiMutation.empty) {
  throw new HttpsError('resource-exhausted', 'Rate limit: 1 AI mutation per task per 60 seconds');
}
```

## TaskHistoryTimeline AI events

В Detail page → tab «Контекст» → секция «История»:

```
┌─────────────────────────────────────────────┐
│ Apr 25, 19:30 — 🤖 AI modify                │
│ "added permit dependency, shifted +1d"       │
│ by AI (user: Denis)                         │
│ [Undo this action]                          │
├─────────────────────────────────────────────┤
│ Apr 25, 19:15 — 👤 Denis                    │
│ Created task                                │
└─────────────────────────────────────────────┘
```

Each AI event:
- Robot icon
- Reasoning (`changeSummary` from AI)
- Cost / model badge (для cost tracking)
- "Undo this action" button (если permission allows)

## Что НЕ безопасно

- ❌ Apply AI suggestions без preview
- ❌ Не писать audit log
- ❌ Не показывать что AI involved в change history
- ❌ Не давать undo
- ❌ Allow > 1 AI mutation/task/min без явного override

## Audit dashboard

Admin может открыть `/admin/ai-audit` для company-wide review:
- Total AI calls сегодня
- Cost breakdown по models
- Failed mutations
- Most-undone AI flows (sign of bad prompts)
- Error rate

## Cost monitoring

Каждая AI call — `cost` поле в audit log. Aggregate:

```typescript
SELECT SUM(cost), COUNT(*), flow
FROM aiAuditLogs
WHERE companyId = X AND createdAt > today
GROUP BY flow
```

Алерт PM если daily cost > $50 или per-task > $1.

## Backward compatibility

Existing AI flows (`generateAiTask`, `modifyAiTask`, `estimateTask`) уже имеют partial audit. Phase 5 — миграция всех на единый `aiAuditLogs` schema + добавление preview/undo для тех где нет.

---

**См. также:**
- [Integration overview](integration-overview.md)
- [Auto-fill](auto-fill.md) — uses these safety patterns
- [Decompose estimate](decompose-estimate.md) — uses these safety patterns
- [`../05-api/callables.md`](../05-api/callables.md) — все AI callables
- [`../06-ui-ux/principles.md`](../06-ui-ux/principles.md) — правило #4 «AI reversible»
