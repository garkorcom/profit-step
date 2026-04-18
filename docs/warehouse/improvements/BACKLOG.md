# Warehouse — Improvements Backlog

> **Scope:** приоритезированный список будущих доработок. Активные — в подпапках `NN_name/`.

---

## Legend

- 🟢 **done** — реализовано, в продуктиве
- 🟡 **in progress** — активная разработка
- 🔵 **planned** — в roadmap, дата известна
- ⚪ **backlog** — идея, нужно обсудить/приоритезировать
- ⚫ **deferred** — отложено по бизнес-причинам

---

## Текущий план (по Phase plan из MAIN_SPEC §5)

### Phase 0 — Clean slate (ASAP)
🔵 Реализуется через [`../core/05_rollout_migration/SPEC.md`](../core/05_rollout_migration/SPEC.md). Не имеет отдельной improvements/ папки.

### Phase 1 — Core engine (после Phase 0)
🔵 Через [`../core/01_data_model/`](../core/01_data_model/) + [`../core/02_posting_engine/`](../core/02_posting_engine/) + [`../core/04_external_api/`](../core/04_external_api/).

### Phase 2+ — Integrations + AI capabilities

| Priority | Feature | Folder | Status | Phase |
|---|---|---|---|---|
| P0 | Sync с Finance | [`01_sync_finance/`](./01_sync_finance/) | 🔵 | 4 |
| P0 | Sync с Tasks | [`02_sync_tasks/`](./02_sync_tasks/) | 🔵 | 4 |
| P0 | Sync с Estimate | [`03_sync_estimate/`](./03_sync_estimate/) | 🔵 | 5 |
| P1 | Auto-transfer Agent | [`04_auto_transfers/`](./04_auto_transfers/) | ⚪ | 6+ |
| P0 | UC2 Receipt Vision | [`05_receipt_vision/`](./05_receipt_vision/) | 🔵 | 3 |
| P0 | UC1 On-site Voice | [`06_onsite_voice/`](./06_onsite_voice/) | 🔵 | 2 |
| P0 | UC3 Auto-writeoff | [`07_auto_writeoff/`](./07_auto_writeoff/) | 🔵 | 4 |
| P0 | UC4 Estimate Procurement | [`08_estimate_procurement/`](./08_estimate_procurement/) | 🔵 | 5 |
| P1 | UC4 Web Sourcing | [`09_web_sourcing/`](./09_web_sourcing/) | 🔵 | 5 |
| P1 | UC4 Vendor Email RFQ | [`10_vendor_email/`](./10_vendor_email/) | 🔵 | 5 |
| P0 | Management UI (CRUD + doc wizard + reports) | [`11_management_ui/`](./11_management_ui/) | 🔵 | post-Phase 10 |

---

## Идеи на будущее (⚪ backlog, папки не создаются пока не решим делать)

### P1 ideas

- **Barcode scan через Gemini Vision** — UPC/EAN parse с фото → lookup в catalog
- **Low-stock weekly consolidator** — cron раз в неделю: "что купить на эту неделю по всем pending задачам, grouped by vendor"
- **Anomaly watcher** — daily: find overrun > 25% + $50, alert Денису
- **Dead stock report** — monthly: items без transactions > 90 дней
- **Cycle count workflow UI** — manager запускает count session через Telegram, worker вбивает numbers
- **Semantic search** — "где провод для 15A розетки" → LLM → Firestore query

### P2 ideas

- **Two-phase transfer** — `shipped` → `received` handshake для реальной логистики между van'ов
- **Batch/serial number tracking** — для expensive tools (дрели, miter saws)
- **FIFO cost layering** — когда avgCost перестанет устраивать (Phase 8+)
- **Multi-tenant (companyId scoping)** — когда появится 2-й paying customer
- **Mobile native app** — если Telegram не покрывает use cases (offline scenarios)

### P3 ideas

- **Vendor catalog integrations** — Home Depot Pro API affiliate / Lowe's Pro
- **Automated reorder** — когда stock drops below reorderPoint → auto-place PO (требует approval policy)
- **Preventive maintenance tracking** — для tools (isTrackable) — "this saw нужна sharpening"
- **Warranty registry** — items с serialNumber + warrantyExpiry → alerts на expiry
- **Photo-based inventory** — фото shelf → Gemini Vision → list items visible

---

## Как работать с этой папкой

1. **Новая идея** → добавить запись в "backlog ideas" выше
2. **Идея → план** → обсудить с Денисом → создать папку `NN_name/` с `SPEC.md` + `TESTS.md` + `CHANGELOG.md`
3. **В работе** → обновить status в таблице + статус в header SPEC
4. **Done** → status 🟢 + CHANGELOG пополнен финальным entry + оставляем в repo как historical

---

## История

- **2026-04-18** — первоначальная версия. 10 активных улучшений по UC + sync, backlog с 15+ идей.
