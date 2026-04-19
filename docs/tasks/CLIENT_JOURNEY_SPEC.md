# ТЗ: Сквозной путь клиента — от создания до оплаты

> **Статус:** ACTIVE SPEC (executable roadmap)
> **Дата:** 2026-04-19
> **Родительская спека:** [`CRM_OVERHAUL_SPEC_V1.md`](./CRM_OVERHAUL_SPEC_V1.md) §3 — «Сквозной бизнес-процесс»
> **Автор:** Claude Code Opus 4.7 (1M context), по запросу Дениса
> **Приоритет:** P0 — без этого ТЗ flow не работает end-to-end, каждый шаг делается вручную
> **Эффорт:** 60-80ч суммарно, разбит на 10 PR-фаз

---

## 0. TL;DR

Сейчас у нас есть все **сущности** (Client, Deal, Meeting, Estimate, Project, Task, TimeEntry, Invoice), но между ними **нет автомата** — менеджер вручную:
- Создаёт Project после выигранной сделки
- Переписывает реквизиты клиента в Project
- Добавляет задачи руками вместо генерации из сметы
- Создаёт Invoice ручками вместо триггера от этапа
- Нет Act of Completion flow
- Нет ChangeOrder

Это ТЗ — **список недостающих автомато**в между шагами, отсортированных по порядку в flow. После его полной реализации flow работает сам: менеджер выигрывает сделку → система сама создаёт Project → Estimate → Invoice по триггерам. Человек подтверждает ключевые решения, но не копирует данные вручную.

**Acceptance criteria:** реальный клиент проходит от создания до финальной оплаты с **0 ручными переносами данных** между сущностями.

---

## 1. Карта flow с gap-analysis

Процесс из 12 шагов. Для каждого: текущий статус + что нужно чтобы перейти к следующему автоматически.

### Шаг 0 — Создание клиента

**Триггеры создания:**
- Manual form `/crm/clients/new`
- From estimate (когда пришёл blueprint по email)
- From Telegram bot
- API call от внешнего агента (`@crmapiprofit_bot`, OpenClaw)

**Что есть сейчас (🟢 GOOD):**
- `POST /api/clients` с идемпотентностью
- Дедупликация по phone / name / geo (fuzzy match)
- Auto-create from address (UC #38)
- Client Card V2 с lifecycleStage / segment / health

**Gap: 🟡 SMALL**
- Нет единого «мастера создания клиента» в UI — форма минимальная, без выбора источника
- Fields `billingInfo`, `taxInfo`, `decisionMakers` есть в схеме, но UI не даёт их заполнить при создании
- Нет triggers `onClientCreated` для welcome email / push owner

**Следующий этап:** Lead в Deal.

---

### Шаг 1 — Создание сделки (Deal) из лида

**Текущий статус:**
- 🟢 Сущность Deal есть (`deals` collection)
- 🟢 Sales Funnel UI работает на `/crm/deals` (kanban + 7 стадий)
- 🟡 Но: **Deal создаётся вручную** из карточки клиента / kanban

**Gap: 🔴 CRITICAL**
- Нет «Создать сделку из клиента» кнопки на Client Card V2 (планируется в Quick Actions)
- Нет автосоздания Deal при создании клиента с источником «лид» (инбаунд)
- `stage` не имеет probability — AI win-rate не считается
- `lost_reason` не обязателен при проигрыше (требуется по спеке §5.1)

**Что делать (PR: `feat(crm): deal-from-client + lifecycle`, ~4ч):**
1. На Client Card V2 в Quick Actions кнопка «💼 Создать сделку»
2. Auto-pre-fill `clientId`, `owner_id = current user`
3. При создании лида (`POST /clients` с `source='lead'`) → автосоздание стартового Deal в стадии «Новая»
4. `lost_reason` обязателен при PATCH с `status='lost'` (backend Zod refine)
5. Probability на каждой стадии pipeline'а (настройка в `pipelines` collection)

---

### Шаг 2 — Встреча замера / квалификации

**Текущий статус:**
- 🟢 Meeting entity + UI tab на клиенте (PR #31)
- 🟢 Outcome gate § 5.4 — нельзя завершить без outcome
- 🟡 Но: Meeting не влияет на Deal stage автоматически

**Gap: 🟡 MEDIUM**
- После «Замер выполнен» stage сделки должен автоматически двинуться в «КП в работе» — сейчас менеджер двигает руками
- Нет Telegram-напоминания за 24ч/2ч до встречи (спека §5.4)
- Нет Google Calendar sync (calendarEventId поле есть, sync нет)

**Что делать (PR: `feat(crm): meeting→deal-stage-advance`, ~3ч):**
1. Trigger `onMeetingCompleted`: если `dealId` set → найти Deal → продвинуть stage если outcome positive
2. Auto-push «КП в работе» при type=site_survey+completed
3. Telegram reminder job (scheduled every 15min — проверяет upcoming meetings, шлёт напоминалку клиенту если есть `clientId → telegramChatId`)

**Out of scope:** Google Calendar bidirectional — отдельным PR.

---

### Шаг 3 — Создание сметы (Client Estimate v1)

**Текущий статус:**
- 🟢 `estimates` collection с dual-layer (internalItems + clientItems)
- 🟡 Но: **сметы не генерируются из задач** — менеджер заполняет вручную
- 🔴 Нет версионирования (v1, v2) — каждая смета отдельный doc

**Gap: 🔴 CRITICAL** — это основной ручной труд менеджера

**Что делать (PR: `feat(estimates): create-from-tasks + versioning`, ~8-10ч):**
1. **Task `billable` / `production` flags** (схема + UI checkbox в таск-эдиторе)
2. **Task `estimated_price_client` / `estimated_cost_internal` / `unit` / `quantity` / `rate` fields** (уже в спеке §6.2)
3. **Estimate constructor UI** — `POST /api/estimates/from-tasks` принимает `{projectId, taskIds: [...]}`:
   - Слева список задач с `billable=true`
   - Справа — черновик сметы
   - Drag-to-group для объединения нескольких задач в одну позицию
   - Add position manually (материалы / доставка)
4. **Версионирование:** `estimate.version: 1, 2, 3`, `estimate.parentVersionId` для цепочки. Copy-on-edit.
5. Кнопка «Сравнить версии» — diff view
6. Upgrade DataModel: `estimate.source_task_ids: string[]` на line items — для traceability

**Файлы:**
- `functions/src/agent/schemas/taskSchemas.ts` — billable/production fields
- `functions/src/agent/schemas/estimateSchemas.ts` — CreateFromTasksSchema
- `functions/src/agent/routes/estimates.ts` — POST /from-tasks endpoint
- `src/pages/estimates/EstimateBuilderPage.tsx` (NEW)

---

### Шаг 4 — Отправка сметы клиенту + online approval

**Текущий статус:**
- 🟡 Share-tokens (`client_portal_tokens`) уже есть
- 🔴 Но: нет страницы «view estimate» для клиента
- 🔴 Нет кнопки «Approve» → нет триггера «Estimate approved»
- 🔴 Нет трекинга открытий

**Gap: 🔴 CRITICAL** — client portal на 0%

**Что делать (PR: `feat(portal): estimate approval flow`, ~6-8ч):**
1. **Public page `/portal/estimate/:slug`** — показывает смету с брендингом Profit Step
2. `estimate.sentAt` / `estimate.viewedAt` / `estimate.approvedAt` timestamps
3. **Кнопка «Одобрить»** на странице → `POST /api/portal/estimates/:slug/approve` → trigger `onEstimateApproved`
4. Email/Telegram клиенту когда смета sent + когда approved (обратно менеджеру)
5. **Trigger `onEstimateApproved`:** продвинуть Deal stage → «Выиграна»

---

### Шаг 5 — Выигранная сделка → авто-создание Project

**Текущий статус:**
- 🔴 **MISSING** — основной gap из §1.1 спеки CRM overhaul
- Менеджер вручную: создал Project → вбил имя/адрес из клиента → скопировал реквизиты → слинковал approved estimate

**Gap: 🔴 CRITICAL** — это ключевая автоматизация для снятия ручного труда

**Что делать (PR: `feat(crm): deal-to-project auto-creation`, ~5-6ч):**
1. **Trigger `onDealStatusChange` to `won`**:
   - Если уже есть `deal.projectId` → skip (idempotency)
   - Найти approved estimate: `where('dealId', '==', dealId).where('status', '==', 'approved').orderBy('version', 'desc').limit(1)`
   - Create Project с полями:
     ```
     {
       clientId: deal.clientId,
       dealId: deal.id,
       estimateId: approvedEstimate.id,
       name: `${client.name} — ${deal.title}`,
       address: deal.workAddress || client.address,  // SNAPSHOT
       billingInfoSnapshot: { ...client.billingInfo },  // SNAPSHOT
       taxInfoSnapshot: { ...client.taxInfo },  // SNAPSHOT
       contactPerson: client.decisionMakers.find(d => d.isPrimary) || client.contacts[0],
       taxRate: client.taxInfo?.taxRate,
       currency: client.currency || 'USD',
       projectManager: deal.ownerId,
       status: 'active',
       createdAt: serverTimestamp,
     }
     ```
   - Update deal: `deal.projectId = newProject.id`
2. **UI:** на выигранной Deal card — chip «Converted to project: {projectName}» с linkом
3. **Revert button:** если проект создан ошибочно — admin может отменить (archive project + unset deal.projectId)

**⚠️ Idempotency guards (CLAUDE.md §2.1):** field-change check, не писать в `deals` из `onDealStatusChange` trigger.

---

### Шаг 6 — Project: auto-fill + tasks + folder tree

**Текущий статус:**
- 🟡 Project entity есть, но auto-fill из Client сейчас нет
- 🔴 Task creation вручную, нет connect с estimate line items
- 🔴 Нет auto-folder tree (§6.4 спеки)

**Gap: 🔴 BIG**

**Что делать (PR: `feat(projects): estimate-to-tasks + folder-tree`, ~8-10ч):**
1. **POST `/api/projects/:id/generate-tasks-from-estimate`** — берёт approved estimate → создаёт задачи по каждой позиции:
   ```
   for each line_item in approved_estimate:
     create task {
       projectId,
       title: line_item.description,
       billable: true,
       production: true,
       estimatedPriceClient: line_item.total,
       unit: line_item.unit,
       quantity: line_item.quantity,
       rate: line_item.unitPrice,
       estimatedHours: null,  # заполняет PM
     }
   ```
2. **Batch task creation UI** — список предложенных задач с чекбоксами, кнопка «Создать все»
3. **Auto-folder structure** (§6.4):
   ```
   POST /api/projects/:id/init-folders
     → create /_project-docs/, /_photos/, /_invoices/, /_materials/
     → for each task: create /tasks/{code}-{name}/inputs|work|outputs/
   ```
4. Trigger `onProjectCreated` (from won Deal) → автоматически вызвать обе операции

---

### Шаг 7 — Invoice (аванс)

**Текущий статус:**
- 🟢 Invoice entity есть
- 🔴 Но: **нет auto-generation** из Estimate / Deal
- 🔴 Нет payment schedule (30/40/30 как в §10.2 спеки)

**Gap: 🔴 CRITICAL**

**Что делать (PR: `feat(invoices): payment-schedule + auto-gen`, ~6-8ч):**
1. **Payment Schedule entity** (новая коллекция `payment_schedules`):
   ```
   { projectId, milestones: [
     { label: 'Аванс', percent: 30, trigger: 'on_contract_signed', status: 'pending', invoiceId: null },
     { label: 'Черновой этап', percent: 40, trigger: 'on_stage_act:roughwork', status: 'pending' },
     { label: 'Сдача', percent: 30, trigger: 'on_final_act', status: 'pending' },
   ], createdAt }
   ```
2. **Template schedules** — 3 дефолтных («ремонт», «электрика», «custom»). Можно выбрать при создании Project
3. **POST `/api/invoices/from-milestone`** — генерирует Invoice из milestone: copy line items из approved estimate пропорционально `percent`
4. **Trigger `onEstimateApproved`** → auto-generate первый invoice (аванс)
5. **Trigger `onWorkActSigned`** → auto-generate next milestone invoice

---

### Шаг 8 — Internal Estimate (Production Plan)

**Текущий статус:**
- 🟢 Estimate уже двухслойная, `internalItems` есть
- 🔴 Но: **ProductionItem entity отдельно не существует** — plan/fact живёт в `gtd_tasks.budgetAmount + actualDurationMinutes`

**Gap: 🟠 MEDIUM** — работает в текущей форме, но не даёт плана/факта на уровне позиций

**Что делать (PR: `feat(production): productionItem entity`, ~12-15ч):**
1. Новая коллекция `production_items`:
   ```
   {
     id, projectId, sourceEstimateItemId, title,
     clientPrice,
     // plan
     plannedLaborHours, plannedLaborCost, plannedMaterialsCost,
     plannedSubcontractorCost, plannedOverhead, plannedTotalCost,
     // fact (aggregated from TimeEntry + MaterialPurchase)
     actualLaborHours, actualLaborCost, actualMaterialsCost,
     actualSubcontractorCost, actualTotalCost,
     // variance
     variancePct,
     // sourcing
     sourcingStrategy: 'in_house' | 'tender' | 'direct_award',
     assigneeId, subcontractorId,
     status: 'planned' | 'in_progress' | 'done' | 'blocked',
     createdAt, updatedAt,
   }
   ```
2. Trigger `onProjectCreated` (from won Deal) → generate ProductionItems from approved estimate's internalItems
3. Trigger `onTimeEntryCreated` → update actualLaborHours/Cost на ProductionItem
4. Trigger `onMaterialPurchased` → update actualMaterialsCost
5. UI: «Производственный план» вкладка в Project с таблицей ProductionItems + variance

**NOTE:** Это большой refactoring — менять данные в существующих gtd_tasks не надо. ProductionItem — новая сущность рядом с tasks. Tasks остаются для GTD-планирования, ProductionItems для cost-tracking.

---

### Шаг 9 — Производство: таймеры, материалы, фотоотчёты

**Текущий статус:**
- 🟢 Worker bot с selfie check-in
- 🟢 TimeEntry (`work_sessions`) с geo, voice transcription, face match
- 🟡 MaterialPurchase живёт как `cost` с category='materials', нет формальной entity

**Gap: 🟠 MEDIUM**

**Что делать (PR: `feat(production): materials-entity + foreman-today`, ~6-8ч):**
1. **MaterialPurchase entity** — новая коллекция `material_purchases`:
   ```
   {
     id, projectId, productionItemId?, supplier, date, amount,
     receiptPhotoUrl, ocrExtractedItems: [...],
     status: 'planned' | 'ordered' | 'delivered' | 'used',
     createdBy, createdAt,
   }
   ```
2. **OCR pipeline** — бригадир фотает чек в бот → Gemini Vision парсит → creates MaterialPurchase → links to ProductionItem
3. **Foreman's «Today» dashboard** (§8.4 спеки):
   - Кто работает сейчас (active work_sessions)
   - Кто и сколько работал сегодня
   - Алёрт: >70% часов при 50% работ
   - Закрытые этапы

---

### Шаг 10 — Act of Completion

**Текущий статус:**
- 🟡 `work_acts` collection есть (видна в indexes)
- 🔴 Но: **нет flow генерации, подписи, триггеров**

**Gap: 🔴 CRITICAL**

**Что делать (PR: `feat(finance): work-act-flow`, ~8-10ч):**
1. **POST `/api/work-acts/generate`** `{projectId, scope: 'stage:roughwork' | 'final', productionItemIds: [...]}`
   - Фильтрует completed ProductionItems
   - Суммирует amounts из estimate
   - Создаёт work_act doc с line items + photos links + total
   - Generates PDF через template
2. **Public page `/portal/act/:slug`** — клиент видит акт + кнопку «Подписать»
3. `POST /api/portal/acts/:slug/sign` → trigger `onWorkActSigned`:
   - Update act.status='signed'
   - Auto-generate next milestone invoice (см. Шаг 7)
   - Уведомление менеджеру

---

### Шаг 11 — Оплата + сверка + финальный акт + P&L

**Текущий статус:**
- 🟢 Reconciliation page работает (338 транзакций, 100% AI-авто)
- 🟡 P&L по клиенту/проекту частично (в Finance tabs)
- 🔴 Нет per-milestone payment tracking

**Gap: 🟠 MEDIUM**

**Что делать (PR: `feat(finance): per-project-reconciliation + close-out`, ~6-8ч):**
1. **Per-project reconciliation view**: таблица из §10.4 спеки (Работы/Материалы/Субподряд/Накладные × План/Факт/Отклонение)
2. **Trigger `onInvoicePaid`** (уже есть, расширить):
   - Mark payment_schedule milestone as paid
   - Если это final milestone и все production_items status='done' → open Final Act flow
3. **Project Close-Out page**:
   - Final variance report
   - Margin achieved vs planned
   - NPS survey trigger → Telegram клиенту
   - Warranty paдок (кнопка «Создать гарантийный паспорт»)

---

### Шаг 12 — Warranty + reviewing + referral

**Текущий статус:**
- 🟡 `warranty_tasks` collection есть (видна в indexes)
- 🔴 Нет UI, нет flow NPS, нет реферальной программы

**Gap: 🟠 LOW priority** — в конце flow, можно отложить

**Что делать (PR: `feat(crm): warranty-nps-referral`, ~5-6ч — опционально):**
1. Warranty form для клиента через portal
2. NPS push через Telegram через 14 дней после финальной оплаты
3. Referral tracking (`referralByClientId` уже в Client schema)

---

## 2. Матрица задач

| # | PR / Фаза | Эффорт | Blocks next? | Что даёт |
|---|---|---|---|---|
| 2.1 | Deal from client + lifecycle | 4ч | No | Quick action в Client Card |
| 2.2 | Meeting → Deal stage advance | 3ч | No | Автоматика после замера |
| 2.3 | **Task flags + Estimate from tasks** | 8-10ч | **YES — blocks 2.5, 2.7, 2.8** | Главный ручной труд уходит |
| 2.4 | Client portal: estimate approval | 6-8ч | **YES — blocks 2.5, 2.7** | Клиент сам жмёт "Approved" |
| 2.5 | **Deal → Project auto-creation** | 5-6ч | **YES — blocks 2.6, 2.7, 2.8** | Главная автоматизация |
| 2.6 | Project: estimate→tasks + folder tree | 8-10ч | No | Меньше ручного создания |
| 2.7 | **Payment schedule + invoice auto-gen** | 6-8ч | No | Деньги на автомате |
| 2.8 | ProductionItem entity + generation | 12-15ч | No | Plan/fact tracking |
| 2.9 | MaterialPurchase + foreman today | 6-8ч | No | Лучший production oversight |
| 2.10 | **Work Act flow + portal sign** | 8-10ч | **YES — blocks 2.11** | Клиент подписывает акты |
| 2.11 | Per-project reconciliation + close-out | 6-8ч | No | Финальный margin report |
| 2.12 | Warranty + NPS + referral (optional) | 5-6ч | No | LTV + repeat business |

**Суммарно:** ~77-101ч. Без опционального 2.12 — 72-95ч.

## 3. Критический путь

Для того чтобы клиент **прошёл от создания до первой оплаты на автомате**, нужны:

**Минимальный критический путь (MVP End-to-End, ~36-42ч):**
- 2.3 Task flags + Estimate from tasks
- 2.4 Client portal estimate approval
- 2.5 Deal → Project auto-creation
- 2.7 Payment schedule + invoice auto-gen (частично)

После этих 4 PR'ов: менеджер создаёт клиента → добавляет задачи с billable=true → собирает смету → клиент одобряет онлайн → система сама создаёт Project + генерит первый Invoice (аванс).

**Полный flow до финальной оплаты (~80ч):**
+ 2.10 Work Act flow — клиент подписывает акты этапов → next milestone invoice

## 4. Dependency graph

```
          ┌────────────┐
          │ 2.1 Deal   │
          │ from client│ (independent)
          └────────────┘
                │
                ▼
     ┌────────────────────────────────────┐
     │ 2.3 Task flags + Estimate from     │ CRITICAL PATH
     │     tasks                          │
     └────────────────────────────────────┘
                │
                ▼
     ┌────────────────────────────────────┐
     │ 2.4 Portal: estimate approval      │ CRITICAL PATH
     └────────────────────────────────────┘
                │
                ▼
     ┌────────────────────────────────────┐
     │ 2.5 Deal → Project auto-creation   │ CRITICAL PATH — MAIN GAP from §1.1
     └────────────────────────────────────┘
                │
         ┌──────┴───────┐
         ▼              ▼
┌────────────┐   ┌──────────────────┐
│ 2.6 tasks  │   │ 2.7 Payment      │ CRITICAL PATH
│ from est + │   │ schedule + auto  │
│ folders    │   │ invoice          │
└────────────┘   └──────────────────┘
                         │
                         ▼
                 ┌──────────────┐
                 │ 2.10 Work Act│ CRITICAL PATH (для финальной оплаты)
                 │ flow + sign  │
                 └──────────────┘
                         │
                         ▼
                 ┌──────────────┐
                 │ 2.11 Per-proj│
                 │ reconciliat. │
                 └──────────────┘

2.2 Meeting→Deal-stage       — independent, any time
2.8 ProductionItem split     — independent big refactor, не blocker
2.9 MaterialPurchase          — independent
2.12 Warranty/NPS/Referral    — optional
```

## 5. Рекомендуемая последовательность

**Sprint 1 (1 неделя, 12-16ч):**
1. 2.1 Deal from client (4ч) — быстрый win
2. 2.3 Task flags + Estimate from tasks (8-10ч) — главное

**Sprint 2 (1-2 недели, 15-20ч):**
3. 2.4 Portal: estimate approval (6-8ч)
4. 2.5 Deal → Project auto-creation (5-6ч) — САМОЕ ВАЖНОЕ
5. 2.2 Meeting → Deal stage advance (3ч) — доп

**Sprint 3 (1 неделя, 12-16ч):**
6. 2.6 Project: estimate→tasks + folder tree (8-10ч)
7. 2.7 Payment schedule + invoice auto-gen (6-8ч)

**Sprint 4 (1-2 недели, 14-18ч):**
8. 2.10 Work Act flow + portal sign (8-10ч)
9. 2.11 Per-project reconciliation (6-8ч)

**Sprint 5 (optional, 20-30ч):**
10. 2.8 ProductionItem entity (12-15ч)
11. 2.9 MaterialPurchase (6-8ч)
12. 2.12 Warranty/NPS (5-6ч)

**Итог:**
- После **Sprint 2** (~30ч): клиент создан → выиграна сделка → смета одобрена → Project auto-создан.
- После **Sprint 3** (~40ч): + задачи из сметы + первый Invoice автоматом.
- После **Sprint 4** (~55ч): + подписание акта + следующие invoice по milestone.
- Полный flow до последней оплаты работает.

---

## 6. Что UI должен показывать на каждом этапе

Чтобы менеджер доверял flow'у, UI должен быть прозрачным:

| Этап | Где видно |
|---|---|
| Клиент создан | Client Card V2 health score, lifecycle=lead |
| Deal создана | Client Card → Сделки tab + Sales Funnel |
| Meeting запланирована | Client Card → Встречи tab + Right sidebar «Ближайшая» |
| Meeting завершена + Deal stage двинулась | Activity log + sidebar NBA |
| Estimate v1 sent | Client Card → Сметы tab, status=sent, sentAt |
| Estimate approved (online) | Sales Funnel → Deal переехала в «Выиграна», notifications |
| Project создан auto | Deal card: «Converted to project» link, Project page: auto-filled |
| Tasks созданы из estimate | Project → Tasks tab: все позиции уже есть |
| Folder tree создан | Project → Files tab: дерево папок `/_project-docs/`, `/_photos/`, `/tasks/...` |
| Первый Invoice (аванс) | Project → Invoices tab, статус=draft → sent → paid |
| Work Act v1 подписан | Project → Acts tab, chain «подписан 2026-05-12» |
| Follow-up Invoice (черновой) | Авто-триггер после акта |
| Final Act + final Invoice | Project → close-out page |
| Reconciliation | Project → P&L tab (план vs факт) |

---

## 7. Non-Goals (умышленно НЕ делаем)

- **Tender / Bid / Subcontractor** — §9 спеки. Отдельный модуль, запускать только по сигналу (реальный субчик просит).
- **Telegram unified inbox** — §11 спеки. Огромный scope, отдельно.
- **Bi-directional Google Calendar sync** — только calendarEventId поле, sync Job — later.
- **Automated ChangeOrder suggestion from AI** — ручная форма пока.
- **Client portal phase-aware UX (§12)** — за исключением estimate approval + act sign, остальное later.
- **Site dashboard с Gantt** — отдельная спека.
- **Full refactor `gtd_tasks` → `production_items`** — сосуществование ок, не принуждаем.

---

## 8. Risks & Trade-offs

**🔴 High-risk PRs:**
- **2.5 Deal → Project auto-creation** — trigger на deals с writes to projects + deals. CLAUDE.md §2.1 infinite-loop risk. Обязательно idempotency guard + field-change check.
- **2.7 Payment schedule + auto invoice** — деньги-чувствительный код. Bug может создать фейковые invoices или пропустить их. Нужны unit tests 30+.
- **2.10 Work Act flow** — подпись клиента = юридический документ. Audit log обязателен, невозможность переподписать.

**🟡 Medium-risk:**
- **2.3 Task flags + Estimate from tasks** — большой UI + backend. Могут сломать существующий estimate builder. Feature flag `VITE_USE_ESTIMATE_V2_BUILDER=true` на переходный период.

**🟢 Low-risk:**
- 2.1, 2.2, 2.6, 2.9, 2.11, 2.12 — читают/пишут в отдельные коллекции, без каскадных триггеров.

---

## 9. Metrics of success

После MVP End-to-End (~42ч):
- [ ] Реальный клиент прошёл от создания до первого Invoice **без ручных copy-paste**
- [ ] Создал 10 задач с billable flag, смета собралась за 30 секунд
- [ ] Approve на публичной ссылке → Project создался за 5 секунд
- [ ] Первый Invoice сгенерирован автоматически, sum = 30% от estimate

После полного flow (~80ч):
- [ ] 0 ручных переносов данных между сущностями в весь жизненный цикл
- [ ] Акт подписан клиентом онлайн → next invoice сгенерился и ушёл автоматом
- [ ] Close-out page показывает план/факт variance
- [ ] Менеджер NPS ≥ 8 после 2 недель

---

## 10. Open Questions

1. **Estimate версии — одна collection или цепочка?** Предлагаю: новая версия — новый doc с `parentVersionId`. Иначе merge conflict'ы.
2. **Payment schedule template — 3 дефолта или конструктор?** 3 дефолта на старте + кнопка «Custom».
3. **Work Act — шаблон PDF где?** Firebase Storage + template engine (handlebars?) или сгенерить из Google Docs template? Начнём с простого HTML→PDF через puppeteer/playwright.
4. **Portal auth — magic link или QR?** Magic link уже есть (share_tokens). Достаточно.
5. **Folder tree на create или on-demand?** On-create → сразу видит готовую структуру. Но лишние Firestore writes. Предлагаю on-create + skip если уже существует.
6. **ProductionItem отдельно от Task — точно?** Да. Task — список дел (GTD), ProductionItem — единица cost accounting. Разные concerns.

---

## 12. 🔍 Audit: что УЖЕ работает из time-tracking

Перечитал код после вопроса Дениса. Стало понятно, что некоторые gap'ы из §8 (ProductionItem) меньше, чем я изначально оценил.

### 12.1. `work_sessions` — фундамент уже есть

Поля в `WorkSession` interface (`src/types/timeTracking.types.ts`):
- ✅ `clientId` + `clientName` — клиент-уровень агрегации
- ✅ `projectId` + `projectName` — проект-уровень
- ✅ `relatedTaskId` — таск-уровень (в TS типе; в Zod schema на бэке **нет** — см. §12.3 ниже)
- ✅ `hourlyRate` — ставка сотрудника (snapshot на момент сессии)
- ✅ `sessionEarnings` — вычисленная стоимость сессии
- ✅ `durationMinutes` — длительность
- ✅ Break tracking, geo, selfie, voice transcription, face match, finalization lifecycle

На проде **297ч данных** сидит в `work_sessions`. Это бесплатный источник facts.

### 12.2. `gtd_tasks` уже имеет plan/fact поля

Поля на задаче (`src/types/gtd.types.ts`):
- ✅ `estimatedDurationMinutes` — план часов
- ✅ `actualDurationMinutes` — факт часов
- ✅ `hourlyRate` (приоритет task → user)
- ✅ `budgetAmount` — клиентская цена позиции (план дохода)
- ✅ `paidAmount` — оплачено из этой позиции
- ✅ `materialsCostPlanned` / `materialsCostActual` — материалы plan/fact
- ✅ `progressPercentage` — прогресс

### 12.3. Чего НЕТ — агрегаторов

**Trigger, который обновляет `gtd_tasks.actualDurationMinutes` на основе завершённых `work_sessions`, НЕ СУЩЕСТВУЕТ.** Grep по `functions/src/triggers` и `functions/src/scheduled` ничего не нашёл.

Также `relatedTaskId` **не в Zod schema** `timeTrackingSchemas.ts` — сейчас пишется только из frontend TS. API его не валидирует и не использует для чего-либо полезного на backend.

### 12.4. Следствие — §8 ProductionItem становится SMALLER

Изначально я предлагал создать **новую коллекцию `production_items`**, которая аггрегирует labor и materials. Это был scope 12-15ч.

**С учётом §12.1-12.2 это не нужно.** Можно заменить на гораздо более дешёвый PR:

### 12.5. Замена §8 — новый PR «aggregate-time-and-materials-on-tasks» (~4-5ч)

**Scope:**
1. **Добавить `relatedTaskId` в Zod schema** `timeTrackingSchemas.ts` (Create + Update)
2. **Firestore trigger `onWorkSessionCompleted`**:
   - Watches `work_sessions`
   - On `status: 'active' → 'completed'`: если `relatedTaskId` set →
     - `gtd_tasks/{taskId}.actualDurationMinutes` += `session.durationMinutes`
     - `gtd_tasks/{taskId}.actualLaborCost` (new field) += `session.sessionEarnings`
   - On session void: decrement обратно (через `beforeVoid` snapshot в audit log)
   - **Idempotency guard** (CLAUDE.md §2.1): store `processedSessionIds` on task OR use session's `finalizationStatus='processed'` transition instead of completed
3. **Firestore trigger `onCostCreated` with `relatedTaskId`**:
   - Already exists partially? Need to verify — `calculateActualCost.ts` уже есть
   - Если cost имеет `relatedTaskId` + category='materials' → `gtd_tasks/{taskId}.materialsCostActual` += `cost.amount`
4. **Backfill script** для 297ч существующих `work_sessions`:
   - `scripts/backfill-task-actuals.ts --dry-run / --commit`
   - Для каждой completed session с `relatedTaskId` → add to task.actualDurationMinutes/LaborCost
   - Идемпотентно через `session.finalizationStatus='processed'` marker

**Acceptance:**
- [ ] `onWorkSessionCompleted` trigger deployed, idempotent
- [ ] Existing 297ч сессий backfilled — `gtd_tasks.actualDurationMinutes` > 0 для связанных задач
- [ ] UI: таблица «План/Факт» в `ClientOverviewTab` показывает agg для каждой задачи проекта
- [ ] Unit test: session with relatedTaskId → task.actualDurationMinutes increments by session.durationMinutes

**Эффорт:** 4-5ч вместо 12-15ч.

### 12.6. Пересчёт критического пути

Критический путь **уменьшается с 80ч до ~70ч** потому что:
- §8 (ProductionItem) убирается целиком (−12-15ч)
- На его место §12.5 (Aggregator) добавляется (+4-5ч)

Новый критический путь до полной end-to-end автоматизации: **~65-75ч**, из них MVP до первой оплаты — ~36-42ч.

### 12.7. Pricing консистентность

Заметил: `client.ltv` (в Client Card V2) сейчас считается как `SUM(invoices WHERE status=paid)`. Но можно было бы также считать `SUM(work_sessions.sessionEarnings WHERE clientId=X)` для сравнения с LTV — это даёт **labor-portion of revenue** для client.

Не критично, но в §11 Close-Out page можно показать:
- Revenue (invoices paid)
- Labor cost realised (sum work_session earnings)
- Materials cost (sum costs materials)
- = Margin

Это **уже всё есть в данных**, только не агрегируется в один report. Еще +2-3ч если захотим.

---

## 11. References

- Parent spec: [`CRM_OVERHAUL_SPEC_V1.md`](./CRM_OVERHAUL_SPEC_V1.md) §3-11
- Existing Client Card V2: [`CLIENT_CARD_V2_SPEC.md`](./CLIENT_CARD_V2_SPEC.md) — Phase 1 shipped 2026-04-19
- Meetings module (shipped PR #31): `functions/src/agent/routes/meetings.ts`
- Warehouse V3 Phase 0 (shipped): [`WAREHOUSE_SPEC_V3.md`](./WAREHOUSE_SPEC_V3.md) — reference для phased rollout
- CLAUDE.md §2.1: idempotency triggers
- Master plan: [`MASTER_PLAN_2026-04-19.md`](./MASTER_PLAN_2026-04-19.md)
