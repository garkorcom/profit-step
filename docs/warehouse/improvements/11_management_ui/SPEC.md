# Improvement 11 — Warehouse Management UI

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (next after Phase 10 read-only page)
> **Scope:** CRUD + document workflow в web UI — чтобы admin/manager мог управлять складом без curl/Postman.

---

## 1. Зачем

Сегодняшний `/warehouse` — read-only (Локации + Товары). Чтобы бизнес реально работал, нужны:
- Создание / редактирование items, locations, norms, vendors
- Проведение документов (receipt / issue / transfer / count / adjustment) с confirmation
- Void уже-posted документов (создаёт reversal по §10.5 core spec)
- Просмотр ledger истории + отчётов
- Bulk-импорт через CSV

**Цель:** закрыть ~90% сценариев без touching API напрямую. Остальные 10% (админские — recalc balances, migrate, dead-stock review) оставить как CLI / admin-only endpoints.

---

## 2. Auth & Roles

Используем **Firebase ID token** через `getAuth().currentUser?.getIdToken()` → `Authorization: Bearer <token>` → existing `authMiddleware` валидирует → `req.agentUserId`.

Роли (read from `users/{uid}.role` как везде в CRM):

| Role | Read | Write catalog | Post docs | Void/Reverse | Recalc |
|---|---|---|---|---|---|
| `worker` / `driver` | own van + sites | ❌ | draft only, own location | ❌ | ❌ |
| `foreman` | team | ❌ | ✅ | void own draft | ❌ |
| `warehouse_manager` | all | ✅ | ✅ | ✅ | ❌ |
| `admin` | all | ✅ | ✅ | ✅ | ✅ |

RLS фильтрация — на уровне routes (уже есть pattern в `authMiddleware`).

---

## 3. Структура страниц

```
/warehouse                             (существует — Локации + Товары)
├── /warehouse/items/new               [+ Создать товар]
├── /warehouse/items/:id               [Просмотр + Edit]
├── /warehouse/locations/new           [+ Создать локацию]
├── /warehouse/locations/:id           [Детали + Edit + балансы]
├── /warehouse/norms                   [Список норм]
├── /warehouse/norms/new
├── /warehouse/norms/:id
├── /warehouse/vendors                 [Список vendors]
├── /warehouse/vendors/:id
├── /warehouse/documents               [Список документов с фильтрами]
├── /warehouse/documents/new           [Wizard: тип → lines → confirm]
├── /warehouse/documents/:id           [Детали + Post/Void]
├── /warehouse/ledger                  [Ledger с фильтрами + export CSV]
├── /warehouse/reports/cost-by-project [UC4 cost-summary endpoint]
└── /warehouse/reports/low-stock       [UC6 weekly reorder]
```

---

## 4. Экран 1 — Создание товара

**Форма** (MUI Dialog или full page):

| Поле | Тип | Обязательное | Валидация |
|---|---|---|---|
| SKU | text | ✅ | uppercase, alphanumeric+dashes, unique |
| Name | text | ✅ | 1-200 chars |
| Category | dropdown (load `wh_categories`) | ✅ | |
| Base UOM | text | ✅ | `each`, `ft`, `m`, `lb`, `gal`, `roll` |
| Purchase UOMs | dynamic list | ≥1, ровно 1 isDefault | uom + factor + isDefault |
| Allowed Issue UOMs | multi-select chips | ≥1 | Только из purchaseUOMs или baseUOM |
| Last Purchase Price | number | ✅ | ≥ 0 |
| Average Cost | number | ✅ | ≥ 0 (auto-fill = lastPurchasePrice) |
| Min Stock | number | optional | |
| Reorder Point | number | optional | |
| Is Trackable | checkbox | | для инструментов |
| Notes | textarea | optional | ≤ 2000 chars |

**Submit:** `POST /api/warehouse/items` → если success → redirect на `/warehouse/items/:id` + toast "✅ Товар создан".

**Errors:**
- `409` SKU уже существует → подсветить поле + показать link на существующий item
- `400` валидация → подсветить поле с message из `details.zodIssues`

---

## 5. Экран 2 — Создание локации

Похоже на item, но поля:
- Name, LocationType (warehouse/van/site/quarantine), ownerEmployeeId (если van), licensePlate, address
- Van: `ownerEmployeeId` required (validation через Zod `CreateWhLocationSchema`)
- Site: связка с clientId / projectId

**Submit:** `POST /api/warehouse/locations`.

---

## 6. Экран 3 — Создание документа (wizard)

**Шаг 1: выбор типа**
- 📥 Приход (receipt) — закупка от vendor'а
- 📤 Списание (issue) — материалы на объект/работу
- 🚚 Перемещение (transfer) — между локациями
- ⚖️ Инвентаризация (count) — physical count session
- 🔧 Корректировка (adjustment) — ручная правка

**Шаг 2: контекст** (зависит от типа)
- Receipt: → destinationLocationId, vendorId (optional), eventDate
- Issue: → sourceLocationId, reason (dropdown), projectId (required для `project_*` reasons), phaseCode, costCategory
- Transfer: → sourceLocationId + destinationLocationId, projectId (optional)
- Count: → locationId
- Adjustment: → locationId, reason, direction (in/out)

**Шаг 3: строки**
- Add line: item autocomplete (из `wh_items`), uom (из allowedIssueUOMs/purchaseUOMs), qty, unitCost (для receipt), note
- Inline validation: UOM должен быть в item.purchaseUOMs (для receipt) или item.allowedIssueUOMs (для issue/transfer)
- Running total: sum(qty × unitCost) для visibility

**Шаг 4: preview + submit**
- Показать **balance impact** перед post (уменьшит wire на 15ft, создаст reservation 3 outlet, etc.)
- Если `availableQty < required` на draft creation → предупреждение "недостаточно" + link на UC4 procurement
- Кнопки: `[💾 Сохранить как draft]` / `[✅ Сразу провести]`

**Submit paths:**
- Save draft: `POST /api/warehouse/documents` (status → draft)
- Post immediately: save + `POST /api/warehouse/documents/:id/post`

---

## 7. Экран 4 — Список документов

**Фильтры** (query params):
- docType (receipt / issue / transfer / count / adjustment / reversal)
- status (draft / ready_for_review / posted / voided / expired)
- projectId, locationId (source/dest), vendorId
- Date range (from, to)
- Created by (userId)

**Колонки таблицы:**
- docNumber (clickable → detail page)
- docType (с emoji tag)
- Status (chip: draft/posted/voided/expired)
- Event date
- Source → Dest (для transfer) / Single loc (для остальных)
- Lines count
- Total ($)

**Actions в row (role-based):**
- `draft` + `warehouse:write` → Post / Edit / Void
- `posted` + `warehouse:admin` → Void (→ reversal)
- All → View detail

**Pagination:** cursor-based, 50 docs per page.

---

## 8. Экран 5 — Деталь документа

**Header:** docNumber, type, status chip, event date, created by.

**Sections:**
- **Lines** — item name, qty, uom, unitCost, totalCost per line
- **Balance impact** (если posted) — per location/item: before → after
- **Ledger entries** (для posted/voided) — list ссылок на `wh_ledger`
- **Attachments** — receipt photos (UC2) — preview thumbnails
- **Audit log** — who/when created/posted/voided

**Actions (condition-gated):**
- `draft` → `[✅ Post]` `[✏️ Edit]` `[❌ Void]`
- `posted` → `[🔄 Void with reversal]` (admin only; создаёт reversal doc)
- `voided` → read-only + link to reversal doc

**Void dialog:** `reason` (required: `wrong_qty` / `wrong_items` / `duplicate` / `other` + freeform `note`) → confirmation "Will create reversal doc REV-...".

---

## 9. Экран 6 — Ledger view

**Query filters:**
- itemId / locationId (single or both)
- projectId + phaseCode
- date range

**Columns:**
- Event date
- Document (docNumber clickable)
- Item (name + baseUOM)
- Location
- Delta qty (signed, colored red for out / green for in)
- Unit cost at posting
- Total cost
- Project / Phase

**Actions:**
- Export CSV (client-side, selected rows)
- Click row → document detail page

---

## 10. Отчёты (вкладка /warehouse/reports)

### 10.1. Cost by project
- `GET /api/warehouse/ledger/cost-summary?projectId=X&groupBy=phaseCode`
- Bar chart: phase → cost
- Table: per phase itemized

### 10.2. Low-stock weekly report (UC6)
- Загружает `buildLowStockReorder` output (если scheduled cron сохраняет в `wh_reorder_reports`, иначе on-demand)
- Группировка по vendor с subtotals
- Actions: `[📧 Send draft PO]` (UC4 → `/send-rfq`)

### 10.3. Dead stock (UC8)
- Items с totalValue и daysSinceLastActivity
- Disposition badge (return_to_vendor / clearance / write_off)
- Bulk action: `[📤 Create adjustment documents]` для selected

### 10.4. Anomaly log (UC5)
- Posted issue docs с is_anomaly=true
- Column: taskId, plannedCost, actualCost, overrun%, date
- Click → document detail

---

## 11. Bulk import (CSV)

**Page:** `/warehouse/items/import`, `/warehouse/norms/import`.

Flow:
1. Upload CSV (drag-drop via MUI + papaparse)
2. Preview первые 10 rows с валидацией
3. Fix errors inline или скачать error report
4. Submit batch — backend вызывает `createItem` в цикле с idempotency
5. Прогресс bar + summary (N created, M skipped, K errors)

CSV columns для items: `sku,name,category,baseUOM,lastPurchasePrice,minStock` (минимальный набор). Покрыть остальные `purchaseUOMs` — JSON column или default `each`.

---

## 12. Endpoints, которых не хватает

Существующие REST уже покрывают большую часть. Нужно добавить:

- `POST /api/warehouse/items/bulk` — batch create с idempotency (Phase 1c)
- `POST /api/warehouse/documents/bulk-post` — post array of doc ids
- `GET /api/warehouse/reports/low-stock` — cached reorder report (используется UI)
- `GET /api/warehouse/reports/dead-stock` — кэшированный dead-stock report
- `GET /api/warehouse/audit-log?entityType=document&entityId=X` — history для detail page

---

## 13. Acceptance criteria

- [ ] Warehouse manager может создать item / location / norm / vendor через UI за ≤ 30 сек
- [ ] Manager создаёт issue document из UI, подтверждает, видит updated balance
- [ ] Admin делает void на posted issue → reversal doc появляется в списке
- [ ] Ledger view отфильтрован по projectId показывает все движения
- [ ] Cost-by-project отчёт суммирует корректно (sanity check vs raw ledger)
- [ ] CSV import 100 items без ошибок за < 30 сек

---

## 14. Effort estimate

| Шаг | Effort |
|---|---|
| Items create/edit form + dialog | 3-4 ч |
| Locations create/edit | 2 ч |
| Norms + Vendors CRUD pages | 3-4 ч |
| Document wizard (5 типов) | 6-8 ч |
| Document list + detail + void | 4-5 ч |
| Ledger view + filters + CSV export | 3-4 ч |
| 3 reports (cost / low-stock / dead-stock) | 5-6 ч |
| CSV bulk import (items + norms) | 4-5 ч |
| Bulk endpoints on backend | 2-3 ч |

**Total: 32-41 часа** (≈ 1 неделя full-time; 2-3 недели part-time).

---

## 15. Design principles

1. **Tone:** admin-oriented, density-first tables, minimal "cute". Не мешать быстрой вбивке данных.
2. **Dialogs > full pages** для create/edit когда < 10 полей. Full page только для document wizard.
3. **Optimistic UI** для списков — сразу add row после POST, до получения ответа. На ошибке — rollback + toast.
4. **Keyboard-first**: Enter в последнем поле = submit, Esc = close dialog, Tab-order логичный.
5. **Recovery UI** — если Firebase/network fails, сохранить form state в localStorage + восстановить при reload.
6. **Export/Print везде** — docx/pdf для документов (receipt для vendor), CSV для отчётов.

---

## 16. Open questions

1. **Attachments flow** — receipt photos в UC2 идут через Telegram. Нужен ли upload с web? Firebase Storage + POST multipart? Решение после dogfood.
2. **Cycle count UI** — отдельный exercise (UC7 в BACKLOG). Не входит сюда.
3. **Multi-tenant** — когда появится 2-й paying client, нужно добавить `companyId` scoping. Пока пропускаем.
4. **i18n** — сейчас русский hardcoded. Когда выводить en/es — либо i18next, либо пропустить до первого не-русскоязычного user.
5. **Permissions UI** — отдельная admin-страница для role assignment? Или оставить через user doc edit?

---

## 17. References

- Parent: [`MAIN_SPEC.md`](../../MAIN_SPEC.md)
- Backend REST: [`core/04_external_api/SPEC.md`](../../core/04_external_api/SPEC.md)
- Posting engine: [`core/02_posting_engine/SPEC.md`](../../core/02_posting_engine/SPEC.md)
- Current UI: [`src/pages/warehouse/`](../../../../src/pages/warehouse/)

---

## 18. История

- **2026-04-18** — v1.0 spec. Написан после Phase 10 read-only page, когда стало ясно что без management UI бизнес не может нормально работать. Scope: 9 экранов + 3 отчёта + bulk import, effort 32-41 часа.
