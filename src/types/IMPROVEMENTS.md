# 🚀 src/types/ — Улучшения TypeScript Типов

## 🔴 Критические

### 1. Убрать 482 использования `any`
Самая массовая проблема проекта. Каждый `any` — потенциальный runtime баг.

**Стратегия исправления:**
1. Начать с `types/` — все типы должны быть strict
2. Далее `api/` — все API вызовы типизированы
3. Далее `hooks/` — все хуки с generic types
4. Последними — `pages/` (самые большие файлы)

```tsx
// ❌ Плохо:
const data: any = snapshot.data();

// ✅ Хорошо:
const data = snapshot.data() as Client;

// ✅ Ещё лучше (с валидацией):
const data = clientSchema.parse(snapshot.data());
```

### 2. Shared Types (Frontend ↔ Backend)
Типы дублируются между `src/types/` и `functions/src/types/`.
Создать shared пакет:

```
packages/
  shared-types/
    src/
      client.ts
      task.ts
      session.ts
    package.json
```

---

## 🟡 Среднесрочные

### 3. Zod Validation на Frontend
Backend уже использует Zod (в Agent API schemas). Перенести на frontend:
```tsx
import { z } from 'zod';

const ClientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
});

type Client = z.infer<typeof ClientSchema>;
```

### 4. Strict Mode
Включить `"strict": true` в `tsconfig.json` (сейчас `true`, но `noImplicitAny` может быть отключен).

### 5. Utility Types
Создать общие утилитарные типы:
```tsx
// src/types/utils.types.ts
export type WithId<T> = T & { id: string };
export type Timestamps = { createdAt: Timestamp; updatedAt: Timestamp };
export type FirestoreDoc<T> = WithId<T> & Timestamps;
```

---

## 🟢 Долгосрочные

### 6. Auto-generation из Firestore Schema
Генерировать типы автоматически из Firestore rules/schema.

### 7. GraphQL CodeGen
Если проект мигрирует на GraphQL — использовать codegen для типов.
