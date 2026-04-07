# 🔍 Profit Step — Аудит Проекта (Отчет об Ошибках и Проблемах)

> Дата аудита: Апрель 2026  
> Инструменты: `npm run build`, `npm run lint` (oxlint), ручной анализ кода

---

## 📊 Сводка

| Метрика | Значение | Статус |
|---------|----------|--------|
| Frontend Build | ✅ PASS | Собирается без ошибок |
| Functions Build | ✅ PASS | Компилируется |
| Lint Errors | **165** | ⚠️ Требуют внимания |
| Lint Warnings | **510** | 🔶 Рекомендуется исправить |
| TODO/FIXME | **47** | 📝 Незакрытые задачи |
| "Гигантские" файлы (>1000 строк) | **7** | 🔴 Критично для поддержки |
| Дублированные маршруты | **6** | ⚠️ Баг |
| Deprecated файлы | **1** | 🧹 Убрать |

---

## 🔴 Критические проблемы

### 1. Гигантские файлы (>1000 строк)

Файлы свыше 1000 строк практически невозможно поддерживать и дебажить.

| Файл | Строк | KB | Рекомендация |
|------|------|----|-------------|
| `BankStatementsPage.tsx` | **3105** | 144 | Разбить на 5-6 компонентов: Upload, List, CategoryEditor, TaxReport, PDFExport |
| `onWorkerBotMessage.ts` | **2578** | 113 | Разбить на handler-модули (уже есть `handlers/` папка) |
| `UnifiedCockpitPage.tsx` | **2017** | 104 | Извлечь табы в отдельные компоненты: TimerTab, NotesTab, FilesTab |
| `ElectricalEstimatorPage.tsx` | **1894** | 107 | Разбить: RoomSelector, DeviceGrid, SummaryTable, PDFExport |
| `GTDCreatePage.tsx` | **1678** | 89 | Извлечь FormSections, AI Draft, Preview |
| `GTDSubtasksTable.tsx` | **1216** | 71 | Извлечь SubtaskRow, SubtaskFilters, BulkActions |
| `GTDEditDialog.tsx` | **1137** | 66 | Извлечь DialogTabs: General, Subtasks, History, Materials |

### 2. Дублированные маршруты в AppRouter.tsx

В `src/router/AppRouter.tsx` есть 3 пары дублей:

```diff
# Строка 207 и 215 — ДУБЛЬ:
  <Route path="/crm/gtd/:taskId" element={<UnifiedCockpitPage />} />
  ...
  <Route path="/crm/gtd/:taskId" element={<UnifiedCockpitPage />} />

# Строка 208 и 216 — ДУБЛЬ:
  <Route path="/crm/cockpit/:taskId" element={<UnifiedCockpitPage />} />
  ...
  <Route path="/crm/cockpit/:taskId" element={<UnifiedCockpitPage />} />

# Строка 214 и 218 — ДУБЛЬ (конфликт редиректов):
  <Route path="/crm/inbox" element={<Navigate to="/crm/tasks?view=board" replace />} />
  ...
  <Route path="/crm/inbox" element={<Navigate to="/crm/gtd" replace />} />
```

**Действие**: Удалить строки 215, 216, 218.

### 3. Мертвые маршруты (Placeholder'ы)

```tsx
<Route path="/crm/scheduler" element={<div>Scheduler (Coming Soon)</div>} />
<Route path="/projects" element={<div>Модуль "Проекты" в разработке</div>} />
<Route path="/tasks" element={<div>Модуль "Задачи" в разработке</div>} />
<Route path="/documents" element={<div>Модуль "Документы" в разработке</div>} />
<Route path="/reports" element={<div>Reports Hub (Coming Soon)</div>} />
```

**Действие**: Удалить или заменить на редиректы к существующим страницам.

---

## ⚠️ Серьезные проблемы

### 4. Lint — 165 ошибок по категориям

| Правило | Кол-во | Тип | Описание |
|---------|--------|-----|----------|
| `no-unused-vars` | **153** | Error | Неиспользуемые импорты и переменные |
| `exhaustive-deps` | **11** | Error | Отсутствующие зависимости в useEffect |
| `no-useless-escape` | **6** | Error | Бесполезные escape-символы |

**Топ файлы с ошибками `no-unused-vars`**:
- `TeamAdminPage.tsx` — 5+ неиспользуемых импортов (HeartIcon, FolderIcon, expandedDepts)
- `FinancePage.tsx` — пропущенные deps в useEffect
- `CompanyDashboard.tsx` — неиспользуемые компоненты
- `firebase.ts` — `initializeFirestore` imported but never used

### 5. Lint — 510 warnings по категориям

| Правило | Кол-во | Описание |
|---------|--------|----------|
| `no-explicit-any` | **482** | Использование `any` вместо конкретных типов |
| `prefer-set-has` | **7** | Массивы используемые для `.includes()` → заменить на `Set` |
| `preserve-caught-error` | **7** | Потеря оригинальной ошибки при re-throw |
| `no-useless-length-check` | **2** | Лишняя проверка `.length` |
| `no-array-reverse` | **2** | Мутативный `.reverse()` |
| Others | **10** | Остальные |

### 6. Рассогласование TypeScript версий

| Компонент | Версия | Файл |
|-----------|--------|------|
| Frontend | **4.9.5** | `package.json` |
| Backend | **5.x** | `functions/package.json` |

**Риск**: Разное поведение типов, особенно `satisfies`, `const type parameters`.
**Действие**: Обновить frontend до TypeScript 5.x.

### 7. Create React App (устаревший)

Проект использует `react-scripts 5.0.1` (Create React App), который **официально deprecated** (2024).

**Риски**:
- Нет поддержки новых фич React 19
- Медленная сборка (Webpack 5)
- Нет tree-shaking advanced
- Нет HMR оптимизаций

**Действие**: Мигрировать на **Vite** или **Next.js**.

---

## 🔶 Умеренные проблемы

### 8. Отключенные функции (закомментированные exports)

В `functions/src/index.ts` отключены:

| Функция | Причина |
|---------|---------|
| `monitorPaginationCosts` | "Too many Firestore reads" |
| `monitorFunctionLoops` | "Infinite loop fixed, monitoring not needed" |
| `sendSessionReminders` | "Session reminders turned off" |
| `onTelegramMessage` | Отключен (конфликт с OpenClaw) |
| `onWorkerBotMessage` | Отключен (конфликт с OpenClaw) |
| Rate Limiting в `inviteUser()` | "ВРЕМЕННО ОТКЛЮЧЕНО до полного построения индекса" |

**Действие**: Убрать закомментированный код или пометить `@deprecated` с датой.

### 9. Тестовые файлы в production директории

Файлы в `functions/`:
- `test_db.js`
- `test_db2.js`
- `test_db_final.js`
- `test_credentials.js`
- `investigate-victor.js`
- `check_sessions.js`

**Действие**: Перенести в `functions/test/` или `functions/__tests__/`.

### 10. Deprecated файл в src/api/

`src/api/_deprecated_projectApi.ts` — помечен как deprecated, но всё ещё в проекте.

**Действие**: Проверить что нигде не импортируется → удалить.

### 11. CalendarPage.tsx не в роутере

`src/pages/crm/CalendarPage.tsx` (43KB) существует, но **не подключен** к AppRouter. Возможно это legacy.

**Действие**: Добавить маршрут или удалить файл.

### 12. Двойная DnD библиотека

Frontend использует **обе** DnD библиотеки:
- `@hello-pangea/dnd` (18.0)
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`

**Действие**: Стандартизировать на одну библиотеку.

---

## 📝 TODO/FIXME в коде (47 штук)

### Незакрытые TODO:

| Файл | TODO | Приоритет |
|------|------|-----------|
| `index.ts:374` | Включить Rate Limiting когда индекс готов | 🔴 Высокий |
| `index.ts:461` | Получать название компании из БД (сейчас companyId) | 🟡 Средний |
| `sendMessage.ts:54` | Integrate with Meta Cloud API (WhatsApp) | 🟡 Средний |
| `qualityLoop.ts:74` | Отправить push notification контролеру | 🟡 Средний |
| `qualityLoop.ts:168` | Отправить уведомление исполнителю | 🟡 Средний |
| `BlueprintUploadDialog.tsx:1091` | Phase 2 — add client selector | 🟡 Средний |
| `GTDCreatePage.tsx:230` | Check active sessions for real availability | 🟡 Средний |
| `TeamAdminPage.tsx:1026` | Implement password reset | 🟡 Средний |
| `RolesPage.tsx:142` | Сохранение кастомных ролей в Firestore | 🟡 Средний |
| `SuperAdminPage.tsx:23` | Подключить real-time data из Firestore | 🟢 Низкий |
| `ShoppingListInput.tsx:155` | Implement camera capture | 🟢 Низкий |
| `DynamicFormField.tsx:209,239` | Camera capture + geolocation | 🟢 Низкий |
| `brevoStatusChecker.ts:79` | Implement Brevo API call | 🟢 Низкий |
| `templateMatcher.ts:31` | Add Firestore lookup when index created | 🟢 Низкий |
| `onWhatsAppMessage.ts:120` | Implement actual sending logic | 🟢 Низкий |

---

## 🧹 Рекомендации по приоритетам

### 🔴 Сделать немедленно
1. Удалить дублированные маршруты в AppRouter.tsx (5 мин)
2. Удалить неиспользуемые импорты — `npm run lint:fix` (10 мин)
3. Включить Rate Limiting для `inviteUser()` (создать Firestore индекс)

### 🟡 Сделать в ближайшие спринты
4. Декомпозировать гигантские файлы (начать с `BankStatementsPage.tsx`)
5. Убрать 482 `any` — заменить на конкретные типы
6. Добавить exhaustive-deps в useEffect (11 случаев)
7. Убрать тестовые файлы из корня `functions/`
8. Обновить TypeScript до 5.x на frontend

### 🟢 Техдолг (по мере возможности)
9. Миграция с CRA на Vite
10. Стандартизировать DnD библиотеку
11. Закрыть все TODO/FIXME
12. Удалить deprecated файлы
13. Подключить CalendarPage.tsx или удалить
