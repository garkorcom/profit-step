# 🚀 src/hooks/ — Улучшения Custom Hooks

## 🔴 Критические

### 1. Exhaustive Dependencies
11 хуков имеют ошибку `exhaustive-deps` — отсутствующие зависимости в useEffect. 
Это приводит к **stale closures** и непредсказуемому поведению.

Файлы для исправления:
- `useExpensesBoard.ts`
- `useClientDashboard.ts`  
- `useGTDTasks.ts`
- `useSessionManager.ts`

### 2. Error Handling
Большинство хуков игнорируют ошибки (catch → console.error). 
Добавить возврат `error` из всех хуков:

```tsx
return { data, loading, error, refetch };
```

---

## 🟡 Среднесрочные

### 3. Абстрактный хук `useFirestoreCollection`
Много дублирования запросов к Firestore. Создать:

```tsx
const { data, loading, error } = useFirestoreCollection<Client>({
  path: 'clients',
  where: [['companyId', '==', companyId]],
  orderBy: ['name', 'asc'],
  realtime: true,
});
```

### 4. Тестирование хуков
Тесты есть только в `__tests__/`. Покрыть:
- `useActiveSession` — поведение при активной/неактивной сессии
- `useGTDTasks` — CRUD операции, фильтрация
- `useSessionManager` — start/stop/pause lifecycle

### 5. Документирование
JSDoc для каждого хука:
```tsx
/**
 * @hook useActiveSession
 * @description Следит за активной рабочей сессией текущего пользователя
 * @returns {session, loading, error, startSession, stopSession}
 * @example
 * const { session, loading } = useActiveSession();
 */
```

---

## 🟢 Долгосрочные

### 6. Оптимизация перерендеров
Использовать `useMemo` и `useCallback` для дорогих вычислений.

### 7. React Query миграция
Заменить хуки `useEffect + onSnapshot` на TanStack Query + Firestore adapter.
