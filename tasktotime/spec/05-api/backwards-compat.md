---
title: "05.4 Backwards compat — /api/gtd-tasks/* proxy"
section: "05-api"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Backwards compat: `/api/gtd-tasks/*` proxy

> Старый API префикс `/api/gtd-tasks/*` остаётся работающим до Phase 6. Внутренне делает proxy/translate в новый `/api/tasktotime/*`. Это нужно для внешнего AI бота `@crmapiprofit_bot` (см. CLAUDE.md §4 риск #2). После согласования с внешним разработчиком — выпиливаем.

## Зачем нужен proxy

CLAUDE.md §4 «Живые риски» #2:
> AI-бот `@crmapiprofit_bot` — prompt переписан с анти-галлюцинационными guardrails, prompt на стороне внешнего разработчика не обновлён, бот галлюцинирует клиентам.

Бот вызывает endpoints `/api/gtd-tasks/*` напрямую — если мы их сломаем, бот **полностью перестанет работать**. Поэтому proxy.

## Маппинг endpoints

| Старый endpoint | Новый endpoint | Преобразование |
|---|---|---|
| `POST /api/gtd-tasks` | `POST /api/tasktotime/tasks` | rename полей: `status → lifecycle` (см. drift mapping) |
| `GET /api/gtd-tasks` | `GET /api/tasktotime/tasks` | те же query params, но `status` → `lifecycle` |
| `GET /api/gtd-tasks/:id` | `GET /api/tasktotime/tasks/:id` | response: rename `lifecycle → status` обратно |
| `PATCH /api/gtd-tasks/:id` | `PATCH /api/tasktotime/tasks/:id` | + если `status` в body → роутим на `/transition` endpoint |
| `DELETE /api/gtd-tasks/:id` | `DELETE /api/tasktotime/tasks/:id` | identity |
| `POST /api/gtd-tasks/:id/start` | `POST /api/tasktotime/tasks/:id/transition { action: 'start' }` | rewrite |
| `POST /api/gtd-tasks/:id/complete` | `POST /api/tasktotime/tasks/:id/transition { action: 'complete' }` | rewrite |

## Implementation

```typescript
// functions/src/agent/routes/gtdTasksProxy.ts

import { Router } from 'express';
const router = Router();

// Forward POST → /api/tasktotime/tasks с status → lifecycle mapping
router.post('/', async (req, res) => {
  const body = translateOldToNew(req.body);
  const result = await taskstotimeApi.createTask(body, req.auth);
  res.json(translateNewToOld(result));
});

router.get('/:id', async (req, res) => {
  const task = await tasktotimeApi.getTask(req.params.id, req.auth);
  res.json(translateNewToOld(task));
});

// Add status field handling — if PATCH includes status, route to transition
router.patch('/:id', async (req, res) => {
  const { status, ...rest } = req.body;

  if (status !== undefined) {
    const action = mapStatusToAction(status);  // 'started' → 'start', 'completed' → 'complete'
    await tasktotimeApi.transitionTask(req.params.id, { action }, req.auth);
  }

  if (Object.keys(rest).length > 0) {
    await tasktotimeApi.patchTask(req.params.id, translateOldToNew(rest), req.auth);
  }

  const updated = await tasktotimeApi.getTask(req.params.id, req.auth);
  res.json(translateNewToOld(updated));
});

export const gtdTasksProxy = router;
```

## Translation functions

```typescript
function translateOldToNew(oldData: any): any {
  return {
    ...oldData,
    lifecycle: STATUS_DRIFT_MAP[oldData.status] ?? oldData.status,
    history: oldData.taskHistory,         // taskHistory → history
    // не передаём поля которые DROP'нули (zone, isMilestone, ganttColor, etc.)
    status: undefined,
    taskHistory: undefined,
  };
}

function translateNewToOld(newTask: Task): any {
  return {
    ...newTask,
    status: NEW_TO_OLD_LIFECYCLE_MAP[newTask.lifecycle] ?? newTask.lifecycle,
    taskHistory: newTask.history,
    isMilestone: newTask.category === 'inspection' || newTask.category === 'permit',
    // computed fields НЕ выдаём в old API чтобы не путать
  };
}

const STATUS_DRIFT_MAP = {
  'todo': 'ready',
  'in_progress': 'started',
  'pending': 'ready',
  'next': 'ready',
  'scheduled': 'ready',
  'approved': 'accepted',
  // remainings — identity
};
```

## Coordination со внешним разработчиком

**Денис должен:**
1. Написать внешнему разработчику `@crmapiprofit_bot` после Phase 4
2. Дать timeline для миграции его prompt'а на новый `/api/tasktotime/*` endpoint
3. После подтверждения — Phase 6 cutover, выпиливаем proxy

**До тех пор:** proxy остаётся работающим. Логируем ВСЕ запросы к `/api/gtd-tasks/*` чтобы видеть кто реально использует (возможно, не только бот).

## Cutover (Phase 6)

```typescript
// functions/src/agent/routes/gtdTasksProxy.ts

router.use((req, res, next) => {
  // Log every call для финальной верификации
  console.warn(`[DEPRECATED] ${req.method} ${req.path} from ${req.headers['user-agent']}`);
  // После 7 дней без вызовов — выпилить роуты
  next();
});
```

После 7 дней с zero вызовов — удалить файл `gtdTasksProxy.ts`, убрать `app.use('/api/gtd-tasks', gtdTasksProxy)` из main.

## Open question

Кто координирует со внешним разработчиком? См. [`../10-decisions/open-questions.md`](../10-decisions/open-questions.md) #6.

---

**См. также:**
- [REST endpoints](rest-endpoints.md) — новый /api/tasktotime/* API
- [`../04-storage/migration-mapping.md`](../04-storage/migration-mapping.md) — STATUS_DRIFT_MAP в деталях
- [`../10-decisions/open-questions.md`](../10-decisions/open-questions.md) #6 — coordination со внешним разработчиком
- [`../../MIGRATION_PLAN.md`](../../MIGRATION_PLAN.md) — Phase 6 cutover
