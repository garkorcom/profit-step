# ТЗ — доработка после агентских рефакторов (15 апреля 2026)

## Metadata

- **PM:** Denis
- **Requested by:** Denis (2026-04-17 audit)
- **Дата:** 2026-04-17
- **Priority:** P2 (не горит, но "technical debt paid before growth")
- **Estimated effort:** M (3 задачи × 1-2ч = ~5ч)
- **Status:** TODO
- **Related commits:** `3df40eb`, `7d66893`, `7ba5fbe` (все в main)

## Context

15 апреля 2026 параллельно работали три agent-worktree'а и закоммитили в main через PR три рефакторинга:

1. `3df40eb` — idempotency guards на триггерах
2. `7d66893` — onWorkerBotMessage (2796 → 706 строк, 6 модулей)
3. `7ba5fbe` — ReconciliationPage (1333 → 394 строк, 3 хука + 6 компонентов)

Аудит 2026-04-17 показал что **всё заявленное "сделано"**, но **оставлены три конкретных пробела** — все мелкие, все локальные. Закрыть эти три = превратить "агенты мерджнули и побежали" в полноценный refactor.

## Проблема 1 — Триггеры без idempotency guards

### Что сделано

`onCostCreated` / `onCostUpdate` (в одном файле), `onTaskCreate` / `onTaskUpdate` получили try/catch + structured logger + field-change guard. Проверено: гарды реальные (`before.status !== after.status` и т.п.).

### Что осталось

**4 trigger-файла без гардов** — расковыряй их тем же паттерном:

| Файл | Какой trigger | Риск без гарда |
|---|---|---|
| `functions/src/triggers/firestore/calculateActualCost.ts` | `onWrite` на `costs` | Может триггериться сам на себе (пишет в `notes`), а `onNoteCreated` может снова триггернуть `costs` — **infinite loop risk** |
| `functions/src/triggers/firestore/onNoteCreated.ts` | `onCreate` на `notes` | Create-триггеры в теории не зацикливаются, но unhandled exception шумит в логах |
| `functions/src/triggers/firestore/onBlueprintBatchCreated.ts` | `onCreate` на batch | То же |
| `functions/src/triggers/firestore/onBlueprintJobCreated.ts` | `onCreate` на job | То же |

### Acceptance

- [ ] Каждый из 4 файлов обёрнут в try/catch, ошибки логируются через `functions.logger.error` со структурой `{ docId, error: e.message, stack: e.stack }`
- [ ] `calculateActualCost.ts` (onWrite) получает idempotency guard по `processedEvents` коллекции ИЛИ field-change check (если ничего релевантного не поменялось — return null)
- [ ] Все `console.log` в этих 4 файлах заменены на `functions.logger` (уже выяснил — `console.log` в них нет, но на всякий случай пройтись grep'ом)
- [ ] Emulator smoke: запустить `firebase emulators:start`, вручную создать cost/note/blueprint, убедиться что триггеры срабатывают и не уходят в рекурсию

## Проблема 2 — Handler модули без тестов

### Что сделано

`onWorkerBotMessage.ts` (2796 строк) разбит на 6 модулей. Единственный тест — `mediaHandlerSkip.test.ts` (покрывает F-3/F-7 skip пути), который написан позже в рамках PR #14.

### Что осталось

**5 из 6 модулей без тестов.** Priority-ranked:

| Модуль | LOC | Why тесты важны |
|---|---|---|
| `sessionManager.ts` | 559 | Balance formula, finalizeSession (payroll-чувствительная) |
| `locationFlow.ts` | 465 | handleLocation + handleLocationConfirmStart/Finish (точка входа в селфи-flow) |
| `mediaHandler.ts` | 654 | handleMediaUpload + handleVoiceMessage (I/O тяжёлые — стоит mock-подход как в mediaHandlerSkip.test.ts) |
| `textFallbacks.ts` | 167 | handleText маршрутизация для всех `awaiting*` состояний |
| `profileHandlers.ts` | 157 | Меньший приоритет, но `handleMe`/`handleNameChange` касаются identity sync |
| `checklistFlow.ts` | 100 | Самый маленький, можно последним |

### Acceptance

Минимум:

- [ ] `test/sessionManager.test.ts` — покрыть: баланс-расчёт (после фикса из PR #17), `autoFinishActiveSession` (race condition с несколькими сменами), `finalizeSession` zero-rate warning branch
- [ ] `test/locationFlow.test.ts` — покрыть: `handleLocationConfirmStart` создаёт сессию с правильными флагами + отправляет селфи-prompt (не "Смена начата!"), soft-geofencing запись в activity_logs
- [ ] `test/textFallbacks.test.ts` — покрыть каждый awaiting-branch (start/end × photo/voice/location/description), верификация что announce-message приходит только когда надо
- [ ] (желательно) `test/mediaHandler.test.ts` — handleMediaUpload с `awaitingStartPhoto` (расширение того что уже есть в mediaHandlerSkip)

Pattern — использовать **FULL MOCK** как `generateAiTask.integration.test.ts` / `mediaHandlerSkip.test.ts`. Emulator не нужен.

## Проблема 3 — Reconciliation hooks без тестов

### Что сделано

`ReconciliationPage.tsx` раскрыт в 3 хука + 6 компонентов. Хуки — чистые (filters/sort/pagination/Firestore writes), идеальны для unit-тестов.

### Что осталось

**Ни одного теста на новые хуки.**

| Хук | LOC | Критичность |
|---|---|---|
| `useReconciliationFilters` | 190 | Filter/sort/pagination логика — регрессии тут = бригадиры видят не то что ищут |
| `useTransactionMutations` | 374 | Firestore writes (approve, ignore, undo) — регрессии = финансовые дефекты |
| `useReconciliationExport` | 94 | CSV/PDF export — малый риск, но полезно покрыть |

### Acceptance

Минимум:

- [ ] `src/hooks/__tests__/useReconciliationFilters.test.ts` — purity test: same transactions + same filters → same output. Edge cases: empty transactions, all filtered out, sort by каждое поле.
- [ ] `src/hooks/__tests__/useTransactionMutations.test.ts` — mock Firestore (pattern из существующих `useSessionManager.test.ts` / `useGTDTasks.test.ts`). Проверить что approve/ignore вызывают правильные `updateDoc` + оптимистический update state.
- [ ] `useReconciliationExport` — может быть optional, но smoke-тест на CSV format не помешает.

## Out of scope (отдельно, если руки дойдут)

- **Extraction of remaining logic from onWorkerBotMessage.ts.** Файл всё ещё 706 строк, из них `handleMessage` + `handleCallbackQuery` + auth helpers. Можно вытащить `auth.ts` (checkAuth + registerWorker) и `callbacks.ts` (handleCallbackQuery). Выигрыш — еще ~-200 строк, читаемость лучше.
- **ReconciliationPage unused extraction targets.** В переписанном файле остались inline `AutoApproveRulesDialog`, `CategoryChipPicker`, `TransactionNoteDrawer`, `ExpenseAnalyticsPanel`, `ClientExpensesTab` как импорты — они уже отдельные компоненты. Но сама page ещё 394 строки — можно ещё раз пройтись.
- **Migration of console.log elsewhere.** В репо ~70 вхождений `console.log` в production-коде. Не все в триггерах. Единый sweep на `functions.logger.*` можно сделать отдельным PR.

## Implementation notes

### Приоритет внутри ТЗ

Если делать не всё сразу:

1. **Проблема 1 (triggers)** — **first**, т.к. `calculateActualCost.ts` как `onWrite` без гарда — прямой billing-bomb risk по CLAUDE.md §2.1
2. **Проблема 2 (bot tests)** — second, защищает от регрессий типа PR #14 (где я сам нарушил F-1 из-за отсутствия теста на селфи-order)
3. **Проблема 3 (reconciliation hooks tests)** — third, финансовый риск но не catastrophic

### Deploy note

Проблема 1 требует functions deploy (CLAUDE.md §5 — non-peak, emulator, 48h monitoring). Проблемы 2-3 — только тесты, деплой не нужен.

### Как раздать

Каждая проблема = отдельный PR. Можно делать параллельно в разных worktrees — они не пересекаются файлами.
