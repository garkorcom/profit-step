# 📖 Profit Step — Руководство Разработчика

> Туториал для доработки и расширения проекта

---

## 1. Быстрый старт

### Предварительные требования
- Node.js 20+
- npm 9+
- Firebase CLI (`npm install -g firebase-tools`)
- Аккаунт Firebase с доступом к проекту `profit-step`

### Установка и запуск

```bash
# 1. Клонировать (если нужно)
cd ~/Projects/profit-step

# 2. Установить зависимости
npm install
cd functions && npm install && cd ..

# 3. Настроить окружение
# Скопировать .env.local.example → .env.local и заполнить ключи
cp .env.local.example .env.local
# Скопировать functions/.env.example → functions/.env
cp functions/.env.example functions/.env

# 4. Запустить frontend
npm start
# Откроется http://localhost:3000

# 5. Запустить эмуляторы Firebase (в отдельном терминале)
npm run emulator
# UI эмуляторов: http://localhost:4000
```

### Переменные окружения (.env.local)

```env
# Firebase Config
REACT_APP_FIREBASE_API_KEY=...
REACT_APP_FIREBASE_AUTH_DOMAIN=...
REACT_APP_FIREBASE_PROJECT_ID=profit-step
REACT_APP_FIREBASE_STORAGE_BUCKET=...
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...
REACT_APP_FIREBASE_APP_ID=...

# Feature Flags
REACT_APP_USE_EMULATOR=false
```

---

## 2. Как добавить новую страницу

### Шаг 1: Создать файл страницы

```tsx
// src/pages/crm/MyNewPage.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const MyNewPage: React.FC = () => {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        My New Page
      </Typography>
      {/* Контент */}
    </Box>
  );
};

export default MyNewPage;
```

### Шаг 2: Добавить маршрут в `AppRouter.tsx`

```tsx
// src/router/AppRouter.tsx

// 1. Добавить lazy import вверху файла:
const MyNewPage = React.lazy(() => import('../pages/crm/MyNewPage'));

// 2. Добавить Route внутри <Route element={<ProtectedLayout />}>:
<Route path="/crm/my-new" element={<MyNewPage />} />
```

### Шаг 3: Добавить ссылку в навигацию

```tsx
// src/components/layout/Header.tsx
// Найти массив с пунктами меню и добавить:
{ text: 'My New', path: '/crm/my-new', icon: <NewIcon /> }
```

### Шаг 4: Проверить

```bash
npm run build  # Обязательно проверить сборку!
```

---

## 3. Как добавить новый Custom Hook

### Шаблон хука с Firestore

```tsx
// src/hooks/useMyData.ts
import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../auth/AuthContext';

export const useMyData = (clientId?: string) => {
  const { currentUser, userProfile } = useAuth();
  const [data, setData] = useState<MyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser || !userProfile?.companyId) return;

    const q = query(
      collection(db, 'my_collection'),
      where('companyId', '==', userProfile.companyId),
      ...(clientId ? [where('clientId', '==', clientId)] : [])
    );

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as MyType[];
        setData(items);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching data:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser, userProfile?.companyId, clientId]);

  return { data, loading, error };
};
```

---

## 4. Как добавить Cloud Function

### Шаг 1: Создать функцию

```typescript
// functions/src/callable/myModule/myFunction.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Callable Function: Описание
 * Вызывается из React через httpsCallable()
 */
export const myFunction = functions.https.onCall(async (data, context) => {
  // 1. Проверка авторизации
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется вход');
  }

  // 2. Валидация данных
  const { param1, param2 } = data;
  if (!param1) {
    throw new functions.https.HttpsError('invalid-argument', 'param1 обязателен');
  }

  try {
    // 3. Бизнес-логика
    const result = await db.collection('my_collection').add({
      ...data,
      createdBy: context.auth.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, id: result.id };
  } catch (error: any) {
    console.error('❌ Error in myFunction:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});
```

### Шаг 2: Экспортировать в index.ts

```typescript
// functions/src/index.ts
// Добавить в конец файла:
export { myFunction } from './callable/myModule/myFunction';
```

### Шаг 3: Вызвать из React

```typescript
// В React компоненте:
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const myFunctionCall = httpsCallable(functions, 'myFunction');

const result = await myFunctionCall({ param1: 'value' });
console.log(result.data);
```

### Шаг 4: Деплой

```bash
cd functions && npm run build    # Проверить компиляцию
firebase deploy --only functions:myFunction  # Деплой одной функции
```

---

## 5. Как добавить Firestore триггер

```typescript
// functions/src/triggers/firestore/onMyDocCreated.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Триггер: Когда создается новый документ в my_collection
 */
export const onMyDocCreated = functions.firestore
  .document('my_collection/{docId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data();
    const docId = context.params.docId;

    console.log(`📝 New doc created: ${docId}`);

    // Пример: Логирование в BigQuery
    // await auditLogger.log('my_doc_created', { docId, ...data });

    // Пример: Уведомление
    // await sendNotification(data.assignedTo, 'Новый документ!');
  });
```

**Не забудь**: Экспортировать в `functions/src/index.ts`!

---

## 6. Как работать с Firestore Security Rules

### Основные правила (файл `firestore.rules`)

```
// Общий паттерн проверки роли:
function isAdmin() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
}

function isCompanyMember(companyId) {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.companyId == companyId;
}

// Пример правила для новой коллекции:
match /my_collection/{docId} {
  allow read: if request.auth != null && isCompanyMember(resource.data.companyId);
  allow create: if request.auth != null;
  allow update: if request.auth != null && (
    request.auth.uid == resource.data.createdBy || isAdmin()
  );
  allow delete: if isAdmin();
}
```

### Тестирование правил

```bash
npm run test:security  # Запускает jest firestore.rules.test.ts
```

---

## 7. Как интегрировать AI (Gemini/Claude)

### Использование Gemini API

```typescript
// functions/src/services/myAIService.ts
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY || '');

export async function analyzeWithAI(prompt: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,        // Низкая для точности
      maxOutputTokens: 4096,
    },
  });

  return result.response.text();
}
```

### Использование Claude API

```typescript
// functions/src/services/myClaudeService.ts
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function analyzeWithClaude(prompt: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].type === 'text' ? message.content[0].text : '';
}
```

### AI кеширование (важно!)

```typescript
// Используй aiCacheUtils.ts для кеширования результатов:
import { getCachedResult, setCachedResult } from '../utils/aiCacheUtils';

const cached = await getCachedResult(cacheKey);
if (cached) return cached;

const result = await analyzeWithAI(prompt);
await setCachedResult(cacheKey, result, /* TTL */ 3600);
return result;
```

---

## 8. Как работать с Telegram ботами

### Текущие боты
1. **Worker Bot** — `onWorkerBotMessage.ts` (тайм-трекинг, задачи)
2. **Costs Bot** — `onCostsBotMessage.ts` (загрузка расходов через @gcostsbot)
3. **AI Assistant** — `telegramAIAssistant.ts` (общение с AI)

### Добавить обработчик команды

```typescript
// functions/src/triggers/telegram/handlers/myHandler.ts
import * as admin from 'firebase-admin';

export async function handleMyCommand(
  chatId: number,
  userId: number,
  messageText: string
) {
  const db = admin.firestore();

  // 1. Найти пользователя по telegramId
  const userSnap = await db
    .collection('users')
    .where('telegramId', '==', userId)
    .limit(1)
    .get();

  if (userSnap.empty) {
    return { text: '❌ Пользователь не найден. Используйте /start' };
  }

  const user = userSnap.docs[0].data();

  // 2. Обработать команду
  // ...

  return { text: '✅ Команда выполнена!' };
}
```

---

## 9. Деплой

### Полный деплой
```bash
# 1. Собрать frontend
npm run build

# 2. Собрать backend
cd functions && npm run build && cd ..

# 3. Деплой всего
firebase deploy
```

### Частичный деплой
```bash
# Только frontend (hosting)
firebase deploy --only hosting

# Только backend (functions)
firebase deploy --only functions

# Одна конкретная функция
firebase deploy --only functions:myFunction

# Только правила Firestore
firebase deploy --only firestore:rules

# Только индексы Firestore
firebase deploy --only firestore:indexes

# Только правила Storage
firebase deploy --only storage
```

### Деплой чеклист
- [ ] `npm run build` — Frontend собирается без ошибок
- [ ] `npm run lint` — Нет критических ошибок
- [ ] `cd functions && npm run build` — Backend собирается
- [ ] Проверить `.env.local` / `functions/.env` — Все ключи на месте
- [ ] `firebase deploy --only hosting` — Деплой frontend
- [ ] `firebase deploy --only functions` — Деплой backend
- [ ] Проверить в браузере — Все работает

---

## 10. Тестирование

### Unit тесты
```bash
npm run test:unit           # Frontend Jest тесты
cd functions && npm test    # Backend Jest тесты
```

### Security тесты (Firestore Rules)
```bash
npm run test:security
```

### Integration тесты
```bash
npm run test:integration
```

### E2E тесты (Cypress)
```bash
npm run test:e2e        # Headless
npm run test:e2e:open   # С UI
```

### Performance (Lighthouse)
```bash
npm run test:lighthouse
```

### Agent API тесты
```bash
cd functions && npm run test:api
```

---

## 11. Стандарты кода

### TypeScript
- Всегда типизировать props и return types
- Использовать файлы из `src/types/` для общих типов
- Для Firebase документов использовать `interface` (не `type`)

### React компоненты
- Функциональные компоненты с `React.FC`
- Хуки для бизнес-логики (`useMyHook`)
- Material UI для всех UI элементов
- Lazy loading для страниц (`React.lazy`)

### Файловая структура
```
src/pages/crm/MyPage.tsx          # Страница
src/components/my-module/         # Компоненты модуля
  MyComponent.tsx
  MyDialog.tsx
  index.ts                        # Barrel export
src/hooks/useMyHook.ts            # Custom hook
src/api/myApi.ts                  # API слой
src/types/my.types.ts             # Типы
```

### Git
```bash
# Формат коммитов
feat(crm): добавить страницу контактов
fix(timer): исправить расчет overtime
refactor(gtd): декомпозиция GTDBoard
docs: обновить README
```

---

## 12. Частые проблемы (Troubleshooting)

### "Port 3000 already in use"
```bash
lsof -ti:3000 | xargs kill -9
npm start
```

### "Firebase emulator fails to start"  
```bash
# Проверить что Java установлена
java -version
# Убить висящие процессы
lsof -ti:8080 -ti:5001 -ti:9099 | xargs kill -9
npm run emulator
```

### "Build fails with TypeScript errors"
```bash
# Проверить версии
npx tsc --version   # Frontend: 4.9.5
cd functions && npx tsc --version  # Backend: 5.x
```

### "Cloud Function timeout"
- Функции по умолчанию имеют timeout 60 секунд
- AI функции могут требовать до 540 секунд
- Настраивается в `functions.runWith({ timeoutSeconds: 540 })`

### "Firestore permission denied"
1. Проверить `firestore.rules` — есть ли правило для коллекции
2. Проверить роль пользователя в Firestore (`users/{uid}.role`)
3. Проверить `companyId` — должен совпадать
