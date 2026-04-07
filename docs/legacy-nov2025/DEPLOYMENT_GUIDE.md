# Руководство по развертыванию - Profit Step

## 📋 Предварительные требования

1. **Node.js** установлен (версия 18+)
2. **Firebase CLI** установлен:
   ```bash
   npm install -g firebase-tools
   ```
3. **Firebase Project** создан в [Firebase Console](https://console.firebase.google.com/)

## 🚀 Пошаговое развертывание

### Шаг 1: Настройка Firebase Credentials

1. Откройте Firebase Console: https://console.firebase.google.com/
2. Выберите ваш проект (или создайте новый)
3. Перейдите в **Project Settings** (иконка шестеренки)
4. Прокрутите вниз до раздела **"Your apps"**
5. Если нет веб-приложения:
   - Нажмите **"Add app"** → выберите **Web** (</>)
   - Дайте имя приложению (например: "Profit Step")
   - **НЕ** устанавливайте Firebase Hosting (мы настроим позже)
6. Скопируйте значения из `firebaseConfig`

7. Откройте файл `.env.local` в корне проекта
8. Замените значения на ваши:

```bash
REACT_APP_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=123456789012
REACT_APP_FIREBASE_APP_ID=1:123456789012:web:abcdef1234567890
```

9. **Перезапустите dev server**:
   ```bash
   # Остановите текущий (Ctrl+C)
   PORT=3001 npm start
   ```

### Шаг 2: Включение Authentication

1. В Firebase Console перейдите в **Authentication**
2. Нажмите **"Get Started"**
3. Перейдите на вкладку **"Sign-in method"**
4. Включите **Email/Password**:
   - Нажмите на "Email/Password"
   - Переключите "Enable"
   - Нажмите "Save"
5. Включите **Google Sign-In**:
   - Нажмите на "Google"
   - Переключите "Enable"
   - Выберите Support email
   - Нажмите "Save"

### Шаг 3: Создание Firestore Database

1. В Firebase Console перейдите в **Firestore Database**
2. Нажмите **"Create database"**
3. Выберите режим запуска:
   - **Production mode** (рекомендуется) - начнем с безопасных правил
   - Или **Test mode** - для быстрого тестирования (НЕ для production!)
4. Выберите регион (например: `europe-west1` для Европы)
5. Нажмите **"Enable"**

### Шаг 4: Создание Storage

1. В Firebase Console перейдите в **Storage**
2. Нажмите **"Get Started"**
3. Выберите режим:
   - **Production mode** (рекомендуется)
4. Выберите тот же регион, что и для Firestore
5. Нажмите **"Done"**

### Шаг 5: Инициализация Firebase CLI

```bash
# Войдите в Firebase (откроется браузер)
firebase login

# Проверьте, что вошли
firebase projects:list

# Если проект не инициализирован, создайте .firebaserc
cat > .firebaserc << 'EOF'
{
  "projects": {
    "default": "your-project-id"
  }
}
EOF

# Замените "your-project-id" на ваш Project ID из Firebase Console
```

### Шаг 6: Установка зависимостей Cloud Functions

```bash
cd functions
npm install
cd ..
```

### Шаг 7: Развертывание Firestore Rules

```bash
firebase deploy --only firestore:rules

# Ожидаемый результат:
# ✔ Deploy complete!
```

**Что это делает:**
- Устанавливает правила безопасности для Firestore
- Пользователи могут работать только со своими данными
- Админы могут редактировать профили своей компании
- Неактивные пользователи блокируются

### Шаг 8: Развертывание Storage Rules

```bash
firebase deploy --only storage

# Ожидаемый результат:
# ✔ Deploy complete!
```

**Что это делает:**
- Настраивает правила для загрузки аватаров
- Ограничение размера файла (5MB)
- Ограничение типа (только изображения)
- Публичный доступ к аватарам для отображения

### Шаг 9: Развертывание Cloud Functions

```bash
firebase deploy --only functions

# Ожидаемый результат:
# ✔ functions[onUserCreate(us-central1)]: Successful create operation.
# ✔ functions[onUserDelete(us-central1)]: Successful create operation.
# ✔ functions[adminDeleteUser(us-central1)]: Successful create operation.
# ✔ Deploy complete!
```

**Что это делает:**
- `onUserCreate`: Автоматически создает профиль при регистрации
- `onUserDelete`: Очищает данные при удалении аккаунта
- `adminDeleteUser`: Безопасное удаление пользователей админами

**⚠️ Важно:** Первое развертывание может занять 5-10 минут!

### Шаг 10: Проверка развертывания

```bash
# Проверьте статус функций
firebase functions:list

# Проверьте логи
firebase functions:log
```

## 🧪 Тестирование после развертывания

### 1. Проверка регистрации

```bash
# Запустите dev server
PORT=3001 npm start
```

1. Откройте http://localhost:3001/signup
2. Зарегистрируйте нового пользователя
3. Откройте Firebase Console → Authentication
4. Убедитесь, что пользователь создан
5. Откройте Firestore Database
6. Проверьте, что создан документ `users/{userId}`
7. Убедитесь, что поля `status: 'active'` и `lastSeen` присутствуют

### 2. Проверка загрузки аватара

1. Войдите как Admin (установите `role: 'admin'` вручную в Firestore)
2. Откройте http://localhost:3001/admin/team
3. Нажмите "Меню" → "Редактировать профиль" на любом пользователе
4. Загрузите изображение (макс 5MB)
5. Проверьте в Firebase Console → Storage:
   - Должна появиться папка `avatars/{userId}/profile.jpg`

### 3. Проверка Cloud Function (adminDeleteUser)

**Создайте тестовый скрипт:**

```typescript
// test-delete-user.ts
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const adminDeleteUser = httpsCallable(functions, 'adminDeleteUser');

// Вызовите функцию (замените USER_ID_TO_DELETE)
adminDeleteUser({ userIdToDelete: 'USER_ID_TO_DELETE' })
  .then((result) => {
    console.log('Success:', result.data);
  })
  .catch((error) => {
    console.error('Error:', error);
  });
```

**Или протестируйте через UI:**
1. Создайте 2 тестовых пользователя в одной companyId
2. Установите одному `role: 'admin'`
3. Войдите как Admin
4. Откройте /admin/team
5. Попробуйте удалить второго пользователя
6. Проверьте логи: `firebase functions:log --only adminDeleteUser`

## 🔧 Полезные команды

```bash
# Развернуть все сразу
firebase deploy

# Развернуть только правила
firebase deploy --only firestore:rules,storage

# Развернуть только функции
firebase deploy --only functions

# Развернуть конкретную функцию
firebase deploy --only functions:adminDeleteUser

# Посмотреть логи всех функций
firebase functions:log

# Посмотреть логи конкретной функции
firebase functions:log --only adminDeleteUser

# Удалить функцию (если нужно)
firebase functions:delete adminDeleteUser

# Посмотреть использование
firebase projects:usage

# Открыть консоль
firebase open
```

## 🛡️ Безопасность в Production

### Рекомендации:

1. **Включите Email Verification**:
   ```typescript
   // В AuthContext после регистрации
   await sendEmailVerification(user);
   ```

2. **Настройте CORS для Cloud Functions**:
   ```typescript
   // В functions/src/index.ts
   import * as cors from 'cors';
   const corsHandler = cors({ origin: true });
   ```

3. **Добавьте Rate Limiting**:
   - В Firebase Console → Authentication → Settings
   - Включите "Email enumeration protection"

4. **Мониторинг**:
   - Настройте алерты в Cloud Console
   - Мониторьте логи функций

5. **Backup**:
   - Включите автоматический backup Firestore
   - Firebase Console → Firestore → Import/Export

## 📊 Стоимость (Оценка)

**Firebase Free Plan (Spark):**
- ✅ Authentication: До 50,000 MAU бесплатно
- ✅ Firestore: 1 GB хранилища, 50k reads/day
- ✅ Storage: 5 GB хранилища, 1 GB/day download
- ❌ Cloud Functions: Требует Blaze Plan

**Firebase Blaze Plan (Pay as you go):**
- Cloud Functions: $0.40/million invocations
- Первый 1M invocations/месяц - БЕСПЛАТНО
- Для малого бизнеса: ~$5-20/месяц

## 🐛 Troubleshooting

### Ошибка: "Permission denied" при создании профиля

**Причина:** Firestore Rules не развернуты или неверно настроены

**Решение:**
```bash
firebase deploy --only firestore:rules
```

### Ошибка: "Firebase API key not configured"

**Причина:** Не настроен .env.local

**Решение:**
1. Проверьте, что файл `.env.local` существует
2. Убедитесь, что все переменные заполнены
3. Перезапустите dev server

### Ошибка: "Error uploading avatar"

**Причина:** Storage Rules не развернуты

**Решение:**
```bash
firebase deploy --only storage
```

### Функция adminDeleteUser не работает

**Проверьте:**
1. Функция развернута: `firebase functions:list`
2. Логи: `firebase functions:log --only adminDeleteUser`
3. Права: вызывающий пользователь должен быть Admin
4. CompanyId: оба пользователя должны быть в одной компании

## ✅ Чеклист развертывания

- [ ] Firebase Project создан
- [ ] `.env.local` настроен с credentials
- [ ] Authentication включен (Email/Password + Google)
- [ ] Firestore Database создан
- [ ] Storage создан
- [ ] Firebase CLI установлен и аутентифицирован
- [ ] `.firebaserc` настроен с правильным Project ID
- [ ] `functions/node_modules` установлены
- [ ] Firestore Rules развернуты
- [ ] Storage Rules развернуты
- [ ] Cloud Functions развернуты
- [ ] Тестовый пользователь создан
- [ ] Роль Admin установлена тестовому пользователю
- [ ] Страница /admin/team работает
- [ ] Загрузка аватара работает
- [ ] Cloud Function adminDeleteUser работает

## 🎉 Готово!

После выполнения всех шагов ваше приложение полностью настроено и готово к работе!

**Следующие шаги:**
1. Создайте реальных пользователей
2. Настройте компанию
3. Пригласите сотрудников
4. Разверните на Firebase Hosting (опционально):
   ```bash
   npm run build
   firebase deploy --only hosting
   ```
