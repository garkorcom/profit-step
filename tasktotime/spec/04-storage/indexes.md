---
title: "04.2 Composite indexes"
section: "04-storage"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Composite indexes

> 11 новых composite indexes на `tasktotime_tasks` (мигрировать существующие из `gtd_tasks`). Каждый индекс — для конкретного query pattern. Без них Firestore вернёт `FAILED_PRECONDITION: The query requires an index`.

Файл: `firestore.indexes.json`

## Список indexes

| # | Поля | Use case (для какого query) |
|---|---|---|
| 1 | `companyId + assignedTo.id + dueAt(asc)` | «Мои активные» — список задач worker'а отсортированных по дедлайну |
| 2 | `companyId + lifecycle + dueAt(asc)` | Overdue queries — `lifecycle in [ready, started, blocked] && dueAt < now` |
| 3 | `companyId + clientId + createdAt(desc)` | Клиентский dashboard — все задачи клиента в хронологическом порядке |
| 4 | `companyId + projectId + createdAt(desc)` | Project page — все задачи проекта |
| 5 | `companyId + bucket + priority(asc)` | GTD inbox/next sorting — bucket + приоритет |
| 6 | `companyId + lifecycle + actualStartAt(desc)` | «Активные сейчас» — `lifecycle === 'started'` отсортированные по времени старта |
| 7 | `companyId + reviewedBy.id + lifecycle` | «На моём ревью» — для reviewer'а, фильтр по lifecycle |
| 8 | `assignedTo.id + lifecycle + dueAt(asc)` | Без company filter — для cross-company workers (рабочие пересекающиеся бригады) |
| 9 | `companyId + sourceEstimateId + isSubtask` | Idempotency для AI auto-generation из estimate (не дублировать subtasks) |
| 10 | `parentTaskId + createdAt(asc)` | Subtasks query — children parent task (для tree view + rollup) |
| 11 | `companyId + acceptance.signedAt(desc)` | Отчёты по акту — выгрузка подписанных актов за период |

## Almost-needed (если будут проблемы — добавить)

- `companyId + projectId + lifecycle` — фильтр project view по статусу
- `companyId + isCriticalPath + lifecycle` — для Critical Path highlight queries
- `companyId + category + phase` — для Gantt group-by queries
- `companyId + linkedContactIds(array-contains) + createdAt(desc)` — «все задачи где упомянут контакт X»

## Прим.: Firestore array-contains limit

Firestore не поддерживает composite index с двумя array-contains полями. Для запросов вида «задачи где `assignedTo` ИЛИ один из `coAssignees`» — придётся делать 2 query в client, объединять. Не индексируем `coAssignees[].id`.

## Создание

Через CLI (не вручную JSON):

```bash
firebase firestore:indexes
```

После сохранения в `firestore.indexes.json` — деплой через:

```bash
firebase deploy --only firestore:indexes
```

⚠️ **Создание индекса занимает 5-30 минут на проде** в зависимости от размера коллекции. Планировать в нерабочие часы.

## Existing indexes для `gtd_tasks`

Перед миграцией Phase 5 — экспортировать существующие индексы:

```bash
firebase firestore:indexes > current-indexes.json
```

Сравнить с списком выше. Существующие индексы на `gtd_tasks` после миграции **удалить** (иначе платим за пустую коллекцию).

---

**См. также:**
- [Collections](collections.md) — на каких коллекциях индексы
- [Rules](rules.md) — security rules используют те же поля для фильтрации
- [Migration mapping](migration-mapping.md) — Phase 5 миграция
- [`../05-api/rest-endpoints.md`](../05-api/rest-endpoints.md) — endpoints которые делают эти queries
