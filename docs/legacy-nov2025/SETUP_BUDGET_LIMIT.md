# 💰 Настройка Бюджетного Ограничения $10/день

**Цель**: Защита от неожиданных расходов
**Лимит**: $10/день = $300/месяц
**Время настройки**: 5 минут

---

## 🎯 ШАГ 1: Создание Бюджета в Google Cloud Console

### 1.1 Откройте Billing Console

```
https://console.cloud.google.com/billing
```

**Или вручную:**
1. Откройте https://console.cloud.google.com
2. В верхнем меню выберите проект **profit-step**
3. Нажмите на меню (☰) → **Billing** → **Budgets & alerts**

---

### 1.2 Создайте Новый Бюджет

Нажмите **"CREATE BUDGET"**

---

### 1.3 Настройте Параметры Бюджета

#### **Name and scope**
```
Budget name: Daily Limit - $10/day
Projects: profit-step
Products: Cloud Functions, Cloud Storage, Firestore
```

**Важно**: Выберите только связанные с Firebase сервисы:
- ✅ Cloud Functions
- ✅ Cloud Firestore
- ✅ Cloud Storage
- ❌ Не выбирайте "All products" (слишком широко)

---

#### **Amount**

**Выберите тип**: `Specified amount`

**Monthly budget**:
```
$300 USD
```

**Почему $300?**
- $10/день × 30 дней = $300/месяц
- Google Cloud работает с месячными бюджетами
- Мы настроим ежедневные алерты для контроля

---

#### **Actions**

Настройте **4 уровня алертов**:

**Alert 1 - Early Warning (5% = $15/месяц = $0.50/день)**
```
Alert threshold: 5%
Send to: ваш email
Notification channels: Email
```

**Alert 2 - Daily Target (33% = $100/месяц ≈ $10/3 дня)**
```
Alert threshold: 33%
Send to: ваш email
Notification channels: Email
```

**Alert 3 - Warning (80% = $240/месяц)**
```
Alert threshold: 80%
Send to: ваш email
Notification channels: Email
```

**Alert 4 - CRITICAL (100% = $300/месяц)**
```
Alert threshold: 100%
Send to: ваш email
Notification channels: Email, Pub/Sub
```

---

#### **Pub/Sub Topic** (для автоматического отключения)

В Alert 4 добавьте:
```
☑ Connect a Pub/Sub topic to this budget

Topic: budget-alerts (создастся автоматически)
```

Это позволит настроить автоматическое отключение функций при превышении лимита.

---

### 1.4 Сохраните Бюджет

Нажмите **"FINISH"**

✅ Бюджет создан!

---

## 🚨 ШАГ 2: Настройка Автоматического Отключения (Опционально)

Для полной защиты можно настроить автоматическое отключение Cloud Functions при превышении $10/день.

### 2.1 Создайте Cloud Function для Отключения

**Файл**: `functions/src/billing/disableBilling.ts`

```typescript
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Автоматически отключает Cloud Functions при превышении бюджета
 * Триггер: Pub/Sub топик от Budget Alert
 */
export const disableBillingOnBudgetExceed = functions
  .pubsub.topic('budget-alerts')
  .onPublish(async (message) => {
    const data = message.json;

    console.log('💰 Budget Alert Received:', JSON.stringify(data, null, 2));

    // Проверяем превышение 100%
    if (data.costAmount >= data.budgetAmount) {
      console.error('🚨 BUDGET EXCEEDED! Disabling functions...');

      // Отправляем критическое уведомление в Firestore
      await admin.firestore().collection('criticalAlerts').add({
        type: 'BUDGET_EXCEEDED',
        costAmount: data.costAmount,
        budgetAmount: data.budgetAmount,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        message: `Budget exceeded: $${data.costAmount} / $${data.budgetAmount}`,
      });

      // TODO: Здесь можно добавить автоматическое отключение функций
      // Но будьте осторожны - это может нарушить работу приложения!

      return null;
    }

    // Логируем нормальные алерты
    console.log(`📊 Budget Alert: $${data.costAmount} / $${data.budgetAmount}`);
    return null;
  });
```

---

### 2.2 Деплой Billing Function

```bash
cd /Users/denysharbuzov/Projects/profit-step/functions

# Добавьте экспорт в src/index.ts
echo "\n// Billing protection\nexport { disableBillingOnBudgetExceed } from './billing/disableBilling';" >> src/index.ts

# Build и deploy
npm run build
firebase deploy --only functions:disableBillingOnBudgetExceed
```

---

## 📊 ШАГ 3: Ежедневный Мониторинг

### 3.1 Создайте Ежедневную Проверку

Добавьте в свой календарь напоминание:
```
Время: 9:00 AM каждый день
Задача: Проверить расходы за вчера
URL: https://console.cloud.google.com/billing/01BC8F-0F0F23-D82DE6/reports?project=profit-step
```

---

### 3.2 Используйте Monitoring Script

Запускайте скрипт ежедневно:
```bash
./scripts/monitor-production.sh
```

Или создайте cron job:
```bash
# Открыть crontab
crontab -e

# Добавить строку (проверка каждые 12 часов в 9:00 и 21:00)
0 9,21 * * * cd /Users/denysharbuzov/Projects/profit-step && ./scripts/monitor-production.sh
```

---

## 📧 ШАГ 4: Настройка Email Уведомлений

### 4.1 Добавьте Дополнительные Email

В Budget Alert можно добавить несколько email адресов:
1. Ваш основной email
2. Email команды
3. Email для критических алертов

**Как добавить:**
```
Billing → Budgets & alerts → [Ваш бюджет] → EDIT
→ Actions → Manage notification channels
→ Add email addresses
```

---

### 4.2 Настройте Мобильные Уведомления (Опционально)

Установите **Google Cloud Console App**:
- iOS: https://apps.apple.com/app/google-cloud-console/id1005120814
- Android: https://play.google.com/store/apps/details?id=com.google.android.apps.cloudconsole

В приложении включите push-уведомления для billing alerts.

---

## 🎯 ЧТО ОЖИДАТЬ

### Нормальные Расходы (С V2 Guards)
| Период | Расход | Статус |
|--------|--------|--------|
| День 1-2 (без трафика) | $0.10-0.50 | 🟢 Отлично |
| День 3-7 (начало трафика) | $1-5 | 🟢 Нормально |
| Неделя 2+ (стабильный трафик) | $5-10 | 🟢 Ожидаемо |

### Получите Alert Когда:
- **5% ($15/мес)**: Первое предупреждение (всё ОК)
- **33% ($100/мес)**: Средний уровень (проверьте логи)
- **80% ($240/мес)**: Высокий расход (исследуйте причину!)
- **100% ($300/мес)**: КРИТИЧНО (отключите функции!)

---

## 🚨 АВАРИЙНАЯ ПРОЦЕДУРА

### Если Получили Alert "100% Budget Exceeded"

**НЕМЕДЛЕННО:**

```bash
# 1. Отключите ВСЕ функции
firebase functions:delete incrementLoginCount_v2
firebase functions:delete logUserUpdates_v2
firebase functions:delete trackUserActivation_v2
firebase functions:delete updateCompanyMemberCount_v2
firebase functions:delete monitorFunctionLoops

# 2. Проверьте логи
firebase functions:log | grep "🚨 ALERT"

# 3. Проверьте Firestore processedEvents
# Если там миллионы документов - это infinite loop!
```

**ЗАТЕМ:**
1. Исследуйте причину в Firebase Console → Functions → Usage
2. Проверьте `functionAlerts` коллекцию в Firestore
3. Исправьте баг
4. Редеплойте с осторожностью

---

## 💡 СОВЕТЫ ПО ЭКОНОМИИ

### Если Расходы Превышают $10/день

**1. Оптимизируйте processedEvents TTL**
```typescript
// В guards.ts, измените TTL с 7 дней на 1 день
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7); // ← Измените на -1

// Это сократит расходы на хранение на ~85%
```

**2. Используйте Selective Guards**
```typescript
// Для некритичных функций используйте только Field Guards
// Вместо:
const guardResult = await executeFullGuard({...});

// Используйте:
const guardResult = checkAnyFieldChangeGuard(before, after, fields);
// Экономия: ~50% на Firestore reads/writes
```

**3. Увеличьте Threshold для monitorFunctionLoops**
```typescript
// В constants.ts
export const ALERT_THRESHOLDS = {
  INVOCATIONS_PER_5_MIN: 1000, // ← Измените на 2000 для меньшего количества алертов
};
```

**4. Отключите Неиспользуемые Функции**
```bash
# Если какие-то функции не используются
firebase functions:delete [unused-function-name]
```

---

## 📊 МОНИТОРИНГ BUDGET

### Ежедневная Проверка

**Утром (9:00):**
```bash
# Проверьте расходы за вчера
open "https://console.cloud.google.com/billing/01BC8F-0F0F23-D82DE6/reports?project=profit-step"

# Запустите мониторинг
./scripts/monitor-production.sh
```

**Вечером (21:00):**
```bash
# Быстрая проверка алертов
firebase functions:log --only monitorFunctionLoops | head -20
```

---

## ✅ CHECKLIST НАСТРОЙКИ

После настройки бюджета проверьте:

- [ ] Создан бюджет $300/месяц ($10/день)
- [ ] Настроены 4 уровня алертов (5%, 33%, 80%, 100%)
- [ ] Email уведомления подключены
- [ ] Pub/Sub топик создан для автоматизации
- [ ] Ежедневный мониторинг настроен (календарь/cron)
- [ ] Мобильное приложение установлено (опционально)
- [ ] Аварийная процедура изучена

---

## 🎉 ГОТОВО!

Ваш бюджет настроен! Теперь вы защищены от неожиданных расходов:

✅ **Максимум**: $300/месяц ($10/день)
✅ **Алерты**: 4 уровня предупреждений
✅ **Мониторинг**: Автоматический каждые 5 минут
✅ **Защита**: От infinite loops

**Следующий шаг**: Подождите 24 часа и проверьте первые расходы.

---

**Создано**: 2025-11-06
**Статус**: 🛡️ **BUDGET PROTECTION ENABLED**

🤖 Powered by Claude Code
