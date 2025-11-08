# 👥 Admin: Создание Пользователей с Иерархией

**Дата**: 2025-11-06
**Версия**: V1.0
**Статус**: ✅ **READY FOR DEPLOYMENT**

---

## 🎯 КРАТКОЕ РЕЗЮМЕ

### Новая Функциональность
Admin теперь может **создавать пользователей напрямую** с паролем и установкой иерархии (Reports To), без необходимости отправки email-приглашений.

### Отличие от Invite:
| Функция | Invite User | Create User (NEW) |
|---------|-------------|-------------------|
| **Метод** | Email с ссылкой | Прямое создание |
| **Пароль** | Устанавливает сам | Задает admin |
| **Доступ** | После клика по ссылке | Сразу после создания |
| **Иерархия** | Нет | Да (reportsTo) |
| **Use Case** | Внешние пользователи | Внутренние сотрудники |

---

## 📋 ЧТО РЕАЛИЗОВАНО

### 1️⃣ Backend: Cloud Function

**Файл**: `functions/src/adminCreateUserWithPassword.ts`

**Function Name**: `admin_createUserWithPassword`

**Type**: `httpsCallable` (вызывается с фронтенда)

#### Безопасность:
```typescript
✅ Auth Guard: Только company_admin, super_admin или admin
✅ Role Check: context.auth.token.role
✅ Company Isolation: Новый пользователь получает companyId создателя
✅ Manager Validation: reportsTo должен быть из той же компании
```

#### Входные Данные (CreateUserData):
```typescript
{
  email: string;           // Email нового пользователя
  password: string;        // Пароль (минимум 6 символов)
  displayName: string;     // Имя и фамилия
  role: UserRole;          // 'manager' | 'user' | 'estimator' | 'guest'
  reportsTo?: string;      // UID руководителя (опционально)
  title?: string;          // Должность (опционально)
}
```

#### Что Делает Function:
1. **Проверяет права** вызывающего (auth guard)
2. **Валидирует данные** (email, password, role, reportsTo)
3. **Создает в Firebase Auth** (`admin.auth().createUser()`)
4. **Создает профиль в Firestore** (`users/{uid}`)
5. **Устанавливает custom claims** (role, companyId)
6. **Логирует действие** (activityLogs collection)
7. **Rollback при ошибке** (удаляет из Auth если Firestore failed)

#### Обработка Ошибок:
```typescript
✅ 'auth/email-already-exists' → 'Email уже используется'
✅ 'auth/invalid-password' → 'Пароль не соответствует требованиям'
✅ 'permission-denied' → 'Только администраторы могут создавать'
✅ 'not-found' → 'Указанный руководитель не найден'
✅ 'invalid-argument' → Валидация входных данных
```

---

### 2️⃣ Frontend: React Component

**Файл**: `src/components/admin/CreateUserDialog.tsx`

**Component**: `<CreateUserDialog />`

**Type**: Modal Dialog (MUI)

#### UI Features:
```typescript
✅ Форма с валидацией (react-hook-form)
✅ Поле Email (с валидацией формата)
✅ Поле Password (с показом/скрытием)
✅ Поле Display Name (имя и фамилия)
✅ Поле Title (должность, опционально)
✅ Dropdown Role (выбор роли)
✅ Dropdown Reports To (выбор руководителя из списка managers)
✅ Loading состояние
✅ Success/Error уведомления
```

#### Валидация Полей:
```typescript
displayName: required, minLength(2)
email: required, pattern(email format)
password: required, minLength(6)
role: required
reportsTo: optional
title: optional
```

#### Логика Reports To:
- **Загружает** всех managers и admins из компании
- **Фильтрует** только активных пользователей
- **Показывает** displayName, role, email в dropdown
- **Отправляет** UID выбранного руководителя в функцию

---

### 3️⃣ Integration: TeamAdminPage

**Файл**: `src/pages/admin/TeamAdminPage.tsx`

**Изменения**:
- ✅ Импорт `CreateUserDialog`
- ✅ Состояние `createUserDialogOpen`
- ✅ Кнопка "Добавить участника" с dropdown menu:
  - "Создать напрямую (с паролем)" → `CreateUserDialog`
  - "Пригласить по email" → `InviteUserDialog`
- ✅ Refresh списка после создания

---

## 🚀 DEPLOYMENT GUIDE

### Шаг 1: Build Functions

```bash
cd functions
npm run build

# Проверка что компилируется без ошибок
# Expected: успешная компиляция TypeScript
```

### Шаг 2: Deploy Function

```bash
firebase deploy --only functions:admin_createUserWithPassword

# Ожидаемый результат:
# ✔ functions[admin_createUserWithPassword(us-central1)] Successful create operation.
```

### Шаг 3: Build Frontend

```bash
npm run build

# Проверка что собирается без ошибок
```

### Шаг 4: Deploy Hosting

```bash
firebase deploy --only hosting

# Ожидаемый результат:
# ✔ hosting[profit-step]: release complete
```

### Шаг 5: Verify Deployment

```bash
# 1. Проверка что функция задеплоена
firebase functions:list | grep admin_createUserWithPassword

# Expected output:
# │ admin_createUserWithPassword  │ v1   │ callable │ us-central1 │ 256 │ nodejs20 │

# 2. Открыть app и проверить UI
open "https://profit-step.web.app/admin/team"
```

---

## 🧪 ТЕСТИРОВАНИЕ

### Manual Testing Plan

#### 1. UI Test - Открытие Диалога

```
1. Логин как Admin
2. Открыть /admin/team
3. Нажать "Добавить участника"
4. Убедиться что появилось меню с 2 опциями:
   ✅ "Создать напрямую (с паролем)"
   ✅ "Пригласить по email"
5. Выбрать "Создать напрямую"
6. Убедиться что открылся CreateUserDialog
```

#### 2. Form Validation Test

```
1. Оставить все поля пустыми → Submit
   ✅ Показываются ошибки валидации

2. Ввести некорректный email → Submit
   ✅ "Некорректный формат email"

3. Ввести пароль < 6 символов → Submit
   ✅ "Минимум 6 символов"

4. Заполнить корректно все обязательные поля → Submit
   ✅ Форма отправляется
```

#### 3. Function Test - Создание Пользователя

```
1. Заполнить форму:
   - Display Name: "Test User"
   - Email: "testuser@example.com"
   - Password: "test123"
   - Role: "User"
   - Reports To: (выбрать любого manager)
   - Title: "Developer"

2. Нажать "Создать пользователя"
   ✅ Показывается CircularProgress
   ✅ Через 2-3 сек показывается "Пользователь успешно создан"
   ✅ Диалог закрывается
   ✅ Список обновляется (новый пользователь появляется)
```

#### 4. Firestore Test - Проверка Данных

```bash
# Открыть Firebase Console
open "https://console.firebase.google.com/project/profit-step/firestore/data/users"

# Найти созданного пользователя
# Проверить поля:
✅ email: "testuser@example.com"
✅ displayName: "Test User"
✅ role: "user"
✅ reportsTo: (UID руководителя)
✅ title: "Developer"
✅ companyId: (ID компании админа)
✅ status: "active"
✅ createdAt: (timestamp)
✅ createdBy: (UID админа)
```

#### 5. Auth Test - Логин Созданного Пользователя

```
1. Logout
2. Попробовать логин с:
   - Email: "testuser@example.com"
   - Password: "test123"
3. Убедиться что:
   ✅ Логин успешен
   ✅ Пользователь попадает в систему
   ✅ Role корректная (user)
```

#### 6. Error Handling Test - Duplicate Email

```
1. Попробовать создать пользователя с email который уже существует
   ✅ Показывается ошибка "Email уже используется"
   ✅ Диалог не закрывается
   ✅ Форма остается заполненной
```

#### 7. Security Test - Permission Denied

```
1. Logout из admin аккаунта
2. Логин как обычный user (role: 'user')
3. Попробовать вызвать функцию напрямую из консоли:
   const createUser = httpsCallable(functions, 'admin_createUserWithPassword');
   await createUser({ email: 'test@test.com', ... });

   ✅ Получаем ошибку "permission-denied"
   ✅ Функция НЕ выполняется
```

---

## 📊 FIRESTORE STRUCTURE

### Collection: users/{userId}

```typescript
{
  id: string;                        // UID пользователя
  email: string;                     // Email (lowercase)
  displayName: string;               // Имя и фамилия
  role: UserRole;                    // Роль: manager, user, estimator, guest
  companyId: string;                 // ID компании
  reportsTo: string | null;          // UID руководителя (НОВОЕ!)
  title: string | null;              // Должность
  status: 'active' | 'inactive';     // Статус
  createdAt: Timestamp;              // Дата создания
  createdBy: string;                 // UID создателя (НОВОЕ!)
  loginCount: number;                // Количество логинов
  onboarded: boolean;                // Прошел onboarding
  photoURL: string | null;           // URL аватара
  lastSeen?: Timestamp;              // Последний вход
}
```

### Collection: activityLogs

```typescript
{
  type: 'user_created_by_admin';     // Тип события
  userId: string;                    // UID созданного пользователя
  createdBy: string;                 // UID админа
  companyId: string;                 // ID компании
  details: {
    email: string;
    displayName: string;
    role: string;
    reportsTo: string | null;
  };
  timestamp: Timestamp;              // Время события
}
```

---

## 🔐 SECURITY RULES

### Firestore Rules Update

Убедитесь что в `firestore.rules` есть доступ к полю `reportsTo`:

```javascript
match /users/{userId} {
  allow read: if request.auth != null;

  allow create, update: if request.auth != null
    && (
      request.auth.token.role == 'admin'
      || request.auth.token.role == 'company_admin'
      || request.auth.token.role == 'super_admin'
    );

  // Поле reportsTo может обновляться админами
  allow update: if request.auth != null
    && request.auth.token.role in ['admin', 'company_admin']
    && request.resource.data.diff(resource.data).affectedKeys()
      .hasOnly(['reportsTo']);
}
```

---

## 🎯 USE CASES

### Use Case 1: Onboarding New Employee

```
Сценарий: HR добавляет нового сотрудника

1. Admin открывает TeamAdminPage
2. Нажимает "Добавить участника" → "Создать напрямую"
3. Заполняет:
   - Display Name: "Иван Иванов"
   - Email: "ivan@company.com"
   - Password: "welcome123" (временный пароль)
   - Role: "User"
   - Reports To: (выбирает менеджера)
   - Title: "Junior Developer"
4. Создает пользователя
5. Отдает Ивану credentials:
   - Email: ivan@company.com
   - Password: welcome123
6. Иван логинится и меняет пароль в настройках

Результат: ✅ Сотрудник добавлен в систему с правильной иерархией
```

### Use Case 2: Building Org Chart

```
Сценарий: Построение организационной структуры

Company Structure:
CEO (Alice)
├── CTO (Bob)
│   ├── Tech Lead (Charlie)
│   │   ├── Developer 1 (David)
│   │   └── Developer 2 (Eve)
│   └── DevOps (Frank)
└── CMO (Grace)
    └── Marketing Manager (Helen)

Steps:
1. Создать CEO (Alice) - reportsTo: null
2. Создать CTO (Bob) - reportsTo: Alice
3. Создать Tech Lead (Charlie) - reportsTo: Bob
4. Создать Developer 1 (David) - reportsTo: Charlie
5. И так далее...

Результат: ✅ Полная иерархия организации в Firestore
```

### Use Case 3: Bulk User Creation

```
Сценарий: Массовое добавление пользователей

HR имеет список из 50 новых сотрудников Excel:
Name | Email | Role | Manager | Title

Подход:
1. Создать скрипт который читает Excel
2. Для каждой строки вызывает admin_createUserWithPassword
3. Логирует успешные/неудачные создания
4. Отправляет credentials новым пользователям

Результат: ✅ Быстрое добавление большой команды
```

---

## 🐛 TROUBLESHOOTING

### Problem 1: "Email уже используется"

**Симптом**:
```
Error: Email test@example.com уже используется другим пользователем
```

**Причина**: Email уже зарегистрирован в Firebase Auth

**Решение**:
1. Проверить существующих пользователей:
   ```bash
   firebase auth:export users.json
   grep "test@example.com" users.json
   ```
2. Либо удалить старого пользователя, либо использовать другой email

---

### Problem 2: "Руководитель не найден"

**Симптом**:
```
Error: Указанный руководитель не найден
```

**Причина**: UID в reportsTo не существует или удален

**Решение**:
1. Проверить что UID руководителя корректный:
   ```bash
   firebase firestore:get users/{reportsToUID}
   ```
2. Убедиться что руководитель из той же компании

---

### Problem 3: Dropdown "Reports To" Пустой

**Симптом**:
Dropdown "Руководитель" пустой, не загружаются managers

**Причина**:
- Нет managers в компании
- Ошибка загрузки из Firestore

**Решение**:
```typescript
// Проверить консоль браузера
// Должно быть: "✅ Loaded N potential managers"

// Если загрузка failed:
1. Проверить Firestore rules
2. Проверить что в компании есть users с role='manager'
3. Проверить что companyId корректный
```

---

### Problem 4: Function Permission Denied

**Симптом**:
```
Error: permission-denied - Только администраторы могут создавать пользователей
```

**Причина**: Текущий пользователь не имеет роль admin

**Решение**:
1. Проверить роль в Firebase Auth custom claims:
   ```bash
   firebase auth:export users.json
   grep "your-uid" users.json
   # Проверить customClaims.role
   ```
2. Если role некорректная - обновить:
   ```typescript
   await admin.auth().setCustomUserClaims(uid, {
     role: 'admin',
     companyId: 'your-company'
   });
   ```

---

## 📈 NEXT STEPS (Future Improvements)

### Short-term:
1. ✅ **Deploy функцию** и протестировать
2. ⏳ **Add Password Reset** - кнопка "Reset Password" для созданных пользователей
3. ⏳ **Email Notification** - отправка email с credentials после создания
4. ⏳ **Bulk Import** - CSV/Excel импорт множества пользователей

### Mid-term:
5. ⏳ **Org Chart Visualization** - визуальное отображение иерархии
6. ⏳ **Permission Inheritance** - наследование прав от руководителя
7. ⏳ **Manager Dashboard** - страница для просмотра своих подчиненных
8. ⏳ **Approval Workflow** - согласование создания с вышестоящим руководством

### Long-term:
9. ⏳ **LDAP/AD Integration** - синхронизация с Active Directory
10. ⏳ **SSO Support** - Single Sign-On
11. ⏳ **Multi-tenant** - поддержка нескольких компаний с изоляцией
12. ⏳ **Analytics** - отчеты по иерархии и структуре команды

---

## 📚 API REFERENCE

### Cloud Function: admin_createUserWithPassword

**Type**: `httpsCallable`

**Endpoint**:
```
https://us-central1-profit-step.cloudfunctions.net/admin_createUserWithPassword
```

**Request**:
```typescript
{
  email: string;         // Required
  password: string;      // Required, min 6 chars
  displayName: string;   // Required, min 2 chars
  role: UserRole;        // Required: 'manager'|'user'|'estimator'|'guest'
  reportsTo?: string;    // Optional: UID of manager
  title?: string;        // Optional: job title
}
```

**Response**:
```typescript
{
  success: boolean;
  message: string;
  userId: string;        // UID созданного пользователя
  userEmail: string;     // Email (lowercase)
}
```

**Errors**:
```typescript
- 'unauthenticated': Требуется аутентификация
- 'permission-denied': Недостаточно прав
- 'invalid-argument': Некорректные данные
- 'already-exists': Email уже используется
- 'not-found': Руководитель не найден
- 'internal': Внутренняя ошибка сервера
```

---

## 🎉 CONCLUSION

**Новая функциональность "Create User with Hierarchy" готова к production!**

### Что Достигнуто:
- ✅ **Безопасная** Cloud Function с auth guards
- ✅ **Удобный UI** с валидацией и выбором руководителя
- ✅ **Полная интеграция** в TeamAdminPage
- ✅ **Rollback механизм** при ошибках
- ✅ **Activity logging** для аудита
- ✅ **Документация** с примерами и troubleshooting

### Преимущества:
- 🚀 **Быстрое добавление** сотрудников без email-приглашений
- 📊 **Построение иерархии** для org chart
- 🔐 **Безопасность** через role-based access control
- 💼 **Use Cases**: HR onboarding, bulk import, org structure

---

**Создано**: 2025-11-06
**Автор**: Claude Code + Denis Garbuzov
**Статус**: ✅ **READY FOR PRODUCTION**

**🎉 Ready to deploy and test!**
