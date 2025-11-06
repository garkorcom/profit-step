# 🛡️ DEFENSIVE PROGRAMMING GUIDE
## Предотвращение Бесконечных Циклов и $170+ Счетов в Firebase

> **Ваша ситуация:** $174 счет за 5 дней из-за 13 миллионов вызовов Firestore API
> **Причина:** Бесконечный цикл в Cloud Function `onUpdate` триггере
> **Цель:** НИКОГДА больше не допустить этого

---

## 📋 ОГЛАВЛЕНИЕ

1. [Уровень 1: Защита на уровне Кода (Idempotency Guards)](#уровень-1-защита-на-уровне-кода)
2. [Уровень 2: Защита на уровне Разработки (Emulators)](#уровень-2-защита-на-уровне-разработки)
3. [Уровень 3: Защита на уровне Инфраструктуры (Budget Alerts)](#уровень-3-защита-на-уровне-инфраструктуры)
4. [Checklist перед каждым deploy](#checklist-перед-deploy)

---

## УРОВЕНЬ 1: Защита на уровне Кода

### 🚨 Найденная Критическая Проблема

**Файл:** `functions/src/activityLogger.ts:248-270`

```typescript
// ❌ ОПАСНЫЙ КОД - БЕСКОНЕЧНЫЙ ЦИКЛ!
export const incrementLoginCount = functions
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Проверяем что lastSeen обновился
    if (before.lastSeen !== after.lastSeen) {
      // ⚠️ ОБНОВЛЯЕТ ТОТ ЖЕ ДОКУМЕНТ → ВЫЗЫВАЕТ onUpdate СНОВА → ЦИКЛ!
      await change.after.ref.update({
        loginCount: admin.firestore.FieldValue.increment(1),
      });
    }
  });
```

**Почему это опасно:**
1. Функция слушает `onUpdate` документа `users/{userId}`
2. Функция **обновляет тот же документ** `users/{userId}` (поле `loginCount`)
3. Обновление документа → срабатывает `onUpdate` снова → обновляет документ → срабатывает `onUpdate`...
4. **БЕСКОНЕЧНЫЙ ЦИКЛ** → 13 миллионов вызовов → $174 счет

---

### ✅ РЕШЕНИЕ 1: Идемпотентность через Сравнение Полей

**Принцип:** Функция должна проверить, **изменилось ли именно то поле**, которое она собирается обновить.

```typescript
// ✅ БЕЗОПАСНЫЙ КОД - С IDEMPOTENCY GUARD
export const incrementLoginCount = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data();
      const after = change.after.data();

      // 🛡️ GUARD 1: Проверяем изменение lastSeen
      const lastSeenChanged = before.lastSeen !== after.lastSeen;

      // 🛡️ GUARD 2: Проверяем что loginCount НЕ изменился
      // Если loginCount изменился - это означает, что функция уже сработала!
      const loginCountChanged = before.loginCount !== after.loginCount;

      // 🛡️ GUARD 3: Если loginCount УЖЕ изменился - НЕ обновляем снова!
      if (!lastSeenChanged || loginCountChanged) {
        console.log(`⏩ Skipping loginCount update for user ${context.params.userId}:`, {
          lastSeenChanged,
          loginCountChanged,
        });
        return null; // ← НЕМЕДЛЕННЫЙ ВЫХОД, НЕ ОБНОВЛЯЕМ ДОКУМЕНТ
      }

      // Только если lastSeen изменился И loginCount НЕ изменился - обновляем
      await change.after.ref.update({
        loginCount: admin.firestore.FieldValue.increment(1),
      });

      console.log(`📊 Login count incremented for user: ${context.params.userId}`);
      return null;
    } catch (error) {
      console.error('❌ Error incrementing login count:', error);
      return null;
    }
  });
```

**Как это работает:**
1. ✅ Пользователь обновил `lastSeen` → `lastSeenChanged = true`, `loginCountChanged = false` → функция обновляет `loginCount`
2. ✅ Функция обновила `loginCount` → срабатывает `onUpdate` снова → `loginCountChanged = true` → **GUARD блокирует** → функция выходит без обновления
3. ✅ Цикл прерван!

---

### ✅ РЕШЕНИЕ 2: Вынос Логики в Отдельную Коллекцию

**Принцип:** НЕ обновлять документ, который слушаешь. Создавать/обновлять **другой документ**.

```typescript
// ✅ БЕЗОПАСНЫЙ КОД - ОБНОВЛЯЕТ ДРУГУЮ КОЛЛЕКЦИЮ
export const incrementLoginCount = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data();
      const after = change.after.data();
      const userId = context.params.userId;

      // 🛡️ GUARD: Проверяем изменение lastSeen
      if (before.lastSeen === after.lastSeen) {
        return null; // ← НЕТ ИЗМЕНЕНИЙ - ВЫХОД
      }

      // ✅ ОБНОВЛЯЕМ ДРУГУЮ КОЛЛЕКЦИЮ - НЕ users/{userId}!
      await db.collection('userStats').doc(userId).set({
        loginCount: admin.firestore.FieldValue.increment(1),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      console.log(`📊 Login stat updated for user: ${userId}`);
      return null;
    } catch (error) {
      console.error('❌ Error updating login stat:', error);
      return null;
    }
  });
```

**Преимущества:**
- ✅ Функция слушает `users/{userId}`, но обновляет `userStats/{userId}` → **нет цикла**
- ✅ Разделение concerns: `users` хранит профиль, `userStats` хранит статистику
- ✅ Более чистая архитектура

---

### 🛡️ РЕШЕНИЕ 3: Рефакторинг `trackUserActivation`

**Текущий код** (`metricsAggregation.ts:204-235`) - **уже безопасен**, но можно улучшить:

```typescript
// ✅ УЖЕ БЕЗОПАСЕН (обновляет другую коллекцию)
// НО можно улучшить с более явными guards
export const trackUserActivation = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    try {
      const userId = context.params.userId;
      const before = change.before.data();
      const after = change.after.data();

      const updates: any = {};

      // 🛡️ GUARD 1: Проверяем заполнение профиля (title)
      const titleAdded = (!before.title || before.title === '') &&
                         (after.title && after.title !== '');

      if (titleAdded) {
        updates.profileCompleted = admin.firestore.FieldValue.serverTimestamp();
        console.log(`✅ User ${userId} completed profile`);
      }

      // 🛡️ GUARD 2: Проверяем загрузку аватара
      const avatarAdded = (!before.photoURL || before.photoURL === '') &&
                          (after.photoURL && after.photoURL !== '');

      if (avatarAdded) {
        updates.avatarUploaded = admin.firestore.FieldValue.serverTimestamp();
        console.log(`✅ User ${userId} uploaded avatar`);
      }

      // 🛡️ GUARD 3: НЕТ ИЗМЕНЕНИЙ - ВЫХОД
      if (Object.keys(updates).length === 0) {
        return null; // ← ВЫХОД БЕЗ ОБНОВЛЕНИЯ
      }

      // ✅ ОБНОВЛЯЕМ ДРУГОЙ ДОКУМЕНТ (userActivation, не users)
      const activationRef = db.collection('userActivation').doc(userId);
      await activationRef.set(updates, { merge: true });

      return null;
    } catch (error) {
      console.error('❌ Error tracking user activation:', error);
      return null;
    }
  });
```

---

### 📝 GOLDEN RULES для onUpdate Триггеров

1. **НИКОГДА** не обновляй документ, который слушаешь, без idempotency guard
2. **ВСЕГДА** сравнивай `before` и `after` в начале функции
3. **ВСЕГДА** проверяй, что поле, которое ты собираешься обновить, **еще не было обновлено**
4. **PREFER** обновлять **другую коллекцию** вместо того же документа
5. **ВСЕГДА** используй `return null` для явного выхода из функции

---

## УРОВЕНЬ 2: Защита на уровне Разработки

### 🧪 Firebase Emulators

**Цель:** Тестировать триггеры локально, не трогая production-базу и не платя ни цента.

#### Шаг 1: Установка и настройка

```bash
# 1. Инициализация эмуляторов (если еще не сделано)
cd /Users/denysharbuzov/Projects/profit-step
firebase init emulators

# Выберите:
# ✅ Authentication Emulator
# ✅ Functions Emulator
# ✅ Firestore Emulator
# ✅ Storage Emulator (опционально)

# Порты (по умолчанию, можно оставить):
# - Firestore: 8080
# - Functions: 5001
# - Authentication: 9099
# - UI: 4000 (Emulator UI - очень полезная веб-консоль!)
```

**Ваш `firebase.json` уже настроен:**
```json
{
  "emulators": {
    "auth": { "port": 9099 },
    "functions": { "port": 5001 },
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "ui": {
      "enabled": true,
      "port": 4000
    },
    "singleProjectMode": true
  }
}
```

#### Шаг 2: Запуск эмуляторов

```bash
# Запуск всех эмуляторов
firebase emulators:start

# Или только нужных
firebase emulators:start --only functions,firestore,auth

# С импортом данных из production (опционально)
firebase emulators:start --import=./emulator-data --export-on-exit
```

**Вывод:**
```
✔ All emulators ready!
┌─────────────┬────────────────┬──────────────┐
│ Emulator    │ Host:Port      │ View in UI   │
├─────────────┼────────────────┼──────────────┤
│ Auth        │ 127.0.0.1:9099 │ http://...   │
│ Functions   │ 127.0.0.1:5001 │ http://...   │
│ Firestore   │ 127.0.0.1:8080 │ http://...   │
└─────────────┴────────────────┴──────────────┘

  Emulator UI running on http://127.0.0.1:4000
```

#### Шаг 3: Подключение React-приложения к эмуляторам

**Создайте файл:** `src/firebase/emulators.ts`

```typescript
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { auth, db, storage } from './firebase';

// Проверяем, запущены ли эмуляторы
const USE_EMULATORS = process.env.REACT_APP_USE_EMULATORS === 'true';

if (USE_EMULATORS) {
  console.log('🧪 Connecting to Firebase Emulators...');

  // Auth Emulator
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
    disableWarnings: true,
  });

  // Firestore Emulator
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  // Functions Emulator
  const functions = getFunctions();
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);

  // Storage Emulator
  connectStorageEmulator(storage, '127.0.0.1', 9199);

  console.log('✅ Connected to emulators');
}
```

**Обновите `src/firebase/firebase.ts`:**

```typescript
// ... ваш существующий код ...

// В конце файла добавьте:
// Подключение к эмуляторам (если включено)
if (process.env.REACT_APP_USE_EMULATORS === 'true') {
  import('./emulators');
}
```

**Создайте `.env.local` (для локальной разработки):**

```bash
# .env.local
REACT_APP_USE_EMULATORS=true
```

**Создайте `.env.production` (для production):**

```bash
# .env.production
REACT_APP_USE_EMULATORS=false
```

#### Шаг 4: Тестирование триггера

**Терминал 1:** Запуск эмуляторов
```bash
firebase emulators:start
```

**Терминал 2:** Запуск React-приложения
```bash
REACT_APP_USE_EMULATORS=true npm start
```

**Откройте:**
- React app: http://localhost:3000
- Emulator UI: http://127.0.0.1:4000

**Тест:**
1. Откройте приложение → Login
2. Обновите профиль (title) в UI
3. Откройте Emulator UI → Functions → Logs
4. Проверьте, что `trackUserActivation` сработала
5. Откройте Firestore tab → проверьте `userActivation/{userId}`
6. **КРИТИЧЕСКИ ВАЖНО:** Проверьте в логах, что функция **НЕ вошла в цикл**

**Что смотреть в логах:**
```
✅ ХОРОШО:
  trackUserActivation triggered (1 раз)
  ⏩ Skipping update - no changes

❌ ПЛОХО (цикл):
  trackUserActivation triggered
  trackUserActivation triggered
  trackUserActivation triggered
  ... (десятки раз)
```

---

## УРОВЕНЬ 3: Защита на уровне Инфраструктуры

### 💰 Budget Alerts в Google Cloud

#### Шаг 1: Создание бюджета

1. **Откройте Google Cloud Console:**
   https://console.cloud.google.com/billing

2. **Выберите ваш проект:** `profit-step`

3. **Перейдите в Billing → Budgets & alerts**

4. **Создайте бюджет:**
   - Name: `Monthly Budget - Profit Step`
   - Time range: `Monthly`
   - Projects: `profit-step`
   - Services: `All services` (или выберите только Firestore + Functions)

5. **Установите сумму:**
   - Budget amount: **$10.00** (десять долларов)

6. **Настройте алерты:**
   - Alert threshold 1: **50%** ($5) → Email
   - Alert threshold 2: **90%** ($9) → Email
   - Alert threshold 3: **100%** ($10) → Email + SMS (если настроено)

7. **Email-уведомления:**
   - Добавьте свой email
   - Добавьте email команды (если есть)

8. **Нажмите "Save"**

#### Шаг 2: Настройка автоматического отключения биллинга (HARD STOP)

⚠️ **ВАЖНО:** Google Cloud **НЕ позволяет** автоматически отключить проект при превышении бюджета.
НО можно настроить автоматическое отключение **биллинга**, что эффективно остановит все платные операции.

##### Вариант A: Pub/Sub + Cloud Function (Рекомендуемый)

**Шаг 1:** Создайте Cloud Function для отключения биллинга

```bash
# Создайте новую директорию для Cloud Function
mkdir -p cloud-functions/billing-guard
cd cloud-functions/billing-guard
```

**Файл `index.js`:**

```javascript
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = 'profit-step';
const PROJECT_NAME = `projects/${PROJECT_ID}`;

/**
 * Отключает биллинг для проекта
 */
async function disableBilling() {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-billing'],
  });

  const cloudbilling = google.cloudbilling({
    version: 'v1',
    auth,
  });

  try {
    // Отключаем биллинг
    await cloudbilling.projects.updateBillingInfo({
      name: PROJECT_NAME,
      resource: {
        billingAccountName: '', // Пустая строка = отключение биллинга
      },
    });

    console.log(`✅ Billing disabled for project ${PROJECT_ID}`);
    return `Billing disabled for ${PROJECT_ID}`;
  } catch (error) {
    console.error('❌ Error disabling billing:', error);
    throw error;
  }
}

/**
 * Cloud Function триггер
 */
exports.stopBillingOnBudgetAlert = async (pubsubEvent, context) => {
  const pubsubData = JSON.parse(
    Buffer.from(pubsubEvent.data, 'base64').toString()
  );

  console.log('📊 Budget alert received:', pubsubData);

  // Проверяем, что бюджет превышен на 100%
  const costAmount = pubsubData.costAmount || 0;
  const budgetAmount = pubsubData.budgetAmount || 0;
  const percentUsed = (costAmount / budgetAmount) * 100;

  console.log(`💰 Budget used: ${percentUsed.toFixed(2)}%`);

  // Порог для отключения (например, 100% или $50)
  const DISABLE_THRESHOLD_PERCENT = 100;
  const DISABLE_THRESHOLD_DOLLARS = 50;

  if (percentUsed >= DISABLE_THRESHOLD_PERCENT || costAmount >= DISABLE_THRESHOLD_DOLLARS) {
    console.log(`🚨 Budget threshold exceeded! Disabling billing...`);
    return await disableBilling();
  } else {
    console.log(`ℹ️ Budget alert received, but threshold not met. No action taken.`);
    return null;
  }
};
```

**Файл `package.json`:**

```json
{
  "name": "billing-guard",
  "version": "1.0.0",
  "dependencies": {
    "google-auth-library": "^9.0.0",
    "googleapis": "^128.0.0"
  }
}
```

**Шаг 2:** Deploy Cloud Function

```bash
gcloud functions deploy stopBillingOnBudgetAlert \
  --runtime nodejs20 \
  --trigger-topic budget-alerts \
  --region us-central1 \
  --project profit-step \
  --entry-point stopBillingOnBudgetAlert \
  --set-env-vars PROJECT_ID=profit-step
```

**Шаг 3:** Настройте бюджет с Pub/Sub топиком

1. Откройте Google Cloud Console → Billing → Budgets
2. Редактируйте ваш бюджет
3. В разделе "Manage notifications" → "Connect a Pub/Sub topic"
4. Создайте топик: `budget-alerts`
5. Сохраните

**Как это работает:**
1. ✅ Бюджет превышен ($50 или 100%) → отправляет сообщение в Pub/Sub топик `budget-alerts`
2. ✅ Cloud Function `stopBillingOnBudgetAlert` срабатывает автоматически
3. ✅ Функция отключает биллинг для проекта `profit-step`
4. ✅ Все платные операции останавливаются

⚠️ **ВАЖНО:** После отключения биллинга:
- Приложение перестанет работать
- Firestore будет в read-only mode
- Cloud Functions перестанут срабатывать
- Вам нужно будет **вручную** включить биллинг обратно после расследования проблемы

##### Вариант B: Monitoring Alerts (Проще, но менее надежно)

1. **Cloud Console → Monitoring → Alerting**
2. **Create Policy:**
   - Condition: `Cloud Function Execution Count`
   - Threshold: `> 10,000 executions in 5 minutes` (для одной функции)
   - Notification: Email + SMS
3. **Создайте алерт для:**
   - Firestore Reads > 100,000 / 5 min
   - Firestore Writes > 10,000 / 5 min
   - Cloud Function Errors > 100 / 5 min

**Преимущества:**
- ✅ Проще настроить
- ✅ Уведомления в реальном времени

**Недостатки:**
- ❌ НЕ останавливает биллинг автоматически
- ❌ Вы должны вручную отключить функции

---

## 📋 CHECKLIST ПЕРЕД DEPLOY

### ✅ Код

- [ ] Все `onUpdate` триггеры имеют idempotency guards
- [ ] Нет триггеров, которые обновляют тот же документ, который слушают
- [ ] Логика в `try-catch` блоках
- [ ] Есть `return null` в конце каждой функции
- [ ] Логируются все важные действия (для debugging)

### ✅ Тестирование

- [ ] Протестировали триггеры в эмуляторах
- [ ] Проверили логи на отсутствие циклов
- [ ] Проверили, что функция срабатывает только 1 раз при изменении
- [ ] Проверили edge cases (пустые поля, null, undefined)

### ✅ Инфраструктура

- [ ] Бюджет создан в Google Cloud Billing
- [ ] Email-алерты настроены (50%, 90%, 100%)
- [ ] (Опционально) Настроена автоматическая остановка биллинга
- [ ] Настроены Monitoring Alerts для подозрительной активности

### ✅ Документация

- [ ] Команда знает о рисках infinite loops
- [ ] Есть runbook для реагирования на алерты
- [ ] Есть доступ к Google Cloud Console для ручного отключения

---

## 🚨 ЭКСТРЕННЫЕ ДЕЙСТВИЯ ПРИ ЦИКЛЕ

### Если вы получили алерт о превышении бюджета:

1. **НЕМЕДЛЕННО:**
   ```bash
   # Отключите проблемную функцию
   gcloud functions delete incrementLoginCount --region us-central1 --project profit-step
   ```

2. **Проверьте логи:**
   ```bash
   firebase functions:log --only incrementLoginCount --limit 100
   ```

3. **Проверьте счет:**
   - Google Cloud Console → Billing → Reports
   - Найдите аномальный спайк

4. **Свяжитесь с Google Support:**
   - Если счет уже большой ($100+), откройте support ticket
   - Google иногда делает refund для очевидных ошибок разработки

5. **Исправьте код:**
   - Добавьте idempotency guards
   - Протестируйте в эмуляторах
   - Задеплойте исправленную версию

6. **Включите биллинг обратно** (если отключили автоматически)

---

## 📚 ДОПОЛНИТЕЛЬНЫЕ РЕСУРСЫ

- [Firebase Functions Best Practices](https://firebase.google.com/docs/functions/best-practices)
- [Avoiding Infinite Loops](https://cloud.google.com/firestore/docs/solutions/schedule-export#avoid_infinite_loops)
- [Google Cloud Billing Budget Alerts](https://cloud.google.com/billing/docs/how-to/budgets)
- [Programmatically Disable Billing](https://cloud.google.com/billing/docs/how-to/notify#cap_disable_billing_to_stop_usage)

---

**Автор:** Claude Code
**Дата:** 2025-11-06
**Проект:** Profit Step - Team Management Dashboard
