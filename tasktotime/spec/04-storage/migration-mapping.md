---
title: "04.4 Migration mapping (gtd_tasks → tasktotime_tasks)"
section: "04-storage"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Migration mapping (gtd_tasks → tasktotime_tasks)

> Таблица «поле gtd_tasks → поле tasktotime_tasks» для скрипта миграции в Phase 5. Особое внимание — на status enum drift mapping (mediaHandler 'todo'/'in_progress', cron 'next'/'scheduled', dead 'approved') → канонические значения lifecycle.

## Базовый mapping

| `gtd_tasks` поле | `tasktotime_tasks` поле | Преобразование |
|---|---|---|
| `id` | `id` | identity |
| — | `companyId` | **NEW**, нужно populate из `createdBy.companyId` или `clients/{clientId}.companyId` (см. Edge cases) |
| — | `taskNumber` | **NEW**, генерируем `T-${YYYY}-${seq}` где seq инкрементируется per company |
| `title` | `title` | identity |
| `description` | `description` | identity |
| `memo` | `memo` | identity |
| `checklistItems` | `checklistItems` | identity |
| `attachments` | `attachments` | identity |
| `status` | `lifecycle` | **drift mapping** — см. таблицу ниже |
| `bucket` (если есть) | `bucket` | identity, иначе default `'next'` |
| `priority` | `priority` | identity |
| `createdBy` | `createdBy` | identity |
| `assignedTo` | `assignedTo` | identity |
| `reviewedBy` | `reviewedBy` | identity если есть, иначе undefined |
| `coAssignees` | `coAssignees` | identity |
| — | `requiredHeadcount` | **NEW**, default `1` если не задано |
| `linkedContactIds` | `linkedContactIds` | identity |
| `createdAt` | `createdAt` | identity |
| `updatedAt` | `updatedAt` | identity |
| `plannedStartDate` или `plannedStartAt` | `plannedStartAt` | предпочтение `plannedStartAt`, fallback на `plannedStartDate` |
| `actualStartDate` или `actualStartAt` | `actualStartAt` | то же |
| `dueAt` или `dueDate` | `dueAt` | identity, **REQUIRED** — если null, default `createdAt + 7 days` |
| `completedAt` | `completedAt` | identity |
| `acceptedAt` | `acceptedAt` | identity если есть |
| `estimatedDurationMinutes` или `estimatedMinutes` | `estimatedDurationMinutes` | предпочтение нового, fallback на старое; если оба null — AI suggest или default 60 |
| `actualDurationMinutes` или `totalTimeSpentMinutes` | `actualDurationMinutes` | identity, default 0 |
| `dependsOn` | `dependsOn` | если был `string[]` (только taskIds) → конвертим в `TaskDependency[]` с default `type: 'finish_to_start'`, `lagMinutes: 0` |
| — | `blocksTaskIds` | **NEW**, computed by trigger после миграции |
| — | `autoShiftEnabled` | default `false` |
| — | `isCriticalPath` | default `false`, computed by trigger |
| — | `slackMinutes` | default `0`, computed by trigger |
| `parentTaskId` | `parentTaskId` | identity если есть |
| — | `isSubtask` | derived: `parentTaskId !== undefined` |
| — | `subtaskIds` | computed by trigger через query `where parentTaskId == this.id` |
| — | `subtaskRollup` | computed by trigger |
| — | `category` | default undefined |
| — | `phase` | default undefined |
| — | `wiki` | undefined (нет в старых) |
| — | `wikiInheritsFromParent` | default `true` для subtask, `false` иначе |
| `costInternal` или `cost` | `costInternal` | identity, default `{ amount: 0, currency: 'USD' }` |
| `priceClient` или `price` | `priceClient` | то же |
| `bonusOnTime` | `bonusOnTime` | identity если есть |
| `penaltyOverdue` | `penaltyOverdue` | identity если есть |
| `hourlyRate` | `hourlyRate` | identity |
| `totalEarnings` | `totalEarnings` | identity, default 0 |
| `payments` | `payments` | identity |
| `materials` | `materials` | identity (TaskMaterial type не меняется) |
| `materialsCostPlanned` | `materialsCostPlanned` | identity, default 0 |
| `materialsCostActual` | `materialsCostActual` | identity, default 0 |
| — | `requiredTools` | undefined (нет в старых) |
| — | `location` | undefined (если был string `address` — конвертим в `{ address }`) |
| — | `acceptance` | undefined |
| `clientId` | `clientId` | identity |
| `clientName` | `clientName` | identity (denormalized) |
| `projectId` | `projectId` | identity |
| `projectName` | `projectName` | identity |
| `sourceEstimateId` | `sourceEstimateId` | identity |
| `sourceEstimateItemId` | `sourceEstimateItemId` | identity |
| `sourceNoteId` | `sourceNoteId` | identity |
| — | `linkedTaskIds` | undefined (cross-references появятся новые) |
| `source` | `source` | identity, default `'web'` если не задано |
| `sourceAudioUrl` | `sourceAudioUrl` | identity |
| `aiAuditLogId` | `aiAuditLogId` | identity |
| `aiEstimateUsed` | `aiEstimateUsed` | identity, default `false` |
| `taskHistory` | `history` | RENAME (taskHistory → history) |
| `lastReminderSentAt` | `lastReminderSentAt` | identity |
| `clientVisible` | `clientVisible` | identity, default `false` |
| `internalOnly` | `internalOnly` | identity, default `false` |
| `archivedAt` | `archivedAt` | identity |
| `archivedBy` | `archivedBy` | identity |
| `zone` | — | **DROP** (см. open question — type drift) |
| `isMilestone` | derived → `category = 'inspection'` | если `true`, конвертим в `category` |
| `ganttColor` | — | **DROP** (computed по lifecycle) |
| `clientApprovalRequired` | — | **DROP** (dead code) |
| `reminderEnabled` | — | **DROP** (dead code) |
| `reminderTime` | — | **DROP** (dead code) |
| `taskType` | TBD | см. open question #7 — оставляем или DROP |

## Status enum drift mapping

`gtd_tasks.status` пишется разными writers с разными значениями. Канонический mapping:

| Source writer | Старое значение | Новое `lifecycle` | Notes |
|---|---|---|---|
| Standard CRUD | `'draft'` | `'draft'` | as-is |
| Standard CRUD | `'pending'` | `'ready'` | rename |
| Standard CRUD | `'in_progress'` | `'started'` | rename |
| Standard CRUD | `'completed'` | `'completed'` | as-is |
| Standard CRUD | `'accepted'` | `'accepted'` | as-is |
| Standard CRUD | `'cancelled'` | `'cancelled'` | as-is |
| `mediaHandler.ts` | `'todo'` | `'ready'` | drift fix |
| `mediaHandler.ts` | `'in_progress'` | `'started'` | already maps |
| Cron jobs | `'next'` | `'ready'` | rename |
| Cron jobs | `'scheduled'` | `'ready'` | rename |
| Dead code path | `'approved'` | `'accepted'` | rename |
| Unknown | `null` или другое | `'draft'` | safe fallback |

**Скрипт:** `scripts/migrate-gtd-to-tasktotime.ts` — должен явно бросать warning для unknown values, не silently fallback.

## Edge cases

### `companyId` отсутствует в старых docs

Стратегия:
1. Если есть `clientId` → читаем `clients/{clientId}.companyId`
2. Если есть `projectId` → читаем `projects/{projectId}.companyId`
3. Если есть `createdBy.id` → читаем `users/{uid}.companyId`
4. Если ничего нет → ставим `companyId = 'unknown'` + log warning, ручная разборка PM

### Дубли полей (`estimatedMinutes` + `estimatedDurationMinutes`)

Берём `estimatedDurationMinutes` приоритетно. Если оба null — AI suggest или default 60.

### Старый `dependsOn: string[]`

Конвертим в `TaskDependency[]` с дефолтами:
```typescript
oldDependsOn.map(taskId => ({
  taskId,
  type: 'finish_to_start',
  lagMinutes: 0,
  isHardBlock: true,
  createdAt: now,
  createdBy: { id: 'system', name: 'Migration' }
}))
```

### `subtaskIds` computed после миграции

После основной миграции — отдельный pass:
```typescript
for each task with parentTaskId:
  parentDoc = get(parentTaskId)
  parentDoc.subtaskIds.push(task.id)
  parentDoc.isSubtask = true (для child)
```

### Wiki миграция

В старых tasks нет wiki. Просто оставляем `wiki = undefined`. Юзеры создадут вручную или через AI «Generate from estimate».

## Phased migration script

```typescript
// scripts/migrate-gtd-to-tasktotime.ts

const BATCH_SIZE = 100;
const DRY_RUN = process.env.DRY_RUN === 'true';

async function migrate() {
  let cursor = null;
  let migrated = 0;
  let warnings = [];

  while (true) {
    const batch = await db.collection('gtd_tasks').orderBy('createdAt').startAfter(cursor).limit(BATCH_SIZE).get();
    if (batch.empty) break;

    for (const doc of batch.docs) {
      const oldData = doc.data();
      const newData = mapToTaskToTime(oldData, warnings);

      if (DRY_RUN) {
        console.log(`Would migrate ${doc.id}`);
      } else {
        await db.collection('tasktotime_tasks').doc(doc.id).set(newData);
      }

      migrated++;
    }

    cursor = batch.docs[batch.docs.length - 1];
    console.log(`Migrated ${migrated} so far, ${warnings.length} warnings`);
  }

  console.log(`Done. Total: ${migrated}, warnings: ${warnings.length}`);
  await fs.writeFile('migration-warnings.json', JSON.stringify(warnings, null, 2));
}
```

**Run:**
```bash
DRY_RUN=true npm run migrate         # сначала dry-run
npm run migrate                       # реальная миграция
```

После — отдельный pass для `subtaskIds`, `isCriticalPath`, `slackMinutes`, `subtaskRollup` (через trigger или explicit recompute).

---

**См. также:**
- [Collections](collections.md) — куда идут данные
- [Rules](rules.md) — security rules применяются после миграции
- [`../02-data-model/what-changes-from-gtdtask.md`](../02-data-model/what-changes-from-gtdtask.md) — обоснование DROP полей
- [`../10-decisions/open-questions.md`](../10-decisions/open-questions.md) — #2 (status drift), #5 (cutover strategy)
- [`../../MIGRATION_PLAN.md`](../../MIGRATION_PLAN.md) — phased migration plan (Phase 5 — миграция данных)
