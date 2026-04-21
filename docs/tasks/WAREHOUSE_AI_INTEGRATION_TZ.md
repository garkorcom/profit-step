# ТЗ: AI-слой поверх существующего inventory

> **Статус:** TODO
> **Создано:** 2026-04-20
> **Источник:** cherry-pick полезных частей из закрытой ветки `feature/warehouse-rewrite` (PR #27, не merged)
> **Reference tag:** `archive/warehouse-rewrite-2026-04-20` — замороженная копия ветки с полным кодом; читать через `git show archive/warehouse-rewrite-2026-04-20:<path>`

---

## 0. TL;DR

В `feature/warehouse-rewrite` (PR #27) лежал полный переписной warehouse-модуль на 30K строк с ledger-engine, новыми коллекциями, параллельным UI и 24 коммитами. Мы **решили не мержить** его целиком — это создало бы две инвентарных системы в проде без migration plan, конфликтовало с главным `inventory` модулем и тянуло большую часть «уже есть, просто переписано».

Из всей ветки реально новое и ценное — **AI-слой** (parseIntent / planTrip / receipt OCR / voice / auto-writeoff) и **отчёты** (low-stock / dead-stock). Их нужно перенести **поверх существующего `inventory`** (коллекции `inventory_*`, routes `/api/inventory/*`), без создания параллельной `warehouse` инфраструктуры.

---

## 1. Что уже работает в main (не трогать)

**Inventory module:** `functions/src/agent/{routes,services,schemas}/inventory*.ts` (~2000 строк):
- Warehouses CRUD + Items CRUD + Norms CRUD
- Transactions (generic + task-linked)
- `write-off-by-norm` endpoint
- v3 API: transactions, barcode lookup, recalculate by catalog
- Frontend: `src/pages/InventoryPage.tsx`

**AI инфраструктура для бота:** `functions/src/triggers/telegram/` + Secret Manager bindings (см. `functions/src/config/secrets.ts`).

---

## 2. Что надо добавить (в порядке приоритета)

### 2.1 Phase A — Pre-trip planner (готов, нужно адаптировать)

Бригадир пишет боту «завтра еду на Amazon ставить 5 розеток и 3 выключателя» → AI парсит → подбирает материалы по нормам → показывает какие есть, какие докупить → бригадир confirm → создаётся trip-session в Firestore.

**Что взять из архивной ветки:**
- `functions/src/services/warehouseAI/` (5 файлов: `index.ts`, `types.ts`, `gemini.ts`, `prompts.ts`, `planTrip.ts`) ~1200 строк
- `functions/src/agent/routes/warehouseAI.ts` — 4 endpoints: `plan-trip`, `sessions/:userId`, `confirm`, `cancel`
- Tests: `functions/test/warehouseAI*.test.ts` — 38 unit tests

**Что адаптировать:**
- Заменить ссылки `wh_items`/`wh_locations`/`wh_norms` → `inventory_items`/`inventory_locations`/`inventory_norms` (canonical коллекции main)
- Добавить `{ secrets: [GEMINI_API_KEY] }` binding на route (по §Phase-1 правилам Secret Manager PR #55)
- Использовать `GEMINI_API_KEY.value()` вместо `process.env.GEMINI_API_KEY`

**Acceptance:**
- `POST /api/warehouse-ai/plan-trip` отвечает 200 на «завтра на Jim Dvorkin, 5 розеток» с `{items: [...], tripId, estimatedTotal}`
- Trip session пишется в `warehouse_ai_sessions/{userId}`, событие в `warehouse_ai_events`
- 38 unit tests passing
- Telegram-бот callback «✅ Подтвердить» → session.status = confirmed

---

### 2.2 Phase B — Receipt photo OCR (UC2)

Бригадир фотографирует чек в Telegram → Gemini Vision парсит позиции → добавляет stock + создаёт cost entry в finance.

**Что взять:**
- `functions/src/services/warehouseAI/receipt*.ts` (см. `archive/warehouse-rewrite-2026-04-20` — `improvements/05_receipt_vision/`)
- Prompts в `functions/src/services/warehouseAI/prompts.ts` (receipt schema)

**Интеграция:**
- Hook в `functions/src/triggers/telegram/handlers/mediaHandler.ts` — когда бригадир кидает фото с capcion «чек» или нажимает кнопку «📷 Чек» в warehouse-меню
- Parsed items → `POST /api/inventory/transactions` (новый incoming stock)
- Total amount → `POST /api/costs` (категория `materials`, привязка к clientId если активная сессия)

**Acceptance:**
- Фото чека из Home Depot → 3 позиции распознаны с названием/qty/unit/price
- Каждая позиция либо matchится на catalog items по name fuzzy-search, либо создаётся как «unmatched» с ручным подтверждением админа
- Cost entry появляется в `costs` коллекции, видно на странице Finance
- Confidence в ответе: `high|medium|low`. `low` требует ручного подтверждения.

---

### 2.3 Phase C — Voice on-site inventory (UC1)

Бригадир на объекте голосом: «добавил 10 метров кабеля 12AWG и забрал 5 выключателей» → транскрипция → парсинг → транзакции.

**Что взять:**
- Prompts и логика в `archive/warehouse-rewrite-2026-04-20:functions/src/services/warehouseAI/` + `improvements/06_onsite_voice/SPEC.md`
- Использует существующий `transcribeAudioWithRetry` из `mediaHandler.ts` (Gemini voice) — уже в main

**Интеграция:**
- Hook в воспроизведение `handleVoiceMessage` в `mediaHandler.ts`
- Парсер вызывается если активная сессия имеет флаг `inventoryMode: true`
- Каждая распознанная позиция → `POST /api/inventory/transactions` с `action: 'add'|'remove'`

**Acceptance:**
- Голосовое 15 сек → 2-3 позиции с qty, unit, action, locationId (из активной сессии)
- Если позиция не в catalog → telegram-бот спрашивает «такого товара нет в каталоге, добавить?»
- Undo: последняя голосовая транзакция откатываемая через /undo

---

### 2.4 Phase D — Auto-writeoff по нормам (UC3)

Task «поставить 5 розеток, заменить 2 выключателя» завершается → triggered Firestore trigger → auto-writeoff по нормам.

**Что взять:**
- Логика из `archive/warehouse-rewrite-2026-04-20:functions/src/warehouse/core/` — функция matchNorms + commit transaction
- `improvements/07_auto_writeoff/SPEC.md` — acceptance criteria

**Интеграция:**
- Уже есть endpoint `/api/inventory/write-off-by-norm` в main — переиспользовать
- Новый Firestore trigger `onTaskCompleted` (файл `functions/src/triggers/firestore/onTaskCompleted.ts`): `document('tasks/{taskId}').onUpdate` → если `status === 'completed'` и task имеет `materialsByNorm`, вызвать внутренний write-off
- Idempotency guard: проверять `task.writeOffCompleted === true` перед списанием

**Acceptance:**
- Закрытие task с нормами → создаются write-off transactions в `inventory_transactions`
- В UI задачи показывается список списанных материалов
- Повторное закрытие task не дублирует writeoff (idempotent)
- Если остатков не хватает — transaction создаётся с `status: 'needs_attention'`, admin получает Telegram alert

---

### 2.5 Phase E — Отчёты low-stock / dead-stock (UC6, UC8)

Scheduled Cloud Functions: еженедельно пятница 9:00 ET — low-stock отчёт на перезаказ; 1 число месяца — dead-stock analytics (позиции без движения > 90 дней).

**Что взять:**
- `archive/warehouse-rewrite-2026-04-20:functions/src/warehouse/scheduled/index.ts`
- `archive/warehouse-rewrite-2026-04-20:functions/src/warehouse/reports/`

**Интеграция:**
- Адаптировать под `inventory_items` + `inventory_transactions` (вместо `wh_balances` + `wh_ledger`)
- Результаты писать в `inventory_reports/{yyyy-mm-dd}` (новая коллекция)
- Отчёт отправляется в `ADMIN_GROUP_ID` Telegram chat и пишется в Firestore

**Acceptance:**
- `warehouseLowStockReport` scheduled запускается пятницу 9:00 ET → находит items с `totalStock < minStock` → сохраняет + шлёт в Telegram
- `warehouseDeadStockReport` 1 числа → находит items без transactions > 90 дней → отчёт включает «замороженный капитал» (sum value)

---

## 3. Архитектурные принципы (важно)

1. **НЕ создавать параллельный `warehouse` module.** Весь новый код кладём в `functions/src/services/warehouseAI/` и расширяем `functions/src/agent/routes/inventory.ts` (или новые routes начинающиеся на `/api/warehouse-ai/*` — только AI-слой, не CRUD).

2. **Коллекции — только канонические `inventory_*`.** Не создавать `wh_items`, `wh_balances`, `wh_ledger`. Ledger-idea можно реализовать позже как отдельный PR, но не в рамках AI-слоя.

3. **Secret Manager:** любая функция использующая AI (Gemini/Claude/OpenAI) **обязана** иметь `{ secrets: [GEMINI_API_KEY, ...] }` binding через `functions/src/config/secrets.ts`. См. `docs/ONBOARDING.md §7`.

4. **Feature flags:** `inventoryMode: boolean` в session + admin toggle `/admin/settings#inventory_ai` — чтобы можно было быстро отключить если AI начнёт галлюцинировать.

5. **Idempotency обязательна:** все writeoff/add транзакции должны иметь уникальный idempotency key (можно вывести из messageId telegram/taskId/sessionId). Одна и та же операция не может задвоиться.

6. **Observability:** каждая AI-операция пишет в `warehouse_ai_events` коллекцию с `{userId, intent, result, latencyMs, cost}`. Панель на admin dashboard показывает недельную аналитику.

---

## 4. Phased rollout

| Фаза | Время | Риск | Можно отдельно? |
|---|---|---|---|
| A — Pre-trip planner | 1 день (код готов, только адаптация) | Низкий — read-only, писаем только в `warehouse_ai_sessions` | ✅ Да, первый PR |
| B — Receipt photo OCR | 2 дня | Средний — пишет в `inventory_transactions` + `costs` | ✅ Второй PR |
| C — Voice on-site | 1.5 дня | Высокий — voice + inventory mutation | ⚠ после B с флагом |
| D — Auto-writeoff | 1 день | **Критичный** — автоматом меняет остатки | ❌ только после A-B-C, feature flag обязателен |
| E — Reports scheduled | 0.5 дня | Низкий — read-only | ✅ может параллельно |

Итого **~6 дней работы** (vs 30K строк warehouse-rewrite).

---

## 5. Что НЕ включаем в это ТЗ

- **Ledger-based переписывание inventory** — если потребуется, отдельное ТЗ с migration plan `inventory_transactions` → `inventory_ledger`
- **Vendors registry + RFQ webhook** — отдельная задача, привязанная к procurement workflow
- **Web sourcing** — зависит от выбора поставщика SDK (Home Depot, Lowe's, Amazon Business APIs)
- **Parallel `/warehouse` UI** — остаёмся на `InventoryPage.tsx`, доработаем его если нужно
- **CSV bulk import** — nice-to-have, если понадобится — можно достать из archive 1 день работы

---

## 6. Reference — как доставать код из archive

Ветка удалена, но код сохранён в теге:

```bash
# Посмотреть файл из архива
git show archive/warehouse-rewrite-2026-04-20:functions/src/services/warehouseAI/planTrip.ts

# Достать файл целиком в working directory
git checkout archive/warehouse-rewrite-2026-04-20 -- functions/src/services/warehouseAI/
git checkout archive/warehouse-rewrite-2026-04-20 -- functions/test/warehouseAI-*.test.ts

# Посмотреть структуру
git ls-tree -r --name-only archive/warehouse-rewrite-2026-04-20 | grep warehouseAI
```

Полный index файлов по фазам — в `archive/warehouse-rewrite-2026-04-20:docs/warehouse/MAIN_SPEC.md` и `USE_CASES.md`.

---

## 7. Acceptance criteria для всего ТЗ

- [ ] Phase A shipped + работает на проде
- [ ] Phase B shipped, бригадир присылает фото чека боту → stock updated + cost created
- [ ] Phase C shipped, голосовые транзакции работают
- [ ] Phase D shipped с feature flag, работает на 1 тестовой задаче без false writeoffs неделю
- [ ] Phase E shipped, еженедельные отчёты приходят в admin group
- [ ] Никаких `process.env.<SECRET>` вне `functions/src/config/` (checked by pre-commit hook)
- [ ] Нет параллельных коллекций `wh_*` — всё в `inventory_*`
- [ ] ≥80% unit test coverage на warehouseAI services
- [ ] Admin UI `/admin/settings` содержит toggle для каждой из AI-фич (можно отключить)

---

## 8. Кто делает

Задача подходит для `/pickup` workflow (CLAUDE.md §3.1). Маша пишет task spec по фазам (один task на каждую фазу), Никита имплементирует backend, Стёпа UI + тесты.

Или одной сессией в Claude Code Opus если человеко-часов достаточно.
