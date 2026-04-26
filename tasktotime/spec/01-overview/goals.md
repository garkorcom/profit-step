---
title: "01.2 Цели — почему `tasktotime` а не доработка `gtd_tasks`"
section: "01-overview"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Цели модуля

> Почему мы создаём новый модуль `tasktotime` вместо инкрементальной доработки существующего `gtd_tasks`. Какие проблемы существующего кода это решает.

## Почему НЕ доработка `gtd_tasks`

Существующий модуль `gtd_tasks` — это GTD-движок, **выросший из inbox-обработки**. Он не задумывался как production unit для конструкшн-бизнеса. У него есть фундаментальные проблемы:

### 1. Hardcoded coupling

`'gtd_tasks'` строка прописана **жёстко в ~50 файлах** проекта. Любое переименование коллекции = breaking change в каждом из них. Это уже не модуль, а тегаз через всё приложение.

### 2. Нет company-scoping (RLS-риск)

`gtd_tasks` живёт без `companyId` поля. Текущие firestore rules имеют `read: if true` для client portal — это явный security hole, отмеченный в `CLAUDE.md §4` (риск #3, RLS cross-tenant bypass).

### 3. Status drift

`mediaHandler.ts` пишет статусы `'todo'/'in_progress'`, которых **нет в типе**. Если строго типизировать сейчас — bot падает. Это технический долг, который проще починить миграцией с явным mapping, а не правками in-place.

### 4. Дубли полей

В типе одновременно есть:
- `estimatedMinutes` и `estimatedDurationMinutes`
- `plannedStartDate/EndDate` и `plannedStartAt`
- `totalTimeSpentMinutes` (legacy, не пишется) и `totalEarnings`

Эти дубли нужно консолидировать. В новой модели — каноничные имена с самого начала.

### 5. Mixed concerns

`gtd_tasks` смешивает:
- GTD-движок (inbox / next / someday)
- Time-tracking (work_sessions)
- Payroll (totalEarnings, payments)
- AI-flow (aiAuditLogId, draft fields)
- Construction-specific (materials, не задумано как первоклассная фича)

В `tasktotime` — единый домен «производственная единица работы», все остальные системы (work_sessions, payroll, AI audit) **остаются в своих коллекциях**, task только ссылается.

## Принцип цели

Превратить задачу в **полноценную production unit** для конструкшн-бизнеса:

| Атрибут | Что входит |
|---|---|
| Время | плановое + фактическое + estimated |
| Деньги | себестоимость + продажная цена + бонусы + штрафы |
| Материалы | связь с inventory |
| Инструменты | required vs reserved vs taken |
| Контакты | бригадир, клиент, поставщики |
| Адрес | location с координатами для weather/maps |
| Акт | подписан клиентом + photos + url |

Всё это — атомарно на одной задаче, через единый contract `Task`.

## Перспектива выноса

Цель: модуль должен быть **готов к выносу в отдельный пакет** через 3+ месяца после стабилизации в проде. Признаки готовности:

- Никаких импортов в `tasktotime/` из `src/components/` или `functions/src/agent/routes/` других модулей
- Только импорты других доменных модулей через explicit `tasksApi.ts` entry point
- Все dependencies на work_sessions / payroll / clients — через FK (id strings), не через cross-imports

---

**См. также:**
- [Контекст модуля](context.md) — общая постановка задачи
- [Анти-паттерны](anti-patterns.md) — что мы НЕ делаем
- [`../02-data-model/what-changes-from-gtdtask.md`](../02-data-model/what-changes-from-gtdtask.md) — конкретные поля которые выкидываем
- [`../02-data-model/what-stays.md`](../02-data-model/what-stays.md) — что остаётся как было
