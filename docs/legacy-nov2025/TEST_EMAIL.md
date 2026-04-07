# 🧪 Тестирование Email интеграции с Brevo

## Обзор

Временная Cloud Function `testEmail` для проверки интеграции Brevo SMTP.

## 🚀 Быстрый старт

### 1. Разверните функцию

```bash
cd functions
npm run build
firebase deploy --only functions:testEmail
```

### 2. Вызовите из консоли браузера

Откройте приложение (https://profit-step.web.app), войдите как любой пользователь, откройте DevTools (F12) и вставьте в консоль:

```javascript
// Импорты Firebase (если еще не импортированы)
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';

// Получаем экземпляры
const functions = getFunctions();
const auth = getAuth();

// Проверяем аутентификацию
if (!auth.currentUser) {
  console.error('❌ Вы не аутентифицированы! Войдите в систему сначала.');
} else {
  console.log('✅ Аутентифицирован как:', auth.currentUser.email);

  // Вызываем тестовую функцию
  const testEmail = httpsCallable(functions, 'testEmail');

  console.log('📤 Отправка тестового email...');

  testEmail()
    .then((result) => {
      console.log('✅ Успех!', result.data);
      console.log('📧 Email отправлен на:', result.data.recipient);
      console.log('🆔 Message ID:', result.data.messageId);
      console.log('🌐 SMTP:', result.data.smtp);
      alert('✅ Тестовое письмо отправлено! Проверьте email (включая SPAM).');
    })
    .catch((error) => {
      console.error('❌ Ошибка:', error);
      console.error('Код ошибки:', error.code);
      console.error('Сообщение:', error.message);
      console.error('Детали:', error.details);
      alert('❌ Ошибка отправки: ' + error.message);
    });
}
```

### 3. Альтернатива: Создайте временную кнопку в UI

Добавьте в любой компонент (например, в `TeamManagement.tsx`):

```typescript
import { getFunctions, httpsCallable } from 'firebase/functions';

// В компоненте:
const handleTestEmail = async () => {
  try {
    const functions = getFunctions();
    const testEmail = httpsCallable(functions, 'testEmail');

    console.log('📤 Отправка тестового email...');
    const result = await testEmail();

    console.log('✅ Результат:', result.data);
    alert('✅ Тестовое письмо отправлено! Проверьте email.');
  } catch (error: any) {
    console.error('❌ Ошибка:', error);
    alert('❌ Ошибка: ' + error.message);
  }
};

// В JSX:
<Button onClick={handleTestEmail} variant="outlined" color="secondary">
  🧪 Test Email
</Button>
```

## 📊 Проверка результатов

### 1. Проверьте консоль браузера

Должен появиться успешный результат:

```javascript
✅ Успех! {
  success: true,
  messageId: "<...@smtp-relay.brevo.com>",
  recipient: "your-email@example.com",
  smtp: "smtp-relay.brevo.com:587",
  message: "Тестовое письмо успешно отправлено! Проверьте ваш email (включая папку SPAM)."
}
```

### 2. Проверьте Firebase Logs

```bash
firebase functions:log --only testEmail
```

**Успешный вывод:**
```
🧪 Test email requested by user: abc123 (user@example.com)
📧 Email config loaded:
   Host: smtp-relay.brevo.com
   Port: 587
   User: 9a97e6001@smtp-brevo.com
   Password configured: true
✅ Transporter created successfully
📤 Sending test email to: user@example.com
✅ Test email sent successfully!
   Message ID: <...@smtp-relay.brevo.com>
   Response: 250 2.0.0 OK ...
```

**Если ошибка:**
```
❌ Test email failed with error:
   Error name: Error
   Error message: Invalid login: 535 Authentication failed
   SMTP Response: 535 Authentication failed
```

### 3. Проверьте Email

Письмо должно прийти в течение 1-2 минут. Проверьте:
- ✅ Inbox
- ✅ SPAM/Junk папку
- ✅ Promotions (Gmail)

**Тема письма:** `[TEST] Firebase ↔ Brevo`

## 🐛 Troubleshooting

### Ошибка: "Email configuration not set"

**Причина:** Firebase Functions Config не настроен

**Решение:**
```bash
firebase functions:config:set \
  email.host="smtp-relay.brevo.com" \
  email.port="587" \
  email.user="9a97e6001@smtp-brevo.com" \
  email.password="xsmtpsib-..."

firebase deploy --only functions:testEmail
```

### Ошибка: "Invalid login: 535 Authentication failed"

**Причина:** Неверные учетные данные Brevo

**Решение:**
1. Проверьте SMTP credentials в Brevo: https://app.brevo.com/settings/keys/smtp
2. Убедитесь, что используете SMTP Key, а не пароль аккаунта
3. Пересоздайте конфигурацию:
   ```bash
   firebase functions:config:unset email
   firebase functions:config:set \
     email.host="smtp-relay.brevo.com" \
     email.port="587" \
     email.user="ВАШ_LOGIN" \
     email.password="ВАШ_SMTP_KEY"
   firebase deploy --only functions:testEmail
   ```

### Ошибка: "ECONNREFUSED" или "ETIMEDOUT"

**Причина:** Не удается подключиться к SMTP серверу

**Решение:**
1. Проверьте интернет соединение
2. Убедитесь, что host и port правильные
3. Проверьте firewall/антивирус

### Email не приходит, но в логах успех

**Решение:**
1. Подождите 5-10 минут
2. Проверьте SPAM
3. Проверьте статус Brevo: https://status.brevo.com/
4. Проверьте квоты (300/день для бесплатного плана)
5. Проверьте, что sender верифицирован в Brevo

### Ошибка: "unauthenticated"

**Причина:** Пользователь не вошел в систему

**Решение:**
1. Войдите в приложение
2. Проверьте в консоли: `firebase.auth().currentUser`

## 🔒 Безопасность

**ВАЖНО:** Эта функция отправляет email только на адрес **аутентифицированного пользователя** (`context.auth.token.email`).

Невозможно:
- ❌ Отправить email на произвольный адрес
- ❌ Вызвать функцию без аутентификации
- ❌ Использовать для спама

## 🧹 Очистка

После успешного теста **ОБЯЗАТЕЛЬНО удалите** функцию из production:

### Вариант 1: Удалить только функцию
```bash
firebase functions:delete testEmail --force
```

### Вариант 2: Удалить из кода и передеплоить
1. Удалите функцию `testEmail` из `functions/src/index.ts` (строки 459-670)
2. Разверните:
   ```bash
   cd functions
   npm run build
   firebase deploy --only functions
   ```

## 📈 Статистика Brevo

После теста проверьте статистику в Brevo Dashboard:
- https://app.brevo.com/statistics/email

Вы увидите:
- Количество отправленных писем
- Доставляемость
- Открытия (если получатель открыл email)

---

## ✅ Чеклист тестирования

- [ ] Развернута функция `testEmail`
- [ ] Настроен Firebase Functions Config с Brevo credentials
- [ ] Вызвана функция из консоли браузера
- [ ] Проверены логи Firebase Functions
- [ ] Получено тестовое письмо в inbox/spam
- [ ] Письмо выглядит корректно (HTML + текстовая версия)
- [ ] Удалена функция `testEmail` после теста

---

**Готово!** 🎉 Если все работает, ваша интеграция Brevo настроена правильно и готова к использованию в `inviteUser` функции.
