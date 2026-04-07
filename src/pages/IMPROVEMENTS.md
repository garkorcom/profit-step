# 🚀 src/pages/ — Улучшения Страниц

## 🔴 Критические

### 1. Декомпозиция гигантских страниц

7 файлов свыше 1000 строк. Они **невозможны** для code review и дебага.

#### BankStatementsPage.tsx (3105 строк → 5 компонентов)
```
BankStatementsPage.tsx          → BankStatementsPage.tsx (контейнер, 200 строк)
├── BankStatementUpload.tsx     — Загрузка CSV/PDF (400 строк)
├── TransactionList.tsx         — Таблица транзакций + фильтры (500 строк)
├── CategoryEditor.tsx          — Присвоение категорий (AI + manual) (400 строк)
├── TaxReportView.tsx           — Налоговый отчет (500 строк)
└── BankStatementPdfExport.tsx  — Генерация PDF (600 строк)
```

#### UnifiedCockpitPage.tsx (2017 строк → 6 компонентов)
```
UnifiedCockpitPage.tsx       → UnifiedCockpitPage.tsx (контейнер, 300 строк)
├── CockpitHeader.tsx        — Заголовок + статус (200 строк)
├── CockpitTimerTab.tsx      — Таймер и сессии (400 строк)
├── CockpitNotesTab.tsx      — Заметки и чеклисты (300 строк)
├── CockpitFilesTab.tsx      — Файлы и фото (300 строк)
└── CockpitFinanceTab.tsx    — Расходы и материалы (400 строк)
```

#### GTDCreatePage.tsx (1678 строк → 4 компонента)
```
GTDCreatePage.tsx → GTDCreatePage.tsx (wizard container, 300 строк)  
├── TaskFormSections.tsx   — Секции формы (500 строк)
├── AiDraftSection.tsx     — AI генерация (400 строк)
└── TaskPreview.tsx        — Превью перед созданием (300 строк)
```

### 2. Удалить мертвые placeholder-страницы
В AppRouter 5 заглушек `<div>Coming Soon</div>`. Либо сделать, либо убрать.

---

## 🟡 Среднесрочные

### 3. Унифицировать паттерн страницы
Все страницы должны следовать единому паттерну:
```tsx
const MyPage = () => {
  const { data, loading, error } = useMyHook();
  
  if (loading) return <PageSkeleton />;
  if (error) return <ErrorMessage error={error} />;
  
  return <MyPageContent data={data} />;
};
```

### 4. Skeleton Loading
Вместо `<CircularProgress />` использовать MUI `<Skeleton>` для каждой страницы.

### 5. CalendarPage.tsx — подключить или удалить
43KB файл, не подключен к роутеру.

---

## 🟢 Долгосрочные

### 6. SSR / SSG для публичных страниц
`ClientPortalPage`, About, Blog — кандидаты для серверного рендеринга (SEO).

### 7. URL-based state
Фильтры и параметры доски задач должны сохраняться в URL (для шаринга ссылок).
