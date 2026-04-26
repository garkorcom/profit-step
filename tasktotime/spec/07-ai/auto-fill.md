---
title: "07.2 Auto-fill required fields"
section: "07-ai"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# AI Auto-fill required fields

> Если задача создаётся через voice/email, AI должен сам заполнить REQUIRED fields. Иначе worker получит «недоделанную» draft, которую руками доделывать. Цель: 80%+ задач из голоса должны попасть в `ready` без ручной правки.

## Какие поля auto-fill'ятся

| Поле | Как AI определяет | Fallback |
|---|---|---|
| `assignedTo` | По контексту: упомянутые имена в тексте; matching на history (кто делал похожие задачи) | PM который создал, или `unassigned` |
| `location` | Если упомянут адрес — geocode через Maps API; если упомянут проект — `project.location` | undefined |
| `priority` | Urgency markers: «срочно», «вчера», «as soon as possible» → `high` или `critical`. По умолчанию `medium` | `medium` |
| `estimatedDurationMinutes` | Template matching на похожие задачи (`similarTaskIds` от embedding) | 60 (default) |
| `requiredHeadcount` | По типу работ: «electric installation» → 1, «framing» → 2, «pour concrete» → 3-4 | 1 |
| `requiredTools` | По типу работ из tools knowledge base | пустой |
| `dueAt` | Если упомянуто («к пятнице», «следующий понедельник») — parse | `createdAt + 7 days` |

## Trigger

Эта auto-fill логика — часть callable `generateTask(input)`:

```typescript
// tasktotime/backend/ai/generateTask.ts

export async function generateTask(input: GenerateTaskInput): Promise<Task> {
  const { rawInput, source, context } = input;

  // 1. Claude analyzes raw input
  const analysis = await claude.analyze({
    prompt: `${SYSTEM_PROMPT}\n\nInput: ${rawInput}\nContext: ${JSON.stringify(context)}`,
    model: 'claude-sonnet-4.7'
  });

  // 2. Extract structured fields with high confidence
  const draft: Partial<Task> = {
    title: analysis.title,
    description: analysis.description,
    assignedTo: await resolveAssignee(analysis.suggestedAssignee, context),
    location: await resolveLocation(analysis.location, context),
    priority: analysis.priority,
    estimatedDurationMinutes: analysis.estimatedDuration,
    requiredHeadcount: analysis.headcount,
    requiredTools: analysis.tools,
    dueAt: analysis.dueAt || addDays(new Date(), 7),
    source,
    aiAuditLogId: await logAiAudit({ flow: 'generateTask', input: rawInput, output: analysis }),
    aiEstimateUsed: true,
    lifecycle: 'draft',
    bucket: 'inbox',
  };

  // 3. Create draft task
  return await db.collection('tasktotime_tasks').add(draft);
}
```

## Validation perspective

Несмотря на auto-fill, transition `draft → ready` всё ещё требует:
- `assignedTo` (NOT null)
- `dueAt` (NOT null)
- `estimatedDurationMinutes` (NOT null)

Если AI не смог определить — задача остаётся в `draft`, PM получает алерт «нужно дополнить» с hint полями.

## UI flow

```
Voice in Telegram
       ↓
Whisper transcription
       ↓
generateTask(rawInput)
       ↓
Task created в lifecycle=draft, bucket=inbox
       ↓
Bot отвечает: «Создал draft с такими полями: ...
              Подтвердить? [Yes/Edit/Cancel]»
       ↓
Юзер: [Yes]
       ↓
confirmTask(draftId, edits=null) → transition to ready
```

## Anti-patterns

- **НЕ заполнять silently** — всегда показывать что AI заполнил (через bot responses или UI)
- **НЕ применять без confirmation** для voice (короткое misunderstanding → плохо заполненная задача)
- **НЕ обходить validation** — даже AI-задача должна пройти все required fields validation

## Confidence threshold

Каждое поле AI заполняет с confidence score. Если score < threshold (e.g. 0.6):
- Поле остаётся undefined
- Task в drafts с пометкой «AI не уверен в `assignedTo`»

Цель: **точность важнее покрытия**. Лучше пустое поле чем неправильное.

## Edge cases

- **Воркер не существует в DB** — AI пытается match по имени; если не нашёл — поле undefined + warning «упомянут "Сергей", но не в team»
- **Адрес в США выглядит как «1234 Main St»** — geocode work; адрес «у Дворкина» — fail, оставить undefined
- **Нет похожих задач в history (новый клиент)** — estimate = default 60 min с low confidence

---

**См. также:**
- [Integration overview](integration-overview.md)
- [AI safety](ai-safety.md)
- [`../05-api/callables.md`](../05-api/callables.md) — `generateTask` signature
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — какие fields auto-fill'ятся
