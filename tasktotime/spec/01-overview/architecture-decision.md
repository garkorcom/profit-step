---
title: "01.5 Архитектурное решение — модуль vs микросервис"
section: "01-overview"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-26
version: 0.2
---

# Архитектурное решение: Hexagonal модуль, не микросервис

> **Status: ✅ ОДОБРЕНО Денисом (2026-04-26).** Полная запись в [decision-log.md Decision 1](../10-decisions/decision-log.md).
>
> Денис спрашивал «сделать задачник как микросервис чтобы легко переносить на другие проекты». Решение: **НЕТ — не микросервис в Phase 1**, но проектируем как Hexagonal/Clean Architecture модуль чтобы extract в standalone был возможен через 1-2 дня без переписывания.

## TL;DR

- ❌ **НЕ делаем** standalone микросервис в Phase 1 — overkill для одной компании
- ✅ **Делаем** Hexagonal Architecture внутри monorepo: чистый domain без Firebase зависимостей, ports/adapters для I/O
- ✅ **Готовы к extract'у** через 6-12 месяцев когда появится второй проект — за 1-2 дня без переписывания domain
- ✅ **Stakeholder buy-in:** дополнительные затраты ~10% к Phase 1 (vs +200% за полный микросервис)

## Pros и cons микросервиса (sub-150 слов)

**За полноценный микросервис:**
- Standalone deploy / scale
- Чёткие service boundaries
- Технологическая независимость (можно сменить Firebase → Postgres + другой backend)
- Легко переносить в другой проект целиком

**Против (для нашего контекста — один CRM, одна компания):**
- +10-14 дней к Phase 1: свой auth (JWT validation), event bus (Pub/Sub / Cloud Tasks), дублирование users/companies в свою БД, network latency на joins, distributed transactions для work_sessions ↔ tasks
- Операционная нагрузка: отдельный deploy pipeline, мониторинг, on-call rotation
- Стоимость превышает выгоду пока нет реального второго проекта который захочет переиспользовать

## Решение: Hexagonal/Clean Architecture inside monorepo

```
tasktotime/
├── domain/                  ← БИЗНЕС-ЛОГИКА — ZERO зависимостей от Firebase/MUI
│   ├── Task.ts              (pure types)
│   ├── lifecycle.ts         (state machine — pure functions)
│   ├── dependencies.ts      (DAG validation, cycle detection)
│   ├── rollup.ts            (subtask rollup math)
│   └── services/
│       ├── TaskService.ts   (transitions, validations)
│       ├── DependencyService.ts (auto-shift cascade math)
│       └── WikiRollupService.ts
│
├── ports/                   ← INTERFACES для всех I/O
│   ├── TaskRepository.ts    (read/write tasktotime_tasks)
│   ├── TransitionLogPort.ts (append tasktotime_transitions)
│   ├── ClientLookupPort.ts  (read clients/{id})
│   ├── ProjectLookupPort.ts
│   ├── UserLookupPort.ts
│   ├── EmployeeLookupPort.ts (legacy namespace)
│   ├── ContactLookupPort.ts
│   ├── SiteLookupPort.ts
│   ├── InventoryCatalogPort.ts
│   ├── EstimatePort.ts
│   ├── FilePort.ts
│   ├── WorkSessionPort.ts   (read sessions, aggregate actuals)
│   ├── PayrollPort.ts       (write bonus/penalty adjustments)
│   ├── AIAuditPort.ts
│   ├── AICachePort.ts
│   ├── IdempotencyPort.ts   (processedEvents/)
│   ├── TelegramNotifyPort.ts
│   ├── EmailNotifyPort.ts
│   ├── PushNotifyPort.ts
│   ├── BigQueryAuditPort.ts
│   ├── StorageUploadPort.ts
│   └── WeatherForecastPort.ts (NOAA)
│
├── adapters/                ← РЕАЛИЗАЦИИ ПОРТОВ
│   ├── firestore/           (текущая реализация — будет в Phase 1)
│   │   ├── FirestoreTaskRepository.ts
│   │   ├── FirestoreClientLookup.ts
│   │   └── ... (по одному per port)
│   ├── http/                (REST endpoints — Phase 2)
│   ├── telegram/            (worker bot integration)
│   ├── email/               (Brevo)
│   ├── push/                (web push notifications)
│   ├── bigquery/
│   ├── storage/
│   └── noaa/                (weather API)
│
├── ui/                      ← React (depends on domain ONLY, не на adapters)
│   ├── hooks/               (useTasks, useTask, useTaskTransitions)
│   ├── components/
│   └── pages/
│
└── tests/
    ├── domain/              ← БЫСТРЫЕ тесты domain без Firebase emulator
    ├── adapters/            ← Integration tests с emulator
    └── ui/                  ← Component tests
```

## Что это даёт

### 1. Заменяемость I/O без переписывания domain
Если через год появится клиент который хочет хостить tasktotime на Postgres+Express:
- Пишем `PostgresTaskRepository` (новый adapter, ~1 день)
- Пишем `ExpressHttpAdapter` (новый adapter, ~1 день)
- Domain код не меняем
- UI код не меняем (она зависит только от domain types)

**Total: 2 дня + расходы на тесты, vs 4-6 недель если бы сразу всё было запутано с Firebase**

### 2. Быстрые тесты domain
- TaskService.transition тестируется in-memory без emulator
- Cycle detection тестируется на mock graphs
- Subtask rollup тестируется на JS arrays

**Comparison:** Firebase emulator startup ~10s + per-test 100ms vs in-memory <1ms per test. Для 200+ unit tests это minute vs hour.

### 3. Подменяемость integrations
- Если завтра хотим заменить Telegram bot на WhatsApp — новый `WhatsAppNotifyPort` adapter, domain не трогаем
- Если AI меняется с Claude на OpenAI — новый `OpenAIAuditPort` adapter
- Если пользователь хочет «работать с моим Notion» — пишем `NotionLookupPort`

### 4. Microservice-ready без операционных издержек
Когда придёт реальный second client / open-source release:
- Domain + ports переезжают в отдельный npm package `@profit-step/tasktotime-core` за 1-2 дня
- Adapters остаются в каждом проекте свои (Firebase / Postgres / в зависимости от стека)
- Domain не трогаем, переиспользуем

## Что это НЕ даёт (пока)

- ❌ Standalone npm package (нужно ~3 дня на packaging — но это уже когда понадобится)
- ❌ Independent deploy pipeline (но и не надо — у нас один Firebase проект)
- ❌ Network isolation (одна Firebase project, общий auth и storage)
- ❌ Performance scaling — но Firestore уже автомасштабируется

## Альтернатива (полный микросервис в Phase 1)

Если Денис всё-таки хочет полноценный микросервис на старте — это **+10-14 дней** к timeline (5-6 нед → 7-8 нед), и потребует решений:

| Вопрос | Опции |
|---|---|
| Где хостим | Cloud Run / Firebase Hosting / отдельный Firebase project / external VPS |
| Auth | Свой JWT issuance + signing keys / валидация Firebase Auth ID токенов через admin SDK |
| Event bus | Pub/Sub (быстро настроить) / Cloud Tasks / RabbitMQ / direct HTTP webhook'и |
| User identity | Дублируем `users/` в свою БД / каждый запрос дёргает Firebase Auth / synchronization cron |
| Storage | Свой S3 / Firebase Storage с signed URL'ами |
| Inventory / Estimates / Clients data | Read через REST API основного приложения (latency) / event-sourced replication / shared database |

Это **не сложно, но дорого** — каждый из 6 вопросов это 1-2 дня дизайна. Без реальной потребности — overengineering.

## Итог

**Phase 1 архитектура:**
1. Hexagonal layout (`domain/` / `ports/` / `adapters/` / `ui/`)
2. Все integrations через explicit ports
3. Domain tests без emulator
4. Adapter tests с emulator + mock'ами других ports
5. UI зависит только от domain types

**Future-proofing:**
- Если через 6-12 месяцев появится потребность extract — будет за 1-2 дня
- Если потребность не появится — и не надо. Не платим за то что не используем.

**Метрика успеха для Phase 1:**
- ✅ `domain/` импортирует ZERO Firebase / MUI зависимостей (eslint rule + CI check)
- ✅ Все adapters тестируются изолированно, mock'ами других ports
- ✅ TaskService unit-тесты выполняются < 1s (без emulator)
- ✅ Через год можно написать `PostgresTaskRepository` за 1 день не трогая domain

---

**См. также:**
- [Контекст](context.md) — почему вообще автономный модуль
- [Цели](goals.md) — почему `tasktotime` а не доработка `gtd_tasks`
- [Анти-паттерны](anti-patterns.md) — что НЕ делаем
- [`../04-storage/data-dependencies.md`](../04-storage/data-dependencies.md) — full inventory I/O точек
- [`../09-folder-structure.md`](../09-folder-structure.md) — реальная file tree модуля
