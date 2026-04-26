---
title: "02.3 Что выкидываем из существующего GTDTask"
section: "02-data-model"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Что выкидываем из существующего GTDTask

> Конкретные поля старого `GTDTask`, которые мы НЕ переносим в новый `Task`. Каждое — с обоснованием почему. Это критичный документ для миграции в Phase 5.

## Полный список к удалению

### `estimatedMinutes` (дубль с `estimatedDurationMinutes`)

**Что:** в типе `GTDTask` одновременно есть `estimatedMinutes` и `estimatedDurationMinutes`. Оба считают «сколько времени запланировано».

**Почему выкидываем:** дубль. Консолидируем в одно — `estimatedDurationMinutes` (более явное имя).

**Migration:** при переносе берём `estimatedDurationMinutes`, если null — fallback на `estimatedMinutes`, если оба null — AI-suggested на основе title.

### `totalTimeSpentMinutes` (legacy, не пишется)

**Что:** поле в типе, но **никто не пишет** в него. Артефакт от старой реализации time-tracking.

**Почему выкидываем:** dead code. Реальное значение считается из `work_sessions[]` aggregation в `actualDurationMinutes`.

**Migration:** просто не переносим.

### `totalEarnings` → переименовать или убрать в computed view

**Что:** хранилось как stored field, но фактически это derived computed.

**Почему меняем:** consistency — все computed поля должны быть явно computed, не stored. Решаем при миграции:
- (a) Оставить stored, но обновлять trigger'ом (текущее поведение)
- (b) Убрать из storage, считать в client при отображении

**Прим.:** в новом типе оставляем `totalEarnings: number` как computed (вариант a) для производительности dashboard'а, но с пометкой что значение пишется только trigger'ом.

### Gantt-only поля (дубли с временем)

**Что:**
- `isMilestone` — duplicate с `category in ('inspection', 'permit')`
- `ganttColor` — выводимое из `lifecycle`
- `plannedStartDate/EndDate` — duplicate с `plannedStartAt`
- `actualStartDate/EndDate` — duplicate с `actualStartAt/completedAt`

**Почему выкидываем:** все эти поля — derived из канонических. Хранить дубль = source of truth conflict.

**Migration:**
- `isMilestone === true` → `category = 'inspection'` (default; PM может изменить на 'permit')
- `ganttColor` → не переносим, цвет вычисляется по `lifecycle` в UI
- `plannedStartDate/EndDate` → объединяются в `plannedStartAt` + `plannedStartAt + estimatedDurationMinutes`
- `actualStartDate/EndDate` → `actualStartAt` + `completedAt`

### `clientApprovalRequired`, `reminderEnabled`, `reminderTime`

**Что:** есть в типе, **нет writer'а** (никто не сетает эти поля).

**Почему выкидываем:** dead code. Если надо — добавим обратно явно когда понадобится.

**Migration:** не переносим. Если есть docs со значениями `true` — игнорируем при миграции.

### `taskType` enum + Smart Task Constructor v2 (Motion-style)

**Что:** Motion-style 12 типов (Brief / Async / Sync / Async Brief / etc.) сгруппированных в 4 категории.

**Почему под вопросом:** в конструкшн-бизнесе типы могут быть свои (electrical / plumbing / hvac / framing / inspection / paperwork). Motion's 12 типов — для офисной работы.

**Решение:** оценить, нужно ли в конструкшн. Если да — оставить, **но как plugin-extensible**, не hardcoded enum. Если нет — выкинуть полностью.

**Open question:** см. [`../10-decisions/open-questions.md`](../10-decisions/open-questions.md) #7

### `zone` (пишется в `confirmAiTask` но не в типе)

**Что:** writer пишет, типа нет. Type drift.

**Решение:** добавить в тип канонически (если используется), или удалить writer (если не используется в UI).

## Принцип консолидации

Все поля, которые можно **derived** из других полей — НЕ stored:
- `is_overdue` = computed по `dueAt < now && lifecycle in ('ready', 'started', 'blocked')`
- `is_at_risk` = computed по `dueAt - now < estimatedDurationMinutes`
- `progress` = computed по `subtaskRollup.completedFraction`
- `daysUntilDue` = computed по `dueAt - now`

Stored — только то, что:
- write-once (createdAt, taskNumber)
- explicit user input (title, description, priority)
- transition outcome (lifecycle, completedAt, acceptedAt)
- aggregated trigger result (subtaskRollup, totalEarnings, blocksTaskIds)

---

**См. также:**
- [Что остаётся как было](what-stays.md)
- [Task interface](task-interface.md) — финальная модель после очистки
- [`../03-state-machine/derived-states.md`](../03-state-machine/derived-states.md) — computed states вместо stored полей
- [`../04-storage/migration-mapping.md`](../04-storage/migration-mapping.md) — таблица mapping для скрипта миграции
