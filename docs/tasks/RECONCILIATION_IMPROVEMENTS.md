# ТЗ: Улучшение Reconciliation Hub

**Страница:** `/crm/reconciliation` — `src/pages/crm/ReconciliationPage.tsx`  
**Дата:** 2026-04-15  
**Приоритет:** Medium  
**Текущее состояние:** 850 строк, работает, но UX перегружен

---

## 1. ПРОБЛЕМЫ (из скриншота + код-анализ)

### 1.1 Фильтры обрезаются
Quick filter tabs (ALL / TAMPA / COMPANY / PERSONAL / ТОПЛИВО / НЕРАЗНЕСЁННЫЕ / ВОЗВРАТЫ) не помещаются на экране — последние кнопки уезжают за правый край. Нет скролла.

### 1.2 Нет поиска по тексту
433 транзакции, но нельзя найти конкретный магазин. Приходится глазами искать "SHELL" или "HOME DEPOT" в длинном списке.

### 1.3 Нет пагинации
Все 433 записи рендерятся одновременно. На слабых устройствах тормозит, скролл бесконечный.

### 1.4 Summary cards не реагируют на фильтры
Карточки Tampa/Company/Personal/Total всегда показывают суммы по ВСЕМ данным, даже когда выбран фильтр "ТОПЛИВО (45)" — карточки не обновляются.

### 1.5 Нет привязки Personal расходов к сотруднику
Personal расходы ($95K) — вычитаются из зарплаты, но нет колонки "Кому" (какому работнику вычесть). Сейчас все личные расходы — "просто личные", без привязки.

### 1.6 Amount — HTML input вместо MUI
`<input type="number">` прямо в таблице. Выглядит как чужеродный элемент, нет валидации, нет форматирования.

### 1.7 Нет bulk-операций
Нельзя выбрать 10 строк и массово поменять категорию или тип средств. Каждая строка — отдельный Select.

### 1.8 Export только PDF
Нет CSV/Excel — а для бухгалтера или CPA это основной формат.

### 1.9 Нет диапазона дат
Только выбор месяца из dropdown. Нельзя выбрать "с 1 марта по 15 апреля" для квартального отчёта.

### 1.10 Карточки не кликабельны
Summary cards (Tampa $141K, Company $313K) визуально выглядят как кнопки, но не фильтруют при клике.

---

## 2. ПЛАН УЛУЧШЕНИЙ

### Phase 1 — Quick Wins (1-2 часа)

| # | Что | Описание |
|---|-----|----------|
| 1 | **Пагинация** | MUI TablePagination, 50 строк/страница, выбор 25/50/100 |
| 2 | **Поиск** | TextField над таблицей, фильтр по `rawDescription + cleanMerchant + _location`. Debounce 300ms |
| 3 | **Фильтры в 2 строки или scroll** | Обернуть ToggleButtonGroup в `overflow-x: auto` с `flexWrap: nowrap`, или разбить на 2 ряда |
| 4 | **Summary обновляются по фильтру** | `summaryData` считать от `filteredTransactions` вместо `enrichedTransactions` |
| 5 | **Карточки-фильтры** | Клик по карточке Tampa → `setQuickFilter('tampa')`. Active state = яркая граница |
| 6 | **MUI TextField для Amount** | Заменить `<input>` на `<TextField size="small" type="number" InputProps={{ startAdornment: '$' }} />` |

### Phase 2 — Функциональность (3-4 часа)

| # | Что | Описание |
|---|-----|----------|
| 7 | **Привязка к сотруднику** | Новая колонка "Сотрудник" для `paymentType === 'cash'` (Personal). Select с именами из `employees/users`. Сохраняется как `assignedEmployeeId` на `bank_transactions`. При approve → создаёт запись в `work_sessions` с `type: 'expense_deduction'` для вычета из баланса |
| 8 | **Bulk Select + Actions** | Checkbox на каждой строке + toolbar сверху: "Выбрано N → Изменить категорию / Изменить тип / Утвердить выбранные" |
| 9 | **CSV Export** | Кнопка рядом с PDF. Формат: Date, Merchant, Location, Amount, Type, Category, Project. UTF-8 BOM для Excel |
| 10 | **Date Range Picker** | MUI DatePicker "от" / "до" вместо (или в дополнение к) Select месяца. Для квартальных/годовых отчётов |

### Phase 3 — Polish (2-3 часа)

| # | Что | Описание |
|---|-----|----------|
| 11 | **Sticky header** | `stickyHeader` на Table. При скролле заголовки остаются видны |
| 12 | **Сортировка по колонкам** | Клик по заголовку "Дата" / "Сумма" / "Контрагент" → asc/desc. Убрать отдельную кнопку "По сумме" |
| 13 | **Группировка** | Toggle: "Группировать по категории" или "по месяцу". Collapsible rows с subtotals |
| 14 | **Keyboard shortcuts** | `Ctrl+A` = select all, `Enter` = approve selected, `Esc` = clear filters |
| 15 | **Mobile responsive** | На <768px: карточки в 2×2 grid, таблица → card-list view, фильтры в Drawer |

---

## 3. ACCEPTANCE CRITERIA (Phase 1)

1. Таблица показывает 50 строк с пагинацией внизу
2. Текстовый поиск фильтрует по merchant/description/location за <300ms
3. Все quick filter кнопки видны (scroll или wrap)
4. Summary cards обновляются при смене фильтра
5. Клик по карточке активирует соответствующий фильтр
6. Amount input — MUI TextField с `$` prefix
7. Все существующие фичи работают без регрессий (approve, undo, split, export PDF, verify)

## 4. ACCEPTANCE CRITERIA (Phase 2)

8. Personal расходы можно привязать к сотруднику через Select
9. При approve personal расхода с сотрудником → в work_sessions пишется запись для вычета
10. Checkbox на строках + toolbar с bulk-actions (категория, тип, approve)
11. CSV export открывается в Excel без кракозябр (UTF-8 BOM)
12. Date range picker работает корректно с Firestore Timestamp

---

## 5. ФАЙЛЫ ДЛЯ ИЗМЕНЕНИЯ

| Файл | Что менять |
|------|-----------|
| `src/pages/crm/ReconciliationPage.tsx` | Основные UI-изменения, пагинация, поиск, bulk select |
| `firestore.indexes.json` | Возможно новый индекс для `bank_transactions: assignedEmployeeId + status` |
| `functions/src/agent/routes/finance.ts` | Расширить approve endpoint: сохранять `assignedEmployeeId`, создавать expense deduction |

---

## 6. ДИЗАЙН-РЕФЕРЕНС

Текущий layout хороший, менять кардинально не нужно. Улучшения:
- Фильтры: компактнее, в 1-2 строки с overflow
- Поиск: TextField с иконкой 🔍 слева от фильтра месяца  
- Пагинация: стандартная MUI внизу таблицы
- Карточки: добавить `cursor: pointer`, при hover — тень, при active — border 2px solid primary
- Bulk toolbar: Sticky bar сверху таблицы когда >0 строк выбрано (как Gmail)
