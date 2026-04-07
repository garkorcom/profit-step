# 🚀 src/components/ — Улучшения Компонентов

## 🔴 Критические

### 1. Декомпозиция крупных компонентов

| Компонент | Строк | Действие |
|-----------|-------|----------|
| `GTDSubtasksTable.tsx` | 1216 | Извлечь SubtaskRow, SubtaskFilters, SubtaskBulkActions |
| `GTDEditDialog.tsx` | 1137 | Извлечь табы: GeneralTab, SubtasksTab, HistoryTab, MaterialsTab |
| `BlueprintUploadDialog.tsx` | 1091 | Извлечь FileDropzone, ProcessingStatus, ResultsPreview |
| `GTDBoard.tsx` | 850 | Извлечь BoardHeader, BoardFilters, EmptyState |
| `GTDColumn.tsx` | 593 | Ок, но можно извлечь ColumnHeader |

### 2. Barrel exports для всех папок
Создать `index.ts` для: `admin/`, `crm/`, `estimates/`, `expenses/`, `finance/`, `tasks/`

---

## 🟡 Среднесрочные

### 3. Reusable Dialog Pattern
У проекта 15+ диалоговых окон. Создать базовый `BaseDialog`:
```tsx
<BaseDialog
  title="Edit Client"
  open={open}
  onClose={onClose}
  onSubmit={onSubmit}
  loading={loading}
  maxWidth="md"
>
  <form>...</form>
</BaseDialog>
```

### 4. Form Validation
Сейчас валидация ручная. Стандартизировать:
- `react-hook-form` уже в зависимостях — использовать везде
- Добавить `zod` для frontend валидации (уже есть на backend)

### 5. Скелетоны
Создать `<TableSkeleton>`, `<CardSkeleton>`, `<FormSkeleton>` для единообразного loading state.

---

## 🟢 Долгосрочные

### 6. Accessibility (a11y)
- Добавить `aria-label` ко всем интерактивным элементам
- Keyboard navigation в GTD Board
- Screen reader support в диалогах

### 7. Тестирование
- Unit тесты для ключевых компонентов (GTDTaskCard, StatCard)
- Snapshot тесты для диалогов
- E2E через Cypress

### 8. Storybook
Визуальный каталог компонентов. Приоритетные:
- `StatCard`, `StatusIndicator`, `KPICard`
- `GTDTaskCard`, `TaskSquare`
- Все диалоги (ClientEdit, CreateSession, etc.)
