# Тестирование Brevo Webhook Integration

## URL Webhook
```
https://us-central1-profit-step.cloudfunctions.net/brevoWebhookHandler
```

## Настройка в Brevo

1. Откройте: https://app.brevo.com/settings/webhooks
2. Add new webhook с URL выше
3. Выберите события:
   - email_delivered
   - email_opened
   - email_clicked
   - email_hard_bounced
   - email_soft_bounced
   - email_spam
   - email_blocked
   - email_unsubscribed

## Тестирование

### Метод 1: Через Brevo Dashboard
После настройки webhook, Brevo автоматически отправит тестовое событие

### Метод 2: Через Firebase Functions (simulate webhook)
```typescript
// В консоли браузера (после логина)
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const testWebhook = httpsCallable(functions, 'testBrevoWebhook');

// Симулируем событие "delivered"
await testWebhook({
  email: 'test@example.com',
  eventType: 'delivered'
});

// Симулируем событие "opened"
await testWebhook({
  email: 'test@example.com',
  eventType: 'opened'
});

// Симулируем событие "hard_bounce"
await testWebhook({
  email: 'test@example.com',
  eventType: 'hard_bounce'
});
```

### Метод 3: Прямой HTTP запрос (для тестирования)
```bash
curl -X POST https://us-central1-profit-step.cloudfunctions.net/brevoWebhookHandler \
  -H "Content-Type: application/json" \
  -d '{
    "event": "delivered",
    "email": "test@example.com",
    "message-id": "test-123",
    "subject": "Test Invitation",
    "tag": "invitation",
    "date": "2024-01-15 10:30:00"
  }'
```

## Проверка логов

### Firebase Console
```bash
# Открыть логи в браузере
firebase functions:log --only brevoWebhookHandler

# Или в консоли
open https://console.firebase.google.com/project/profit-step/functions/logs
```

### Что проверять
1. ✅ Webhook получил событие
2. ✅ Событие записано в `emailEvents` collection
3. ✅ Статус приглашения обновлен в `invitations` collection
4. ✅ Уведомление создано для админа (если bounce/spam)

## Структура события от Brevo

Пример payload, который Brevo отправляет:

```json
{
  "event": "delivered",
  "email": "user@example.com",
  "id": 12345,
  "date": "2024-01-15 10:30:45",
  "ts": 1705316645,
  "message-id": "<202401151030.12345@smtp-relay.brevo.com>",
  "subject": "Приглашение в Profit Step",
  "tag": "invitation",
  "sending_ip": "185.41.28.123",
  "ts_event": 1705316645
}
```

## Workflow

### 1. Отправка приглашения
```
Admin → inviteUser() → Email → Brevo SMTP
                              ↓
                        Запись в invitations
                        status: 'pending'
```

### 2. Обработка событий
```
Brevo → Webhook → brevoWebhookHandler()
                       ↓
                  emailEvents (запись события)
                       ↓
                  invitations (обновление статуса)
                       ↓
                  notifications (если ошибка)
```

### 3. Отслеживание в UI
```
CompanyDashboard → Invitations Tab
                       ↓
                  Показывает статус в реальном времени:
                  - Pending (серый)
                  - Delivered (синий)
                  - Opened (зеленый)
                  - Bounced (красный)
                  - Spam (оранжевый)
```

## Firestore Collections

### emailEvents
```typescript
{
  email: "user@example.com",
  eventType: "delivered" | "opened" | "bounced" | "spam",
  messageId: "msg-123",
  reason?: "Mailbox full" | "Invalid email",
  timestamp: Timestamp
}
```

### invitations (обновляется)
```typescript
{
  email: "user@example.com",
  status: "pending" | "delivered" | "opened" | "accepted" | "failed",
  deliveryStatus: "delivered",
  openedAt?: Timestamp,
  failureReason?: "hard_bounce" | "spam"
}
```

## Безопасность

⚠️ **TODO:** Добавить проверку signature от Brevo

Brevo может отправлять signature для проверки подлинности webhook:

```typescript
// В будущем добавить в brevoWebhookHandler
const signature = req.headers['x-brevo-signature'];
if (!verifyBrevoSignature(signature, req.body)) {
  res.status(401).send('Invalid signature');
  return;
}
```

## Мониторинг

### Метрики для отслеживания
- Delivery rate (должен быть > 95%)
- Bounce rate (должен быть < 5%)
- Open rate (информационный)
- Spam rate (должен быть < 1%)

### Алерты
- Email bounce rate > 10% → уведомление админу
- Invitation failed → toast notification
- Проблемы с Brevo API → system error log

## Полезные ссылки

- Brevo Webhook Docs: https://developers.brevo.com/docs/webhooks
- Firebase Console: https://console.firebase.google.com/project/profit-step/functions
- Brevo Dashboard: https://app.brevo.com/campaign/listing/sent
