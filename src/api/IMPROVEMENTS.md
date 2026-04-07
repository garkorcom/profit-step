# 🚀 src/api/ — Улучшения API Layer

## 🔴 Критические

### 1. Удалить deprecated файл
`_deprecated_projectApi.ts` — мертвый код. Проверить зависимости → удалить.

### 2. Единообразная обработка ошибок
Сейчас ошибки обрабатываются по-разному в каждом файле. Создать:

```tsx
// src/api/apiUtils.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: unknown
  ) {
    super(message);
  }
}

export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`❌ API Error [${context}]:`, error);
    throw new ApiError(`Failed: ${context}`, 'API_ERROR', error);
  }
}
```

---

## 🟡 Среднесрочные

### 3. React Query Integration
Миграция API на TanStack Query:
```tsx
// Вместо:
const [clients, setClients] = useState([]);
useEffect(() => { fetchClients().then(setClients); }, []);

// Использовать:
const { data: clients } = useQuery({
  queryKey: ['clients', companyId],
  queryFn: () => fetchClients(companyId),
});
```

### 4. Barrel Export
Создать `src/api/index.ts`:
```tsx
export * from './crmApi';
export * from './taskApi';
export * from './estimatesApi';
// ...
```

### 5. Типизация ответов
Все API функции должны возвращать типизированные ответы:
```tsx
export async function getClients(companyId: string): Promise<Client[]> { ... }
```

---

## 🟢 Долгосрочные

### 6. Offline Support
Firestore persistence + queue для offline операций.

### 7. API Versioning
При росте — версионировать API endpoints (v1, v2).
