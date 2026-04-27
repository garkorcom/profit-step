# Шаг 3 — Resume Point (где остановились)

**Дата паузы:** 2026-04-26
**Branch:** `feature/tasktotime-backend-pr-a`
**Статус:** WIP — adapters частично готовы, REST handlers / external adapters / tests / PR ещё не сделаны.

---

## Что сделано до паузы

### Pre-flight ✅
- Branch `feature/tasktotime-backend-pr-a` cut from `origin/main`
- Phase 1 + Phase 2 в main (PR #64, #65)
- `npm run tsc:tasktotime` green
- `npm run test:tasktotime` 125/125 passing

### Step A1 ✅
- `tasktotime/spec/04-storage/adapter-mapping.md` (~600 строк) — точный mapping 21 порта на Firestore операции, transactions, indexes
- Cheat-sheet existing patterns собран (REST handlers, guards, Zod, admin SDK, triggers, AI, tests, Telegram)

### Step A2 ⏳ (частично)
**Foundation:**
- `tasktotime/adapters/errors.ts` (121 строк) — AdapterError + codes
- `tasktotime/adapters/firestore/_shared.ts` (211 строк) — `toEpochMs`, `toTimestamp`, `epochsToTimestamps`, `chunk`, `AdapterLogger`, `mapFirestoreError`

**Group 2 (lookup adapters) ✅** — 8 файлов написаны agent'ом:
- FirestoreClientLookup, FirestoreProjectLookup, FirestoreUserLookup
- FirestoreEmployeeLookup (legacy namespace)
- FirestoreContactLookup, FirestoreSiteLookup
- FirestoreEstimate, FirestoreNote

**Group 1 (TaskRepository + TransitionLog) ⏳** — agent в background (на момент паузы)

**Group 3 (Inventory/Work/AI/Infra) ⏳** — agent в background (на момент паузы)

---

## Что НЕ сделано (нужно при resume)

### Step A2 finish
- ❓ Group 1: `FirestoreTaskRepository.ts`, `FirestoreTransitionLog.ts` — проверить статус после resume
- ❓ Group 3: 10 файлов (`FirestoreInventoryCatalog`, `FirestoreInventoryTx`, `FirestoreWorkSession`, `FirestorePayroll`, `FirestoreAIAudit`, `FirestoreAICache`, `FirestoreIdempotency`, `FirestoreFile`, `FirestoreIdGenerator`, `RealClock`) — проверить статус
- 6 external adapters: `tasktotime/adapters/external/{Telegram,Email,Push,BigQueryAudit,FirebaseStorageUpload,MockWeatherForecast}*.ts`
- Barrel: `tasktotime/adapters/firestore/index.ts`, `tasktotime/adapters/external/index.ts`, `tasktotime/adapters/index.ts` с factory `createAdapters(deps)`
- README: `tasktotime/adapters/README.md`

### Step A3 — REST handlers (~45-60 мин)
В папке `tasktotime/adapters/http/`:
- `routes.ts` — Express Router setup
- `handlers/createTask.ts`, `getTask.ts`, `listTasks.ts`, `updateTask.ts`, `transitionTask.ts`, `batchUpdate.ts`, `deleteTask.ts`
- `handlers/addDependency.ts`, `signAcceptance.ts`, `attachMaterial.ts`, `attachTool.ts`, `linkContact.ts`
- `handlers/getFiles.ts`, `getSessions.ts`, `getAudit.ts`
- `schemas.ts` — Zod schemas (single source)
- `middleware.ts` — auth, idempotency, RLS, error handler
- Update `functions/src/agent/agentApi.ts` — mount router

### Step A4 — Adapter integration tests (~30-45 мин)
- `tasktotime/tests/adapters/FirestoreTaskRepository.test.ts`
- `tasktotime/tests/adapters/FirestoreTransitionLog.test.ts`
- `tasktotime/tests/adapters/FirestoreIdempotency.test.ts`
- `tasktotime/tests/adapters/FirestoreIdGenerator.test.ts`
- `tasktotime/tests/http/createTask.test.ts`, `listTasks-RLS.test.ts`, `transition-state-machine.test.ts`
- Запускаются через `firebase emulators:exec`

### Step A5 — PR-A creation (~10 мин)
- Финальный verify (tsc + tests + hexagonal grep)
- Commit + push + `gh pr create`

---

## Как продолжить

**В следующей сессии:**

1. Открыть worktree `inspiring-spence-90a275`, branch `feature/tasktotime-backend-pr-a`
2. `git pull origin main` — могут быть свежие изменения
3. **Pulse check** что фактически написано:
   ```bash
   ls tasktotime/adapters/firestore/ | wc -l    # expected: ~20 если все 3 группы успели
   ls tasktotime/adapters/external/ | wc -l     # expected: 0 если до паузы
   npm run tsc:tasktotime                        # должен быть green
   ```
4. **Если Group 1/3 не завершились** — перезапустить с уменьшенным scope (по 2-3 файла на агента)
5. **Если завершились** — стартовать external adapters группой:
   - Запустить 1 backend-developer для всех 6 external adapters
6. **Затем** barrels + README, потом A3 REST, потом A4 tests, потом A5 PR
7. После PR-A merge → начать PR-B (triggers + AI + crons) — это **HIGHEST RISK**, billing bomb potential, я делаю triggers сам не делегируя

---

## Open decisions (не блокирующие но требуют решения)

См. NEXT_STEPS.md §1 — 6 решений Дениса:
1. Глубина иерархии (default 2 уровня)
2. Cutover окно (TBD)
3. Pipeline mode — Денис подтвердил соло (один Claude с агентами)
4. External AI bot URL (default proxy 1-2 мес)
5. Status drift mediaHandler (default translate-on-write)
6. Wiki rollup primary (default оба, MD первый)

В adapter-mapping.md есть 3 design TODO:
1. PayrollPort collection name — default `payroll_ledger`, verify with Денис
2. processedEvents prefix `tt_` — default
3. TaskRepository.patch whitelist — определён

---

## Files touched в этой сессии (для commit message)

```
tasktotime/adapters/errors.ts
tasktotime/adapters/firestore/_shared.ts
tasktotime/adapters/firestore/Firestore{Client,Project,User,Employee,Contact,Site,Estimate,Note}Lookup.ts (8 lookups)
tasktotime/adapters/firestore/Firestore{TaskRepository,TransitionLog}.ts (если group 1 завершит)
tasktotime/adapters/firestore/Firestore{InventoryCatalog,InventoryTx,WorkSession,Payroll,AIAudit,AICache,Idempotency,File,IdGenerator}.ts + RealClock.ts (если group 3 завершит)
tasktotime/spec/04-storage/adapter-mapping.md
tasktotime/STEP_3_RESUME.md (этот файл)
```

---

## Reading list для resume (порядок)

1. Этот файл (`STEP_3_RESUME.md`) — где остановились
2. `tasktotime/STEP_3_PLAN.md` — общий план Шага 3
3. `tasktotime/spec/04-storage/adapter-mapping.md` — точный mapping для оставшихся adapters
4. `git log feature/tasktotime-backend-pr-a` — последние commits
5. Pulse check files in `tasktotime/adapters/`

---

**См. также:**
- [STEP_3_PLAN.md](STEP_3_PLAN.md) — общий план Шага 3
- [AGENT_PLAN.md](AGENT_PLAN.md) — все 6 шагов
- [NEXT_STEPS.md](NEXT_STEPS.md) — 6 блокирующих решений Дениса
- [spec/04-storage/adapter-mapping.md](spec/04-storage/adapter-mapping.md) — точный mapping
- [spec/01-overview/hexagonal-blueprint.md](spec/01-overview/hexagonal-blueprint.md) — file tree blueprint
