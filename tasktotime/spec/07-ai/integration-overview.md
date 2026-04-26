---
title: "07.1 AI integration overview"
section: "07-ai"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# AI Integration — overview

> Общий обзор всех AI flows в `tasktotime`. Какие callables, как взаимодействуют с задачами, где сохраняется audit. Существующие AI flows + новые AI features в `tasktotime`.

## Existing AI flow (наследуется из `gtd_tasks`)

- **`generateAiTask` (Claude Sonnet 4.7)** — пользователь даёт title/voice → AI пишет полные draft fields
- **`estimateTask` (Gemini 2.5 Pro)** — AI считает hours, cost, suggested materials, suggested tools
- **`modifyAiTask` (Claude Sonnet 4.7)** — inline edit команды («сдвинь на завтра», «assign Сергею»)
- **`parseSmartInput` (Smart Dispatcher)** — telegram voice → структурированные fields

Все они переезжают в `tasktotime/backend/ai/` без изменений семантики, но с обновлёнными именами:

| Старый | Новый |
|---|---|
| `generateAiTask` | `generateTask` (callable) |
| `confirmAiTask` | `confirmTask` (callable) |
| `modifyAiTask` | `modifyTask` (callable) |
| `estimateTask` | `estimateTask` (callable) |

## Новые AI features в v0.2

### 1. Auto-fill required fields

Если задача создаётся voice/email, AI должен заполнить:
- `assignedTo` — по контексту (упомянутые имена, или history кто делал похожие задачи)
- `location` — если упомянут адрес
- `priority` — по urgency markers («срочно», «вчера было нужно»)
- `estimatedDurationMinutes` — по template matching на похожие задачи
- `requiredHeadcount` — по типу работ
- `requiredTools` — suggested

См. подробно: [`auto-fill.md`](auto-fill.md)

### 2. Decompose estimate

`estimates/{id} → many tasks{}` с автоматическим bucket assignment, dependsOn graph (parallel vs sequential работы).

См. подробно: [`decompose-estimate.md`](decompose-estimate.md)

### 3. Auto-shift dependencies

Когда `Task A.completedAt` пишется, `Task B.plannedStartAt` автосдвигается если `B.dependsOn[A]` и `B.autoShiftEnabled`.

См. подробно: [`auto-shift.md`](auto-shift.md)

### 4. Anomaly detection

Если actualDurationMinutes ≫ estimatedDurationMinutes на N задачах подряд для assignee — alert PM.

См. подробно: [`anomaly-detection.md`](anomaly-detection.md)

### 5. Penalty/bonus auto-application

`overdueEscalation` cron: если `lifecycle === 'completed' && completedAt > dueAt && penaltyOverdue` — создать запись в payroll. Если `completedAt ≤ dueAt && bonusOnTime` — то же.

См. подробно: [`bonus-penalty-cron.md`](bonus-penalty-cron.md)

## AI features для wiki (NEW v0.2)

См.: [`../08-modules/wiki/ai-helper.md`](../08-modules/wiki/ai-helper.md)

- **«Дополни wiki»** — AI читает task fields + wiki + history → suggest дополнения
- **«Wiki из голоса»** — voice transcription с тегом `wiki` в Telegram → appends к wiki
- **«Generate wiki from estimate»** — при `confirmTask` если `wiki === null` AI создаёт draft

## Audit (общая для всех AI flows)

Все AI mutations пишут в коллекцию `aiAuditLogs/{id}`:

```typescript
interface AiAuditLog {
  id: string;
  companyId: string;
  taskId?: string;                // если касается task
  flow: 'generateTask' | 'confirmTask' | 'modifyTask' | 'estimateTask' | 'decomposeEstimate' | 'wikiAssist' | ...;
  model: 'claude-sonnet-4.7' | 'gemini-2.5-pro' | ...;
  promptTokens: number;
  completionTokens: number;
  cost: number;                   // в USD
  inputSummary: string;
  outputSummary: string;
  appliedAt?: Timestamp;          // если apply, не dryRun
  appliedBy?: UserRef;
  undoneAt?: Timestamp;           // если юзер откатил
  createdAt: Timestamp;
}
```

Поле `task.aiAuditLogId` — последняя AI-операция (для quick reference). Полная история через query `aiAuditLogs where taskId === task.id`.

## AI safety (общие правила)

См.: [`ai-safety.md`](ai-safety.md)

- Все AI-flows пишут `aiAuditLogId` в task
- Preview/diff перед apply
- Undo snackbar 4s после применения
- Limit: max 1 AI mutation на задачу за 60 секунд (rate limiter — защита от loop)

## Models (используемые)

| Model | Для чего | Region |
|---|---|---|
| Claude Sonnet 4.7 | Scope analysis, modify commands, decompose estimate, day plan | Anthropic API |
| Gemini 2.5 Pro | Cost/hours estimation (structured outputs) | Google AI API |
| Whisper (existing) | Voice transcription из Telegram | OpenAI API |

## Secrets

В `functions/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=...
OPENAI_API_KEY=sk-...
```

См.: CLAUDE.md §2.3 «Секреты» — никогда не коммитить.

---

**См. также:**
- [Auto-fill](auto-fill.md)
- [Decompose estimate](decompose-estimate.md)
- [Auto-shift](auto-shift.md)
- [Anomaly detection](anomaly-detection.md)
- [Bonus/penalty cron](bonus-penalty-cron.md)
- [AI safety](ai-safety.md)
- [`../05-api/callables.md`](../05-api/callables.md) — endpoint signatures для AI callables
