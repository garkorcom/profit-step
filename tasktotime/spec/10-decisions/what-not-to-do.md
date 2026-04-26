---
title: "10.2 Что НЕ делаем в первой фазе"
section: "10-decisions"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Что точно НЕ делаем в первой фазе

> Список технических решений, которые мы сознательно НЕ делаем сейчас — для управления scope. Эти вещи могут быть добавлены в будущем (Phase 4+), но не блокируют MVP.

ТЗ §8.

## Список

### 1. GraphQL

**НЕ делаем.** REST + Callable — достаточно для текущих use cases.

**Почему:**
- GraphQL добавляет complexity (resolvers, schema management)
- REST + Callable покрывают все нужны queries
- Может быть added в Phase 4+ если будет clear use case

### 2. Optimistic concurrency control

**НЕ делаем.** Firestore хватает.

**Почему:**
- Firestore автоматически handles конкурентные writes
- Wiki версионирование через `version` field — это специальный case (см. [`../08-modules/wiki/storage.md`](../08-modules/wiki/storage.md))
- Для остальных полей — last-write-wins acceptable

### 3. Offline-first

**НЕ делаем.** PWA pattern уже есть.

**Почему:**
- Offline-first = огромная complexity (sync, conflict resolution, queue)
- Текущий PWA с service worker достаточен для basic offline read
- Worker'ы на site обычно есть internet (cellular)

### 4. Real-time collaboration (multi-cursor à la Notion)

**НЕ делаем.** Firestore subscriptions достаточно для current scale.

**Почему:**
- Multi-cursor требует CRDTs или OT — недели работы
- Wiki conflict resolution через optimistic concurrency UI достаточно
- Для real-time коллаборации — нужен dedicated team feature, не часть Phase 3

### 5. Multi-language (i18n)

**НЕ делаем.** Отдельная инициатива.

**Почему:**
- i18n — отдельный project (UI strings extraction, translation workflow)
- Все клиенты сейчас в US, основной язык English
- Wiki content multilingual работает sans i18n (пользователь пишет на любом языке)

### 6. Extract в отдельный npm-пакет / репо

**НЕ делаем сразу.** Сохраняем in-tree до полного passage всех тестов на проде (**3+ месяца**). После — можно extract.

**Почему:**
- Раннее extract = high risk если architecture changes during stabilization
- Working in-tree = faster iteration, no version coordination
- After 3+ months production stability — `tasktotime/` готова к extract

См. также: [`../09-folder-structure.md`](../09-folder-structure.md) extractability section

### 7. Dual-write период (опционально)

См. open question #5 в [`open-questions.md`](open-questions.md).

Если выбран hard cutover — **НЕ делаем dual-write** в нерабочие часы это менее complex.

### 8. Smart Task Constructor v2 (Motion-style)

См. open question #7 в [`open-questions.md`](open-questions.md).

По умолчанию — **НЕ переносим Motion-style 12 типов**. Решение Дениса — оставить или drop.

### 9. Cache wiki rollup в Firestore

См.: [`../08-modules/wiki-rollup/concept.md`](../08-modules/wiki-rollup/concept.md)

**НЕ делаем cache.** Compute on-demand. Простое < 1s для 20 subtasks.

Если performance issue в будущем — добавим cache.

### 10. AI agent в чате с задачей

Чат-style AI assistant внутри task ("Hey AI, what's the status?") — **НЕ в Phase 3**. Текущий AI flow `modifyTask` достаточен.

### 11. Voice-to-task в портале клиента

**НЕ делаем.** Voice transcription только в Telegram bot и web (для PM/worker).

### 12. Time-tracking сам по себе

**НЕ trogamemu** — work_sessions остаётся как есть. tasktotime только references.

### 13. Inventory deep changes

Inventory module остаётся, мы только используем `TaskMaterial` и `TaskTool` types через FK.

### 14. Payroll module changes

Payroll не trogamemu. Только пишем в `payroll_entries` через bonus/penalty cron.

### 15. Telegram bot deep refactor

См. CLAUDE.md §4 — onWorkerBotMessage refactor уже сделан. Мы только используем bot для notifications, не меняем его.

### 16. Notes module integration

См. open question #1. Default: notes остаются отдельной подсистемой, не trying to integrate.

## Phase 4+ candidates

Список того, что **может быть** добавлено в Phase 4+ (не commitment, just brainstorm):

- GraphQL endpoint
- Real-time collaboration в wiki (multi-cursor)
- Mobile native app (вместо PWA)
- AI chat assistant в task
- Voice-to-task в client portal
- Multi-language i18n
- Extract в отдельный npm пакет
- Cache wiki rollup для very large projects
- Buildertrend-style auto-create punch list 7 days before acceptance

## Принцип

**MVP — минимум функциональности для production use.** Не gold-plate, не over-engineer. Если фича можно добавить позже без breaking changes — defer.

---

**См. также:**
- [Open questions](open-questions.md)
- [Decision log](decision-log.md)
- [`../09-folder-structure.md`](../09-folder-structure.md) — extractability
