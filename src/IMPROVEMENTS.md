# 🚀 src/ — Улучшения Frontend

## 🔴 Критические

### 1. Миграция CRA → Vite
`react-scripts` (CRA) официально deprecated. Vite даст:
- **10x** быстрее Hot Module Replacement
- **Tree-shaking** на уровне ES modules
- Поддержка **React 19** Server Components (будущее)

```bash
# Шаги миграции:
# 1. npx @nicolo-ribaudo/vite-cra-migrate
# 2. Удалить react-scripts, react-app-rewired из package.json
# 3. Перенести .env переменные (REACT_APP_ → VITE_)
# 4. Обновить index.html (убрать %PUBLIC_URL%)
```

### 2. TypeScript 4.9 → 5.x
Frontend застрял на TS 4.9.5, backend уже на 5.x. Обновление даст:
- `satisfies` оператор
- `const type parameters`
- Лучший inference в generics

---

## 🟡 Среднесрочные

### 3. React Query / TanStack Query
Сейчас все API вызовы через `useEffect + useState`. TanStack Query даст:
- Автоматическое кеширование
- Дедупликация запросов
- Stale-while-revalidate
- Mutation hooks
- Loading/error states из коробки

### 4. Barrel Exports (`index.ts`)
Только 3 папки имеют `index.ts` (common, gtd, time-tracking). Добавить во все:
- `components/admin/index.ts`
- `components/crm/index.ts`
- `components/estimates/index.ts`
- `hooks/index.ts`
- `api/index.ts`

### 5. Error Boundary
Нет глобального Error Boundary. При краше одного компонента — падает всё приложение.
```tsx
<ErrorBoundary fallback={<CrashPage />}>
  <AppRouter />
</ErrorBoundary>
```

---

## 🟢 Долгосрочные

### 6. Storybook
Для такого количества компонентов (80+) нужен визуальный каталог.

### 7. Module Federation / Micro-frontends
При дальнейшем росте — разбить на независимые модули (CRM, Finance, Estimates).

### 8. PWA Offline Strategy
Расширить offline возможности — кеширование ключевых страниц и данных.
