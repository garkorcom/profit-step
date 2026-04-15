# Аудит Reconciliation Hub — Баги, Логика, Доработки

**Файлы:** `src/pages/crm/ReconciliationPage.tsx` (894 строки), `functions/src/agent/routes/finance.ts` (268 строк)  
**Дата аудита:** 2026-04-15  
**Статус:** Waiting for Denis approval

---

## A. БАГИ (ломают данные / дают неверные цифры)

### A1. `costs.clientId` хранит projectId — путаница в данных
**Файл:** `finance.ts:183`  
**Проблема:** При approve записывается `clientId: t.projectId`. В коллекции `costs` поле `clientId` на самом деле содержит ID проекта, а не клиента. Это ломает любые запросы `costs.where('clientId', '==', actualClientId)` — они ничего не найдут.  
**Влияние:** ClientExpensesTab, CostsReportPage, API `/api/projects/status` — везде, где `costs` фильтруется по `clientId`.  
**Фикс:** Сохранять оба поля:
```javascript
clientId: projectDoc.clientId,  // настоящий clientId из проекта
projectId: t.projectId,         // projectId
```
**Сложность:** Средняя. Нужна миграция существующих ~300 costs записей.

---

### A2. Нет идемпотентности на approve — дубли costs при двойном клике
**Файл:** `finance.ts:157-231`  
**Проблема:** Endpoint не проверяет, уже ли `bank_transactions.status === 'approved'` перед созданием нового `costs` документа. При повторном вызове (retry, double-click) создаётся дубль.  
**Сравнение:** Batch endpoint (строка 126) проверяет `approvedIds`, approve — нет.  
**Фикс:** В начале цикла проверять текущий статус:
```javascript
const refs = chunk.map(t => db.collection('bank_transactions').doc(t.id));
const snaps = await db.getAll(...refs);
const alreadyApproved = new Set(snaps.filter(s => s.data()?.status === 'approved').map(s => s.id));
// skip if alreadyApproved.has(t.id)
```
**Сложность:** Низкая (30 мин)

---

### A3. "Без кат." фильтр ничего не ловит
**Файл:** `ReconciliationPage.tsx:434`  
**Код:** `result.filter(t => !t.projectId && !t.paymentType)`  
**Проблема:** Каждая транзакция имеет `paymentType` (company/cash), поэтому `!t.paymentType` всегда false. Фильтр показывает 0 записей.  
**Фикс:** Фильтровать по отсутствию категории или проекта:
```javascript
// "Без проекта" — company расходы не привязанные к проекту
result.filter(t => t.paymentType === 'company' && !t.projectId)
```
**Сложность:** Низкая (5 мин)

---

### A4. Счётчики в toggle-кнопках игнорируют фильтр месяца
**Файл:** `ReconciliationPage.tsx:399-408`  
**Проблема:** `filterStats` считает от `enrichedTransactions` (все данные). Выбрал "Январь 2026 (134)", кнопка показывает "TAMPA (15)" — но 15 это Tampa за ВСЕ месяцы, не за январь. Карточки сверху показывают $55K (правильно, по фильтру), а кнопки — полные числа. Путаница.  
**Фикс:** Считать `filterStats` от `monthFiltered` (после month filter, до quick filter):
```javascript
const monthFiltered = filterMonth !== 'all'
  ? enrichedTransactions.filter(t => getMonthKey(t.date) === filterMonth)
  : enrichedTransactions;
const filterStats = useMemo(() => ({
  tampa: calc(monthFiltered.filter(...)),
  ...
}), [monthFiltered]);
```
**Сложность:** Низкая (15 мин)

---

### A5. "Утвердить Tampa" игнорирует текущий фильтр месяца
**Файл:** `ReconciliationPage.tsx:296-297`  
**Код:** `enrichedTransactions.filter(t => isTampaArea(t._location) && t.status === 'draft')`  
**Проблема:** Выбран январь, нажимаю "Tampa (15)" — утверждает Tampa из ВСЕХ месяцев, не только отфильтрованных.  
**Фикс:** Использовать `filteredTransactions` вместо `enrichedTransactions`:
```javascript
const tampaList = filteredTransactions.filter(t => isTampaArea(t._location));
```
**Сложность:** Низкая (5 мин)

---

### A6. Personal расходы при approve не создают запись в costs
**Файл:** `finance.ts:173`  
**Код:** `if (t.paymentType === 'company' && t.projectId)`  
**Проблема:** Личные расходы ($95K) просто помечаются `status: approved` в bank_transactions, но НЕ создают запись в `costs`. Они не попадают ни в один отчёт — чёрная дыра. Невозможно потом найти "сколько Вася потратил личного".  
**Фикс:** Создавать `costs` запись для всех типов (убрать условие `paymentType === 'company'`), но с разными полями:
```javascript
// Всегда создаём cost
const costRef = db.collection('costs').doc();
batch.set(costRef, {
  ...commonFields,
  paymentType: t.paymentType,  // сохраняем тип
  projectId: t.projectId || null,
  clientId: resolvedClientId,
});
```
**Сложность:** Средняя (нужно продумать влияние на отчёты)

---

### A7. CSV export не экранирует запятые в данных
**Файл:** `ReconciliationPage.tsx:489-499`  
**Проблема:** `cleanMerchant`, `_location` и другие поля не обёрнуты в кавычки. Если merchant = "Walmart, Inc." — CSV парсер сломается. Только `rawDescription` экранируется.  
**Фикс:** Обернуть все поля:
```javascript
const escCSV = (s: string) => `"${s.replace(/"/g, '""')}"`;
const rows = filteredTransactions.map(t => [
  escCSV(renderDate(t.date)),
  escCSV(t.cleanMerchant || ''),
  ...
]);
```
**Сложность:** Низкая (10 мин)

---

## B. UX ПРОБЛЕМЫ (не баги, но путают пользователя)

### B1. Нет подтверждения на "Утвердить всё"
**Файл:** `ReconciliationPage.tsx:234`  
**Проблема:** Кнопка "Утвердить всё" сразу утверждает все 432 (или отфильтрованные) транзакции. Одно нажатие — необратимое действие без confirm.  
**Фикс:** Добавить `window.confirm` как у Tampa approve:
```javascript
if (!window.confirm(`Утвердить ${filteredTransactions.length} транзакций?`)) return;
```

---

### B2. Нет индикатора несохранённых изменений
**Файл:** `ReconciliationPage.tsx:194`  
**Проблема:** `handleUpdate` меняет только React state. Если пользователь поменял категорию у 20 строк и перезагрузил страницу — всё потеряно. Нет визуального признака "есть несохранённые правки".  
**Фикс:** Трекить `dirtyIds: Set<string>`. Показывать точку/бейдж на строке. При уходе со страницы — `beforeunload` предупреждение.

---

### B3. Approved view показывает только последние 50
**Файл:** `ReconciliationPage.tsx:175`  
**Проблема:** `limit(50)` для approved. Нет пагинации/загрузки следующих. За месяц может быть 300+ утверждённых — большинство невидимы.  
**Фикс:** Убрать `limit(50)`, использовать ту же пагинацию как для draft. Или cursor-based pagination.

---

### B4. Split ломает данные при approve
**Файл:** `ReconciliationPage.tsx:198-211`  
**Проблема:** Split создаёт виртуальные ID `${id}_splitA` / `${id}_splitB`. `prepareForApi` strip'ит суффикс (строка 217). При approve splitA → API получает original id с половинной суммой → Firestore обновляет ОРИГИНАЛЬНЫЙ документ с ПОЛОВИННОЙ суммой. SplitB при approve перезапишет ту же запись. Данные повреждаются.  
**Фикс:** Split должен создавать РЕАЛЬНЫЕ документы в Firestore (через API endpoint), а не виртуальные клиентские.

---

## C. МЁРТВЫЙ КОД (не ломает, но мусорит)

### C1. Unused imports: `FormControlLabel`, `Switch`
**Строка 7:** Остались после удаления "Скрыть возвраты" тоггла.

### C2. Dead state: `hideReturns`
**Строка 151:** State `hideReturns` и фильтр (строка 417) — UI удалён, код остался.

### C3. Unused import: `FilterListIcon`
Если filter icon больше не нужен в UI.

---

## D. ДОРАБОТКИ (новый функционал)

### D1. Сохранение правок в Firestore ДО approve
**Сейчас:** Все правки (тип, категория, сумма) — только в React state. Потеряются при reload.  
**Предложение:** Auto-save в Firestore с debounce 2сек. Или кнопка "Сохранить черновик". Это позволит работать с reconciliation в несколько подходов.

### D2. Привязка Personal расходов к сотруднику
**Из оригинального ТЗ Phase 2, пункт 7.** Новая колонка "Сотрудник" для `paymentType === 'cash'`. Select с именами. При approve → вычет из зарплаты.

### D3. Группировка по категории/месяцу
**Из оригинального ТЗ Phase 3.** Toggle: "Группировать по категории" → collapsible rows с subtotals. Полезно для бухгалтера.

### D4. Date Range вместо одного месяца
**Из оригинального ТЗ Phase 2, пункт 10.** Квартальные отчёты невозможны без диапазона дат.

---

## E. ПРИОРИТЕТЫ

| # | Что | Тип | Влияние | Время |
|---|-----|-----|---------|-------|
| **A2** | Idempotency approve | Баг | Дубли costs | 30 мин |
| **A3** | Фильтр "Без кат." | Баг | UX | 5 мин |
| **A4** | filterStats по месяцу | Баг | UX | 15 мин |
| **A5** | Tampa approve по фильтру | Баг | Данные | 5 мин |
| **A7** | CSV экранирование | Баг | Экспорт | 10 мин |
| **B1** | Confirm "Утвердить всё" | UX | Безопасность | 5 мин |
| **C1-C3** | Мёртвый код | Чистота | — | 5 мин |
| **A1** | costs.clientId fix | Баг | Отчёты | 2-3 часа |
| **A6** | Personal → costs | Баг | Отчёты | 1-2 часа |
| **B3** | Approved pagination | UX | — | 30 мин |
| **B4** | Split fix | Баг | Данные | 2 часа |
| **B2** | Dirty indicator | UX | — | 1 час |

**Quick wins (< 1 час, можно сделать сейчас): A2, A3, A4, A5, A7, B1, C1-C3**
