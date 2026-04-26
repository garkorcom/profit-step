---
title: "05.2 Callables"
section: "05-api"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Callables (Cloud Functions)

> Firebase Callable functions для AI flows — отдельный layer от REST API. Используют Firestore SDK напрямую (не Express), быстрее и автоматически handle auth. Каждая использует Claude или Gemini.

## Список

```
generateTask(input)         — AI Claude scope analysis (из generateAiTask)
confirmTask(draftId, edits) — apply AI draft + audit
modifyTask(taskId, command) — AI inline edit
estimateTask(input)         — AI Gemini hours/cost estimator
decomposeEstimate(estId)    — Этап 2 SPEC: estimate → tasks (объединяет projectAutomation + clientJourneyTriggers)
generateDayPlan(userId)     — AI day planner
```

## Callable deep-dive

### `generateTask(input)`

**AI Claude scope analysis — превращает freeform input в Task draft.**

- **Region:** `us-central1`
- **Model:** Claude Sonnet 4.7 (через Anthropic SDK)
- **Input schema:**
  ```typescript
  {
    rawInput: string,           // freeform — voice transcription, email, manual text
    source: 'web' | 'telegram' | 'voice' | 'email',
    context?: {
      clientId?: string,
      projectId?: string,
      previousTaskIds?: string[]  // для AI memory of recent tasks
    }
  }
  ```
- **Output schema:** `{ draftId: string, draftFields: Partial<Task> }`
- **Side effects:** создаёт draft в `tasktotime_tasks` со `lifecycle: 'draft'`, `aiAuditLogId` populated
- **Secrets needed:** `ANTHROPIC_API_KEY`

### `confirmTask(draftId, edits)`

**Apply AI draft с edits + audit.**

- **Input:** `{ draftId: string, edits: Partial<Task>, transitionTo?: 'ready' }`
- **Output:** обновлённая Task
- **Side effect:** если `transitionTo === 'ready'` — также делает `transition` action

### `modifyTask(taskId, command)`

**AI inline edit команды («сдвинь на завтра», «assign Сергею», «добавь permit зависимость»).**

- **Region:** `us-central1`
- **Model:** Claude Sonnet 4.7
- **Input:** `{ taskId: string, command: string, dryRun?: boolean }`
- **Output:** `{ proposedChanges: Partial<Task>, summary: string, applied: boolean }`
- **Safety:** `dryRun: true` — preview only. Юзер подтверждает в UI. Иначе apply + write `aiAuditLogs/`
- **Rate limit:** max 1 mutation/60s на task (см. [`../07-ai/ai-safety.md`](../07-ai/ai-safety.md))

### `estimateTask(input)`

**AI Gemini hours/cost/materials/tools estimator.**

- **Region:** `us-central1`
- **Model:** Gemini 2.5 Pro (через Google AI SDK) — лучше для structured estimates
- **Input:**
  ```typescript
  {
    title: string,
    description?: string,
    location?: Location,
    materials?: TaskMaterial[],
    similarTaskIds?: string[]    // для AI learning из прошлых проектов
  }
  ```
- **Output:**
  ```typescript
  {
    estimatedDurationMinutes: number,
    confidence: number,            // 0..1
    suggestedMaterials: TaskMaterial[],
    suggestedTools: TaskTool[],
    suggestedHeadcount: number,
    estimatedCostInternal: Money,
    suggestedPriceClient: Money,
    explanation: string            // для UI display
  }
  ```
- **Secrets needed:** `GOOGLE_AI_API_KEY`

### `decomposeEstimate(estId)`

**Этап 2 SPEC: estimate → tasks с DAG зависимостей.**

Объединяет `projectAutomation` + `clientJourneyTriggers` (раньше были разные триггеры).

- **Region:** `us-central1`
- **Model:** Claude Sonnet 4.7
- **Input:** `{ estimateId: string, dryRun?: boolean }`
- **Output:**
  ```typescript
  {
    tasksCreated: Task[],          // root + subtasks
    dependencyGraph: TaskDependency[],
    totalEstimatedDuration: number,
    suggestedSchedule: Array<{ taskId, plannedStart, plannedEnd }>
  }
  ```
- **Side effects:** создаёт несколько Tasks (root + subtasks), `dependsOn[]` populated, `subtaskIds[]` populated parent'а
- **Idempotency:** через `sourceEstimateId` — если уже есть tasks с таким estimateId, возвращает existing (не дублирует)
- **Composite index:** `companyId + sourceEstimateId + isSubtask` (см. [`../04-storage/indexes.md`](../04-storage/indexes.md))

См. также: [`../07-ai/decompose-estimate.md`](../07-ai/decompose-estimate.md)

### `generateDayPlan(userId)`

**AI day planner.**

- **Region:** `us-central1`
- **Model:** Claude Sonnet 4.7
- **Input:** `{ userId: string, date?: Timestamp }` (default today)
- **Output:**
  ```typescript
  {
    suggestedSchedule: Array<{ taskId, suggestedStartTime, reasoning }>,
    summary: string,
    warnings: string[]              // e.g. «over-allocated 2h на сегодня»
  }
  ```
- **Cron:** запускается каждый день в 7am EST через `dayPlan` scheduled trigger (см. [`triggers.md`](triggers.md))

## Auth

Все callables — `context.auth.uid` обязателен. RLS check внутри функции через `userCompanyId(context.auth.uid)` matched с `task.companyId`.

## Error handling

Throw `HttpsError` стандартными codes:
- `unauthenticated` — нет auth
- `permission-denied` — RLS violation
- `invalid-argument` — bad input
- `not-found` — task/estimate не существует
- `failed-precondition` — invalid state (e.g. estimate уже decomposed)
- `resource-exhausted` — rate limit hit
- `internal` — AI API error

---

**См. также:**
- [REST endpoints](rest-endpoints.md) — отдельный layer для CRUD
- [Triggers](triggers.md) — Firestore + scheduled triggers
- [`../07-ai/integration-overview.md`](../07-ai/integration-overview.md) — общий обзор AI flows
- [`../07-ai/ai-safety.md`](../07-ai/ai-safety.md) — rate limits, audit, undo
- [`../07-ai/decompose-estimate.md`](../07-ai/decompose-estimate.md) — детали `decomposeEstimate`
