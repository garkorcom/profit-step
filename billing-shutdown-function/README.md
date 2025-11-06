# Budget Alert Handler - Auto Billing Shutoff

## Что делает эта функция

Автоматически отключает billing проекта `profit-step` при превышении бюджета на 500% ($50 при бюджете $10).

## Deployment

### Шаг 1: Установите dependencies (опционально, для локального тестирования)

```bash
npm install
```

### Шаг 2: Deploy функции в Google Cloud

```bash
gcloud functions deploy handleBudgetAlert \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=handleBudgetAlert \
  --trigger-topic=budget-alerts \
  --set-env-vars=GCP_PROJECT=profit-step
```

### Шаг 3: Дайте права на отключение billing

Эта функция нуждается в специальных правах для отключения billing.

**Вариант A: Через Console (рекомендуется)**

1. Откройте: https://console.cloud.google.com/iam-admin/iam
2. Найдите service account функции (формат: `PROJECT_ID@appspot.gserviceaccount.com`)
3. Нажмите "Edit" (карандаш)
4. Нажмите "+ ADD ANOTHER ROLE"
5. Добавьте роль: `Billing Project Manager` или `roles/billing.projectManager`
6. Сохраните

**Вариант B: Через gcloud CLI**

Сначала получите organization ID:
```bash
gcloud organizations list
```

Затем дайте права:
```bash
gcloud organizations add-iam-policy-binding YOUR_ORG_ID \
  --member=serviceAccount:profit-step@appspot.gserviceaccount.com \
  --role=roles/billing.projectManager
```

### Шаг 4: Тестирование

Проверьте что функция задеплоена:
```bash
gcloud functions describe handleBudgetAlert --region=us-central1 --gen2
```

Проверьте логи:
```bash
gcloud functions logs read handleBudgetAlert --region=us-central1 --gen2
```

## Как работает

1. Google Cloud Budget отправляет уведомление в Pub/Sub topic `budget-alerts`
2. Cloud Function подписана на этот topic
3. При получении сообщения функция проверяет percentSpent
4. Если percentSpent >= 500%:
   - Отключает billing через Cloud Billing API
   - Логирует действие
   - Проект больше не может создавать новые ресурсы
5. Если percentSpent < 500%:
   - Логирует "OK" и ничего не делает

## Важно

- Это аварийная мера для защиты от катастрофических счетов
- После отключения billing проект перестанет работать
- Чтобы включить billing обратно: https://console.cloud.google.com/billing
- Рекомендуется сначала исправить проблему (infinite loop) перед включением

## Мониторинг

Проверяйте логи функции регулярно:
```bash
gcloud functions logs read handleBudgetAlert --region=us-central1 --gen2 --limit=50
```

Ищите:
- `✅ Budget OK` - нормально
- `🚨 CRITICAL` - billing был отключен!
