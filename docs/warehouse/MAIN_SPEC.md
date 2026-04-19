# Warehouse — Main Specification

> **Роль:** authoritative product-level документ. Что строим, зачем, как устроено.
> **Дата:** 2026-04-18
> **Статус:** active (single source of truth на уровне product vision)
> **Scope:** vision + 4 killer use cases + высокоуровневая архитектура + phase plan
> **Детали реализации:** см. [`core/*/SPEC.md`](./core/) и [`improvements/*/SPEC.md`](./improvements/)
> **Тестирование:** см. [`MAIN_TEST_PLAN.md`](./MAIN_TEST_PLAN.md)

---

## 1. Vision

Warehouse — модуль profit-step CRM, который превращает учёт материалов из backend-задачи в диалог с AI-агентом. Telegram-first, mobile-first, voice + photo + text.

**Что делает:**
1. Понимает голос/текст/фото работника
2. Держит ledger-based accounting (immutable, audit-proof)
3. Предлагает, планирует, списывает, закупает
4. Работает в связке с другими AI-агентами (Finance / Tasks / Estimate)
5. Открывает API для внешних партнёров через Python SDK

**Что НЕ делает (scope freeze):**
- Не заменяет человека (agent всегда через draft→confirm pattern)
- Не делает полный ERP (BOM, MRP, complex costing)
- Не строит WMS-маршрутизацию (pick/pack)
- Не интегрируется с внешними ERP системами (1С, SAP) на MVP

---

## 2. Четыре killer use case

### UC1 — On-site quick add (голос на объекте)

Работник приехал на объект, диктует: _"Оставил тут 3 коробки розеток и катушку провода"_.
→ Агент создаёт виртуальный склад объекта + оформляет transfer van→site.

**Детали:** [`improvements/06_onsite_voice/SPEC.md`](./improvements/06_onsite_voice/SPEC.md)

### UC2 — Store receipt → van (фото чека)

Работник выходит из Home Depot, фотографирует чек.
→ Агент парсит (Gemini Vision) + приходует на van'а + связывает с проектом.

**Детали:** [`improvements/05_receipt_vision/SPEC.md`](./improvements/05_receipt_vision/SPEC.md)

### UC3 — Task start → auto-writeoff (авто-списание)

Работник стартует задачу. Агент смотрит норму + остатки van'а.
→ Предлагает: _"Списать по норме: 3 outlet + 15ft провода. OK?"_ → Подтверждает → ledger entries.

**Детали:** [`improvements/07_auto_writeoff/SPEC.md`](./improvements/07_auto_writeoff/SPEC.md)

### UC4 — Estimate → procurement plan (план закупок)

Estimate Agent публикует estimate.
→ Warehouse Agent строит план:
  1. Allocate из internal stock (reservation)
  2. Отсутствующее — Draft PO к Home Depot
  3. Special order — RFQ email к vendor'ам
  4. Не найдено — web search (Home Depot API / SerpAPI / Lowe's)

**Детали:** [`improvements/08_estimate_procurement/`](./improvements/08_estimate_procurement/) + [`09_web_sourcing/`](./improvements/09_web_sourcing/) + [`10_vendor_email/`](./improvements/10_vendor_email/).

### UC5 — Auto-transfer agent (автономное перемещение)

Автономный агент, который сам предлагает перемещения между локациями (WH → van, van → van) когда видит дисбаланс (van пустой но есть задача / склад overstocked).

**Детали:** [`improvements/04_auto_transfers/SPEC.md`](./improvements/04_auto_transfers/SPEC.md)

---

## 3. Высокоуровневая архитектура

```
┌─────────────────────────────────────────────────────────┐
│  USERS: Денис / workers / foremen / external agents     │
└─────┬──────────────┬───────────────┬───────────────────┘
      │              │               │
 Telegram Bot    Web UI         Python SDK
      │              │               │
      └──────────────┼───────────────┘
                     ▼
       ┌───────────────────────────────────────┐
       │  warehouse/api/  (external surface)    │ ← 04_external_api
       │  REST + tool-calling для other agents  │
       └───────────────────┬───────────────────┘
                           │
         ┌─────────────────┴──────────────────┐
         ▼                                     ▼
┌──────────────────────┐            ┌────────────────────┐
│ warehouse/ai_agent/   │            │ warehouse/core/    │
│ (03_ai_agent)         │◄──────────▶│ (02_posting_engine)│
│                       │ calls      │                    │
│ - Gemini 2.0 Flash    │            │ - postDocument()   │
│ - Gemini Vision       │            │ - ledger + balance │
│ - 4 UC capabilities   │            │ - UOM / reservation│
│ - Session state       │            │ - reversal         │
└──────────┬────────────┘            └──────────┬─────────┘
           │                                     │
           └──────────────────┬──────────────────┘
                              ▼
           ┌────────────────────────────────────┐
           │ warehouse/db/ (01_data_model)       │
           │ Firestore collections wh_*          │
           │ items / locations / documents /     │
           │ ledger / balances / norms / events  │
           └─────────────────────────────────────┘
```

**5 core модулей** (каждый — своя папка с SPEC + TESTS в `core/`):

| # | Модуль | Ответственность |
|---|---|---|
| 01 | Data Model | Схемы коллекций, индексы, типы, invariants |
| 02 | Posting Engine | `postDocument()`, ledger, balances, UOM, reservations, reversal |
| 03 | AI Agent | Gemini prompts, 4 UC capabilities, session state |
| 04 | External API | REST routes, tool-calling surface, webhooks, RLS |
| 05 | Rollout & Migration | Clean-slate drop, seed data, cutover plan |

---

## 4. Interaction с другими AI-агентами (swarm)

Warehouse не живёт изолированно. Каждая связка — отдельная папка в `improvements/`:

| Agent | Направление | Что общаем | Папка |
|---|---|---|---|
| **Finance Agent** | Warehouse → Finance | cost events (purchase, writeoff with projectId), anomalies | [`01_sync_finance/`](./improvements/01_sync_finance/) |
| **Tasks Agent** | Tasks ↔ Warehouse | task start → UC3 writeoff proposal; task complete → reconciliation | [`02_sync_tasks/`](./improvements/02_sync_tasks/) |
| **Estimate Agent** | Estimate ↔ Warehouse | estimate.published → UC4 procurement plan; vendor quotes → estimate update | [`03_sync_estimate/`](./improvements/03_sync_estimate/) |
| **Auto-Transfer Agent** (internal) | Warehouse → drivers | автономное перемещение между WH/van/site при дисбалансе | [`04_auto_transfers/`](./improvements/04_auto_transfers/) |

Полный integration matrix + event schemas — в каждой подпапке `improvements/0N_*/SPEC.md`.

---

## 5. Phase plan (high-level)

| Phase | Scope | Time | Gate |
|---|---|---|---|
| **0** | Clean slate + bootstrap (drop old data, создать structure, seed 20 норм + 50 items) | 1 неделя | Empty state + seeds готовы |
| **1** | Core engine + CRUD (01 + 02) — posting, ledger, reservations, reversal | 2 недели | 60+ unit tests green, API работает |
| **2** | UC1 On-site voice (improvements/05) | 1 неделя | Демо Дениса |
| **3** | UC2 Receipt Eyes (improvements/04) | 1.5 недели | 15 реальных чеков протестированы |
| **4** | UC3 Task writeoff (improvements/06 + 02_sync_tasks) | 1 неделя | Интеграция с Tasks Agent |
| **5** | UC4 Procurement (improvements/07 + 08 + 09 + 03_sync_estimate) | 3 недели | Web search + RFQ email рабочие |
| **6** | Observability + UC5-8 (low stock, anomaly, cycle count, dead stock) | 2 недели | Metrics + dashboards + alerts |
| **7** | Python SDK inventory domain | 1 неделя | v0.2.0-beta на PyPI |

**Полный rollout plan:** [`core/05_rollout_migration/SPEC.md`](./core/05_rollout_migration/SPEC.md)

---

## 6. Правило улучшений (improvements lifecycle)

1. **Новая идея/доработка** → создаётся папка `improvements/NN_name/` с `SPEC.md` + `TESTS.md` + `CHANGELOG.md`
2. **SPEC.md** описывает что именно делается (cover letter + scope + data model changes + API impact + acceptance)
3. **TESTS.md** — как валидируем (unit/integration/E2E/manual checklist)
4. **CHANGELOG.md** — дневник: дата / что поменяли / почему / кто
5. **При каждой правке кода** обновляется SPEC (если scope поменялся) + CHANGELOG (всегда)
6. **Готовая доработка** → статус `done` в SPEC header, остаётся в repo как исторический документ
7. **Backlog** — [`improvements/BACKLOG.md`](./improvements/BACKLOG.md) — список будущих улучшений с приоритетами

---

## 7. Принципы

1. **AI не меняет balances напрямую.** Только через draft → human/auto confirm → post.
2. **Immutable ledger.** Проведённый документ не редактируется. Отмена — через reversal document.
3. **Single write path.** Все изменения остатков через `postDocument()`. Никаких прямых мутаций `balance.onHandQty`.
4. **Document-driven.** Каждая операция = документ. Документ → проводка → balance projection.
5. **Idempotent by default.** Все post-операции идемпотентны через `idempotencyKey` header.
6. **Telegram-first UX.** Worker bot — основной интерфейс. Web UI — для admin/management.
7. **Clean slate on MVP.** Legacy inventory (test-only) дропаем, не мигрируем.

---

## 8. Успех MVP (acceptance)

- [ ] Phase 0-1 завершены, core posting engine работает
- [ ] Денис dogfood UC1-UC3 на реальной работе 2 недели
- [ ] 0 инцидентов с расхождением balance
- [ ] ≥ 5 реальных чеков распарсены (UC2) с accuracy > 90%
- [ ] ≥ 3 задачи закрыты через UC3 auto-writeoff
- [ ] UC4 демонстрирует end-to-end: estimate → plan → RFQ email → reservations

---

## 9. Открытые вопросы

Общие, не-секционные. Детальные в каждой подпапке.

1. **System8** — был опечаткой, убрано из scope
2. **Vendor API**: Home Depot Pro / Lowe's Pro API доступны free или enterprise tier? (исследовать в Phase 5)
3. **RFQ email inbox**: dedicated `rfq@profit-step.com` или Gmail с labels?
4. **Offline mode**: van без сигнала — local cache?
5. **Beta users whitelist**: env var или Firestore config?

---

## 10. Связанные документы

- [`MAIN_TEST_PLAN.md`](./MAIN_TEST_PLAN.md) — как тестируем
- [`core/`](./core/) — 5 модулей ядра с детальными SPEC
- [`improvements/`](./improvements/) — доработки и интеграции
- [`improvements/BACKLOG.md`](./improvements/BACKLOG.md) — roadmap будущих улучшений

---

## 11. История

- **2026-04-18** — v1.0. Создано после consolidation предыдущих specs (MASTER/CORE/AI/V3). Структура разбита на core (ядро) + improvements (доработки), каждый с отдельным SPEC + TESTS.
