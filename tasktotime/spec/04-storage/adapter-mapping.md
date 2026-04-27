---
title: "04.6 Adapter mapping — port → Firestore"
section: "04-storage"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-26
version: 0.2
---

# Adapter mapping — Port methods → Firestore operations

> Точный mapping каждого port method на Firestore операцию для PR-A Шага 3 backend implementation. Каждая строка — pre-flight чек-лист реализатора.

## TL;DR

- 21 ports × ~70 методов = ~52 read, ~14 write, ~6 transactions, ~2 in-memory pure.
- 6 transactions: `IdempotencyPort.reserve`, `IdGeneratorPort.nextTaskNumber`, `TaskRepository.saveIfUnchanged`, `TaskRepository.softDelete`, `PayrollPort.appendAdjustment` (с precheck), `TransitionLogPort.append` co-write.
- 12 composite indexes: 11 на `tasktotime_tasks` (см. [indexes.md](indexes.md)), новые на `tasktotime_transitions`, `inventory_transactions`. Реиспользуются `work_sessions` и `files` индексы.
- Snapshot semantics: catalog price копируется в Task на момент добавления; не следит за catalog.
- Idempotency через `processedEvents/{key}` (existing collection, см. `functions/src/utils/guards.ts:22-58`).
- Domain слой не импортирует `firebase-admin` — конверсии Timestamp ↔ epoch ms делаются на adapter boundary.

## Convention notes (применимо ко всем portам)

- **Path naming:** все коллекции tasktotime — `tasktotime_*` префикс. Соседи (`clients`, `users`, `employees`, ...) без префикса — legacy compat.
- **`null` vs `undefined`:** ports возвращают `null` для not-found (см. `TaskRepository.findById` JSDoc). Никогда `undefined`.
- **Time conversion:** Adapter on read: `firestore.Timestamp.toMillis() → number`. Adapter on write: `Timestamp.fromMillis(number)`. Domain знает только `EpochMs = number`.
- **CompanyId scope:** все queries (кроме `findById` где id уникален глобально) обязаны включать `where('companyId', '==', companyId)` для RLS. Исключение — `EmployeeLookupPort.findByTelegramId` (legacy lookup без company-scope, см. data-dependencies.md §employees).
- **Pagination cursor:** `ListOptions.cursor` — base64 от `{lastDocId, lastSortValue}` JSON. Adapter parses, передаёт в `query.startAfter()`.
- **Batch limits:** `findByIds` уважает Firestore `in` limit 30; для >30 IDs — chunking + `Promise.all`.
- **Error mapping:** Firestore `FAILED_PRECONDITION` (missing index) → throw `MissingIndexError`; `ABORTED` (transaction conflict) → throw `StaleVersion` for `saveIfUnchanged`.
- **Idempotency contract:** каждый trigger handler берёт `IdempotencyPort` и резервирует `${eventId}` ДО любых writes; TTL 5 минут default.

---

## 1. TaskRepository (`tasktotime_tasks/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `tasktotime_tasks/{id}` | none | no | Returns `null` if `!doc.exists`. Adapter map Timestamps→epochMs. |
| `findByIds(ids)` | `getAll(...refs)` | N×`tasktotime_tasks/{id}` | none | no | Use `db.getAll(...refs)` для multi-doc batch read; chunk если ids.length > 30 (Firestore limit). |
| `findMany(filter, opts)` | `query` | `collection('tasktotime_tasks').where(...).orderBy(...).limit(...)` | composite (см. ниже) | no | Filter chain: `companyId == X` + optional (`lifecycle in [...]`, `bucket in [...]`, `assignedTo.id ==`, `parentTaskId ==` или `==null`, `projectId ==`, `clientId ==`, `isSubtask ==`, `isArchived ==`, `dueAt < dueBefore`). orderBy: createdAt/updatedAt/dueAt/priority/taskNumber asc/desc. |
| `findSubtasks(parentId)` | `query` | `where('parentTaskId', '==', parentId).orderBy('createdAt', 'asc')` | #10: `parentTaskId + createdAt(asc)` | no | Returns children sorted by creation. |
| `findByDependsOn(taskId)` | `query` | `where('blocksTaskIds', 'array-contains', taskId)` (computed reverse field) | new: `companyId + blocksTaskIds(array-contains)` | no | Reverse query — кто заблокирован этим task. Поле `blocksTaskIds[]` поддерживается trigger'ом `onTaskUpdate`. |
| `save(task)` | `set(doc, data, { merge: false })` | `tasktotime_tasks/{task.id}` | none | optional | **Full replace.** Domain owns the full document. Convert epochMs→Timestamp on write. Sets `updatedAt = serverTimestamp()`. |
| `saveMany(tasks)` | `WriteBatch` (max 500) | N×`tasktotime_tasks/{id}` set | none | atomic batch | Use `db.batch().set(ref, data).commit()`. Если >500 — chunk на несколько batches (НЕ atomic across chunks). |
| `patch(id, partial)` | `update(doc, partial)` | `tasktotime_tasks/{id}` | none | no | **Whitelisted partial merge.** Adapter валидирует ключи через allow-list (исключает lifecycle, history, transitions — они идут только через TaskService). Reserved для denormalization sync (clientName, assignedTo.name) и cascade triggers (subtaskRollup, slackMinutes). |
| `softDelete(id, archivedBy)` | `update` | `tasktotime_tasks/{id}` set `{ isArchived: true, bucket: 'archive', archivedAt: now, archivedBy }` | none | yes (read-then-write) | Read first to verify exists + companyId match, then set archive fields. Не hard-delete. |
| `saveIfUnchanged(task, expectedUpdatedAt)` | `runTransaction` | `tasktotime_tasks/{task.id}` | none | yes (CAS) | Inside txn: read, compare `doc.data().updatedAt.toMillis() === expectedUpdatedAt`, throw `StaleVersion` if mismatch, else `txn.set(ref, task)`. Optimistic concurrency. |

**Composite indexes used (см. [indexes.md](indexes.md)):**

| Filter combination | Index # | Used by use-case |
|---|---|---|
| `companyId + assignedTo.id + dueAt(asc)` | 1 | «Мои активные» по worker'у |
| `companyId + lifecycle + dueAt(asc)` | 2 | Overdue queries |
| `companyId + clientId + createdAt(desc)` | 3 | Client dashboard |
| `companyId + projectId + createdAt(desc)` | 4 | Project page |
| `companyId + bucket + priority(asc)` | 5 | GTD inbox sorting |
| `companyId + lifecycle + actualStartAt(desc)` | 6 | Active-now |
| `companyId + reviewedBy.id + lifecycle` | 7 | Review queue |
| `assignedTo.id + lifecycle + dueAt(asc)` | 8 | Cross-company workers |
| `companyId + sourceEstimateId + isSubtask` | 9 | Estimate decompose idempotency |
| `parentTaskId + createdAt(asc)` | 10 | Subtask listing |
| `companyId + acceptance.signedAt(desc)` | 11 | Signed acts report |

---

## 2. TransitionLogPort (`tasktotime_transitions/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `append(entry)` | `set` | `tasktotime_transitions/{entry.id}` where `id = ${taskId}_${from ?? 'INIT'}_${to}_${at}` | none | yes (часть task save txn) | **Append-only via deterministic id** — естественная idempotency. Если doc уже существует с тем же id — write идемпотентен (тот же payload). Co-written в той же transaction что и `TaskRepository.save` для атомарности lifecycle change + audit. |
| `findForTask(taskId, limit?)` | `query` | `where('taskId', '==', taskId).orderBy('at', 'desc').limit(limit ?? 50)` | new: `taskId + at(desc)` | no | UI timeline view. |
| `findForCompany(companyId, sinceMs?, limit?)` | `query` | `where('companyId', '==', companyId).where('at', '>=', sinceMs).orderBy('at', 'desc').limit(limit ?? 100)` | new: `companyId + at(desc)` | no | Compliance / BigQuery export. |

**New composite indexes:**

- `tasktotime_transitions (companyId, taskId, at desc)` — для `findForTask` с RLS scope
- `tasktotime_transitions (companyId, at desc)` — для `findForCompany`
- `tasktotime_transitions (companyId, action, at desc)` — для action-filtered reports (mentioned в collections.md:91)

---

## 3. ClientLookupPort (`clients/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `clients/{id}` | none | no | Map to `ClientSnapshot` (drop fields outside snapshot interface). Returns null if not found OR archived. |
| `findByIds(ids)` | `getAll(...refs)` | N×`clients/{id}` | none | no | Chunk >30. |
| `listActive(companyId)` | `query` | `where('companyId', '==', companyId).where('status', '==', 'active').orderBy('name')` | existing or new: `companyId + status + name` | no | Dropdown selector. |

---

## 4. ProjectLookupPort (`projects/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `projects/{id}` | none | no | |
| `findByClientId(clientId)` | `query` | `where('clientId', '==', clientId).where('status', '==', 'active')` | existing `clientId + status + createdAt`? | no | Default-project resolution в Cockpit. |
| `listActive(companyId)` | `query` | `where('companyId', '==', companyId).where('status', '==', 'active')` | new: `companyId + status` | no | |

---

## 5. UserLookupPort (`users/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `users/{id}` | none | no | |
| `findByIds(ids)` | `getAll(...refs)` | N×`users/{id}` | none | no | Chunk >30. |
| `findByTelegramId(telegramId)` | `query` | `where('telegramId', '==', telegramId).limit(1)` | telegramId single-field (auto) | no | Используется в notify flows для resolve recipient. |
| `listActive(companyId)` | `query` | `where('companyId', '==', companyId).where('status', '==', 'active')` | existing на users (firestore.indexes.json:178-194) | no | |

---

## 6. EmployeeLookupPort (`employees/`) ⚠️ legacy

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `employees/{id}` | none | no | id может быть `String(telegramUserId)` (legacy). |
| `findByTelegramId(telegramId)` | `query` | `where('telegramId', '==', telegramId).limit(1)` | telegramId single-field (auto) | no | Fallback path после `UserLookupPort.findByTelegramId`. |

**Resolution algorithm в application слое (не в port):**

```typescript
async function resolveUser(idOrTg: string): Promise<UserSnapshot | EmployeeSnapshot | null> {
  // 1. Try users/{id} прямой lookup
  const user = await userLookup.findById(idOrTg);
  if (user) return user;
  // 2. Numeric? — try as telegramId in users
  if (/^\d+$/.test(idOrTg)) {
    const userByTg = await userLookup.findByTelegramId(idOrTg);
    if (userByTg) return userByTg;
  }
  // 3. Fallback to employees/{id}
  const emp = await employeeLookup.findById(idOrTg);
  if (emp) return emp;
  // 4. Last resort — employees by telegramId
  if (/^\d+$/.test(idOrTg)) {
    return employeeLookup.findByTelegramId(idOrTg);
  }
  return null;
}
```

---

## 7. ContactLookupPort (`contacts/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `contacts/{id}` | none | no | |
| `findByIds(ids)` | `getAll(...refs)` | N×`contacts/{id}` | none | no | Chunk >30. Used to mitigate N+1 для `Task.linkedContactIds[]`. |
| `findByProject(projectId)` | `query` | `where('linkedProjects', 'array-contains', projectId)` | existing? | no | |

---

## 8. SiteLookupPort (`sites/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `sites/{id}` | none | no | |
| `findByClient(clientId)` | `query` | `where('clientId', '==', clientId).orderBy('createdAt', 'desc')` | existing `(clientId, createdAt desc)` (firestore.indexes.json:769-781) | no | |

---

## 9. EstimatePort (`estimates/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `estimates/{id}` | none | no | Items хранятся inline в `estimate.items[]`. |
| `findItem(estimateId, itemId)` | `get` + in-memory filter | `estimates/{id}` then `data.items.find(i => i.id === itemId)` | none | no | Items не отдельная subcollection. |
| `findActiveByProject(projectId)` | `query` | `where('projectId', '==', projectId).where('status', 'in', ['sent', 'signed']).orderBy('createdAt', 'desc').limit(2)` | existing `(projectId, status, createdAt desc)` (firestore.indexes.json:677-693) | no | Used by `loadContextSnapshot` в `generateAiTask.ts:138-143`. |

---

## 10. NotePort (`notes/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `notes/{id}` | none | no | Read-only — notes immutable after AI processing. |

---

## 11. InventoryCatalogPort (`inventory_catalog/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findById(id)` | `get` | `inventory_catalog/{id}` | none | no | **Snapshot semantics:** caller должен скопировать `{ name, unit, lastPurchasePrice, clientMarkupPercent }` в `Task.materials[i]` — не хранит FK alone. |
| `findByIds(ids)` | `getAll(...refs)` | N×`inventory_catalog/{id}` | none | no | Chunk >30. |
| `search(companyId, query, limit?)` | `query` | `where('companyId', '==', companyId).where('name', '>=', q).where('name', '<', q + '').limit(limit ?? 20)` | new: `companyId + name` | no | Prefix search. Real fuzzy search — отдельный adapter (Algolia/Typesense) в будущем. |

**Snapshot contract (документировать в JSDoc adapter'а):**

```typescript
// CORRECT: snapshot at add time
const snapshot = await inventoryCatalog.findById(itemId);
task.materials.push({
  catalogItemId: snapshot.id,
  name: snapshot.name,         // copied
  unit: snapshot.unit,         // copied
  plannedPrice: snapshot.lastPurchasePrice, // copied — НЕ live
  qty: 1,
});
// WRONG: live link — would drift с catalog price changes
task.materials.push({ catalogItemId: snapshot.id, qty: 1 }); // ❌
```

---

## 12. InventoryTxPort (`inventory_transactions/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findByTask(taskId)` | `query` | `where('relatedTaskId', '==', taskId).orderBy('timestamp', 'desc')` | new: `relatedTaskId + timestamp(desc)` | no | |
| `sumActualCostByTask(taskId)` | `query` + sum | `where('relatedTaskId', '==', taskId).where('type', '==', 'out')` then `docs.reduce(sum)` | new: `relatedTaskId + type + timestamp(desc)` | no | Used to compute `Task.materialsCostActual` после `complete`. Без aggregation API — read all + sum в memory (OK для < 1000 transactions per task). |

---

## 13. WorkSessionPort (`work_sessions/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findByTask(taskId)` | `query` | `where('relatedTaskId', '==', taskId).orderBy('startTime', 'desc')` | existing `(relatedTaskId, startTime desc)` (firestore.indexes.json:737-749) | no | |
| `aggregateForTask(taskId)` | `query` + reduce | `where('relatedTaskId', '==', taskId).where('status', '==', 'completed')` then sum | new: `relatedTaskId + status` (или extend existing index) | no | Returns `{ totalDurationMinutes, totalEarnings, earliestStartAt, latestEndAt }`. Called от `complete` transition. **Alt:** denormalized aggregate field на task пишется trigger'ом `onWorkSessionCompleted`. |

---

## 14. PayrollPort (`payroll_ledger/`)

⚠️ **Decision needed (TODO before merge PR-A):** collection name `salary_adjustments` vs `payroll_ledger`. Default — `payroll_ledger` (existing in firestore.rules:423). Подтвердить у Дениса.

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `appendAdjustment(input)` | `add` (auto-id) | `payroll_ledger/{auto-id}` | none | yes (с `hasAdjustmentForTask` precheck в той же транзакции) | Внутри `runTransaction`: `query → if exists, abort; else add`. Возвращает `{ id }`. Caller также пишет `task.payrollProcessedAt = now` в той же транзакции для idempotency on re-trigger. |
| `hasAdjustmentForTask(taskId, reason)` | `query` | `where('taskId', '==', taskId).where('reason', '==', reason).limit(1)` | new: `taskId + reason` | no (но вызывается из tx) | Returns `true` if any doc exists. |

**Anti-double-pay pattern:**

```typescript
await db.runTransaction(async tx => {
  const dup = await tx.get(
    db.collection('payroll_ledger')
      .where('taskId', '==', input.taskId)
      .where('reason', '==', input.reason)
      .limit(1)
  );
  if (!dup.empty) return; // idempotent
  const ref = db.collection('payroll_ledger').doc();
  tx.set(ref, { ...input, createdAt: FieldValue.serverTimestamp() });
  tx.update(db.collection('tasktotime_tasks').doc(input.taskId), {
    payrollProcessedAt: FieldValue.serverTimestamp(),
  });
});
```

---

## 15. AIAuditPort (`aiAuditLogs/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `append(entry)` | `add` (auto-id) | `aiAuditLogs/{auto-id}` | none | no | Append-only. Returns `{ id }`. Convert `createdAt` epochMs→serverTimestamp on write. |

---

## 16. AICachePort (`aiCache/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `get<T>(key)` | `get` | `aiCache/{key}` | none | no | Returns `null` если doc not exist OR `expiresAt < now()`. |
| `set<T>(key, value, ttlMs)` | `set` (overwrite) | `aiCache/{key}` `{ value, hitCount: 0, expiresAt: now + ttlMs }` | none | no | Overwrite OK — cache. |
| `incrementHit(key)` | `update` (atomic increment) | `aiCache/{key}` `{ hitCount: FieldValue.increment(1) }` | none | no | Non-blocking — fire-and-forget allowed. |

**TTL cleanup:** Firestore native TTL policy на field `expiresAt`.

---

## 17. IdempotencyPort (`processedEvents/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `reserve(key, ttlMs?)` | `runTransaction` (read + conditional set) | `processedEvents/{key}` | none | yes | Inside tx: `get → if exists AND not expired return false; else set { reservedAt, expiresAt: now + ttlMs ?? 5min, functionName }`. Returns `true` если первый раз. **Fail-open** на error — возвращает `true` чтобы не блокировать (consistent с `guards.ts:55-58`). |
| `isProcessed(key)` | `get` | `processedEvents/{key}` | none | no | Returns `true` если exists AND not expired. |
| `release(key)` | `delete` | `processedEvents/{key}` | none | no | Manual cleanup — редко используется. |

**Coexistence с existing `processedEvents`:** не создавать новую коллекцию. Tasktotime пишет в существующую с префиксом keys: `tt_${eventId}` чтобы не конфликтовать с legacy записями.

---

## 18. TelegramNotifyPort (external — Telegram API)

| Method | External operation | Адаптер обращается | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `send(input)` | HTTP POST к Telegram Bot API + Firestore lookup recipient | `users/{recipientUserId}` get for `telegramId`; fallback `employees/{recipientUserId}`; затем `https://api.telegram.org/bot{TOKEN}/sendMessage` | none | no | Adapter wraps existing `sendMessageToWorker` (workerMessaging.ts:7-58). Returns `{ skipped: true, reason }` если no telegramId. **Idempotency на уровне application** — не в port'е. |

---

## 19. EmailNotifyPort (external — Brevo)

| Method | External operation | Адаптер обращается | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `send(input)` | HTTP POST к Brevo + Firestore lookup recipient | `users/{userId}` get for `email`, then `notifications/{auto-id}` для tracking + Brevo API call | none | no | Adapter может писать `notifications/{id}` для tracking. |

---

## 20. PushNotifyPort (external — FCM)

| Method | External operation | Адаптер обращается | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `send(input)` | `notifications/{auto-id}` add + FCM API call | `notifications/{id}` add doc, then `admin.messaging().send(...)` | none | no | Уважает existing rules `notifications/`. |

---

## 21. BigQueryAuditPort (external — BigQuery streaming)

| Method | External operation | Адаптер обращается | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `log(event)` | `bigquery.dataset.table.insert([event])` | BigQuery streaming insert (через `@google-cloud/bigquery`) | none | no | **Fire-and-forget — MUST swallow errors.** Failed inserts → optional fallback to `systemErrors/{id}`. NEVER blocks domain operation. |

---

## 22. StorageUploadPort (external — Firebase Storage)

| Method | External operation | Адаптер обращается | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `upload(input)` | `bucket.file(path).save(data, { contentType, metadata })` | Firebase Storage SDK | none | no | Returns `{ url, pathRef, sizeBytes }`. |
| `signedUrl(pathRef, ttlSeconds)` | `bucket.file(pathRef).getSignedUrl({ action: 'read', expires: now + ttlSeconds*1000 })` | Firebase Storage SDK | none | no | |
| `delete(pathRef)` | `bucket.file(pathRef).delete()` | Firebase Storage SDK | none | no | |

---

## 23. WeatherForecastPort (external — NOAA API)

| Method | External operation | Адаптер обращается | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `forecast(input)` | HTTP GET к NOAA Weather API + cache check | `aiCache/{lat_lng_dateRange}` get/set, NOAA API call, кэш TTL 6h | none | no | Не Firestore-side — но кэш в Firestore. |

---

## 24. FilePort (`files/`)

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `findByTask(taskId)` | `query` | `where('linkedTo.taskId', '==', taskId).orderBy('uploadedAt', 'desc')` | existing `(linkedTo.taskId, uploadedAt desc)` (firestore.indexes.json:854-866) | no | |
| `findById(id)` | `get` | `files/{id}` | none | no | |
| `registerUpload(meta)` | `add` (auto-id) | `files/{auto-id}` | none | no | После `StorageUploadPort.upload` — записывает metadata. |

---

## 25. ClockPort (in-memory)

| Method | Operation | Implementation | Tx? | Notes |
|---|---|---|---|---|
| `now()` | pure | `Date.now()` (real adapter) или fixed value (test fake) | no | NO Firestore. |
| `todayIso()` | pure | `new Date().toISOString().slice(0,10)` (real); `'2026-04-26'` fixed (test) | no | Adapter получает TZ через DI. |

---

## 26. IdGeneratorPort

| Method | Firestore operation | Path / query | Index | Tx? | Notes |
|---|---|---|---|---|---|
| `newTaskId()` | in-memory | `nanoid()` или `crypto.randomUUID()` | no | Pure — no Firestore. |
| `nextTaskNumber(companyId, year)` | `runTransaction` (CAS counter) | `companies/{companyId}/_meta/taskNumberSequence_{year}` | none | yes | Inside tx: `get current.value`, `set value: current+1, lastIssuedAt: now`, return `T-${year}-${String(current+1).padStart(4, '0')}`. Если doc not exist — init `{ value: 1 }`. **Atomic CAS** обязателен для no-collision. |

---

## Cross-cutting: Transaction patterns

### Pattern A: Lifecycle transition (TaskService.start/complete/accept/...)

```typescript
await db.runTransaction(async tx => {
  // 1. Idempotency reserve (read processedEvents)
  const idemRef = db.collection('processedEvents').doc(`tt_${eventId}`);
  const idemSnap = await tx.get(idemRef);
  if (idemSnap.exists && !isExpired(idemSnap.data())) return; // already processed

  // 2. Read task + verify expected state
  const taskRef = db.collection('tasktotime_tasks').doc(taskId);
  const taskSnap = await tx.get(taskRef);
  if (!taskSnap.exists) throw new TaskNotFound();
  const task = taskSnap.data();

  // 3. Transition validation (domain layer)
  validateTransition(task.lifecycle, target, action);

  // 4. Compute new task state + transition entry
  const newTask = applyTransition(task, action, by, at);
  const transitionEntry = makeTransitionLogEntry(task, newTask, action, by, at);

  // 5. Co-write — task + transition + idempotency marker, all atomic
  tx.set(taskRef, newTask, { merge: false });
  tx.set(
    db.collection('tasktotime_transitions').doc(transitionEntry.id),
    transitionEntry,
  );
  tx.set(idemRef, { reservedAt: at, expiresAt: at + 5*60*1000, functionName: 'taskService.transition' });
});
```

### Pattern B: Cascade trigger (onTaskUpdate writes computed fields to parent)

```typescript
// NO transaction — patch with whitelisted computed fields + anti-loop marker
await taskRepo.patch(parentId, {
  subtaskRollup: computeRollup(siblings),
  slackMinutes: ...,
  metricsProcessedAt: clock.now(), // anti-loop guard
  lastModifiedBy: 'cascadeTrigger', // for checkSelfUpdateGuard
});
// Trigger watches WATCHED_FIELDS that EXCLUDE these computed fields → no re-fire
```

---

## Cross-cutting: Indexes inventory

| Index | Source | Status |
|---|---|---|
| `tasktotime_tasks (companyId, lifecycle, dueAt)` | indexes.md #2 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, assignedTo.id, dueAt)` | indexes.md #1 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, clientId, createdAt desc)` | indexes.md #3 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, projectId, createdAt desc)` | indexes.md #4 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, bucket, priority)` | indexes.md #5 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, lifecycle, actualStartAt desc)` | indexes.md #6 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, reviewedBy.id, lifecycle)` | indexes.md #7 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (assignedTo.id, lifecycle, dueAt)` | indexes.md #8 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, sourceEstimateId, isSubtask)` | indexes.md #9 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (parentTaskId, createdAt asc)` | indexes.md #10 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, acceptance.signedAt desc)` | indexes.md #11 | NEW (in PR #65) ✅ |
| `tasktotime_tasks (companyId, blocksTaskIds array-contains)` | this doc | **TODO PR-A** |
| `tasktotime_transitions (companyId, taskId, at desc)` | this doc | NEW (in PR #65) ✅ |
| `tasktotime_transitions (companyId, at desc)` | this doc | **TODO PR-A** |
| `tasktotime_transitions (companyId, action, at desc)` | this doc | **TODO PR-A** |
| `inventory_transactions (relatedTaskId, type, timestamp desc)` | this doc | **TODO PR-A** |
| `payroll_ledger (taskId, reason)` | this doc | **TODO PR-A** |
| `work_sessions (relatedTaskId, status)` | this doc | **TODO PR-A (extends existing)** |
| `work_sessions (relatedTaskId, startTime desc)` | firestore.indexes.json:737-749 | EXISTING ✅ |
| `files (linkedTo.taskId, uploadedAt desc)` | firestore.indexes.json:854-866 | EXISTING ✅ |
| `sites (clientId, createdAt desc)` | firestore.indexes.json:769-781 | EXISTING ✅ |
| `estimates (projectId, status, createdAt desc)` | firestore.indexes.json:677-693 | EXISTING ✅ |
| `users (companyId, status, createdAt desc)` | firestore.indexes.json:178-194 | EXISTING ✅ |

Total: **17 NEW + 5 EXISTING reused = 22 indexes touched.** PR-A добавит 6 missing indexes к firestore.indexes.json.

---

## Notes / gotchas

### Двойной namespace `users/` ↔ `employees/`

- Two ports, два resolution path. UserRef.id может быть UID, telegramId-as-string, или employee legacy id.
- Application layer (NOT port) делает 4-step resolution.
- Adapter каждого port'а **не пытается** делать fallback автоматически — это responsibility сервисного слоя.

### Inventory snapshot vs live link

- `Task.materials[i]` — **snapshot** при добавлении.
- Catalog price changes **не propagate** в существующие task materials. Это намеренно.
- Если требуется refresh — explicit UI action «refresh prices from catalog».

### Idempotency TTL strategy

- Default TTL 5 минут per `IdempotencyPort.reserve(key, ttlMs?)`.
- Backed by Firestore native TTL policy (`expiresAt` field).
- Existing `cleanupProcessedEvents()` cron — fallback safety.
- Коллекция share'ится с legacy guards системой; ключи tasktotime префиксуются `tt_${eventId}`.

### `TaskRepository.save` vs `patch`

- `save(task)` — **full replace** (`merge: false`). Domain owns full document.
- `patch(id, partial)` — **whitelisted partial merge**. Используется:
  - Cascade triggers (`subtaskRollup`, `slackMinutes`, `isCriticalPath`, `metricsProcessedAt`)
  - Denormalization sync (`clientName`, `assignedTo.name`)
- Adapter `patch` валидирует ключи через allow-list — **запрещает** `lifecycle`, `history`, `transitions`, `id`, `companyId`, `createdAt`, `createdBy`. Попытка patch таких полей → throw `IllegalPatchError`.

### Anti-loop discipline

- Каждый trigger handler принимает `IdempotencyPort` через DI; reserve key = Firebase `event.id`.
- `WATCHED_FIELDS` в `onTaskUpdate` **исключает** computed fields:
  - `subtaskRollup`, `slackMinutes`, `isCriticalPath`, `blocksTaskIds`
  - `actualDurationMinutes`, `totalEarnings`
  - `metricsProcessedAt`, `payrollProcessedAt`, `lastReminderSentAt`, `lastModifiedBy`, `lastModifiedAt`, `updatedAt`

---

**См. также:**
- [Collections](collections.md) — high-level коллекции
- [Indexes](indexes.md) — composite indexes (11 main)
- [Rules](rules.md) — firestore.rules
- [Data dependencies](data-dependencies.md) — full I/O inventory
- [`../05-api/triggers.md`](../05-api/triggers.md) — trigger details
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — Task interface
- [`../10-decisions/open-questions.md`](../10-decisions/open-questions.md) — open questions
