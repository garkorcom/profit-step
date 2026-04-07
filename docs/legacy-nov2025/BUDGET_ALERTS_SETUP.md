# Google Cloud Budget Alerts - Quick Setup Guide

## 🎯 Цель
Предотвратить повторение ситуации с $174 счетом за 5 дней.

## 🛡️ Три уровня защиты

1. ✅ **Code-level** (DONE): Idempotency Guards в Functions
2. ✅ **Development-level** (DONE): Firebase Emulators для тестирования
3. ⚠️ **Infrastructure-level** (TODO): Budget Alerts + Auto Shutoff

---

## 📊 Уровень 3: Настройка Budget Alerts

### Шаг 1: Создание бюджета

1. **Откройте Google Cloud Console**:
   ```
   https://console.cloud.google.com/billing
   ```

2. **Перейдите в Budgets & alerts**:
   - Левое меню → Billing → Budgets & alerts
   - Или прямая ссылка: https://console.cloud.google.com/billing/budgets

3. **Создайте новый бюджет**:
   - Нажмите **CREATE BUDGET**

4. **Настройте детали бюджета**:

   **Scope (Область)**:
   - Projects: Выберите `profit-step` (ваш Firebase project)
   - Services: All services (или только Firebase services)
   - Time range: Monthly

   **Amount (Сумма)**:
   - Budget type: Specified amount
   - Target amount: **$10** (или $20 для запаса)
   - Include credits: No (чтобы видеть реальные расходы)

5. **Настройте Alert thresholds**:

   Рекомендуемые пороги:
   - ✅ **50% ($5)** → Email warning
   - ⚠️ **90% ($9)** → Email + SMS alert
   - 🚨 **100% ($10)** → Email + SMS + Pub/Sub trigger
   - 🔥 **500% ($50)** → CRITICAL - Auto shutoff (см. ниже)

   Для каждого порога:
   - Percent of budget: 50%, 90%, 100%, 500%
   - Trigger on: Actual spend (не Forecasted)

6. **Настройте Email notifications**:
   - Добавьте свои email адреса
   - Рекомендуется добавить 2-3 email на случай если один не придет

7. **Настройте Pub/Sub notification** (для автоматического отключения):
   - Включите "Connect a Pub/Sub topic to this budget"
   - Create new topic: `budget-alerts`
   - Запомните название топика!

8. **Нажмите FINISH**

---

## 🔔 Шаг 2: Настройка уведомлений

### Email настройки
- Проверьте что emails приходят (первое уведомление придет сразу после создания)
- Добавьте emails в whitelist / safe senders
- Настройте push-уведомления на телефоне для этих emails

### SMS настройки (опционально)
- Google Cloud Console → Monitoring → Alerting
- Create Alert Policy → Budget alerts
- Add notification channel → SMS
- Введите номер телефона

---

## 🤖 Шаг 3: Автоматическое отключение billing (CRITICAL!)

### Когда использовать
- Если бюджет превышен на 500% ($50 при бюджете $10)
- Это означает катастрофический infinite loop
- Нужно НЕМЕДЛЕННО остановить все траты

### Подход 1: Cloud Function + Pub/Sub (рекомендуется)

1. **Создайте проект для billing-shutdown функции**:
   ```bash
   mkdir -p billing-shutdown-function
   cd billing-shutdown-function
   ```

2. **Создайте package.json**:
   ```json
   {
     "name": "budget-alert-handler",
     "version": "1.0.0",
     "dependencies": {
       "@google-cloud/billing": "^3.0.0"
     }
   }
   ```

3. **Создайте index.js**:
   ```javascript
   const { CloudBillingClient } = require('@google-cloud/billing');
   const billing = new CloudBillingClient();

   exports.handleBudgetAlert = async (pubsubMessage, context) => {
     const pubsubData = JSON.parse(
       Buffer.from(pubsubMessage.data, 'base64').toString()
     );

     const costAmount = pubsubData.costAmount;
     const budgetAmount = pubsubData.budgetAmount;
     const percentSpent = (costAmount / budgetAmount) * 100;

     console.log(`📊 Budget Alert: ${percentSpent}% spent ($${costAmount} / $${budgetAmount})`);

     // Порог для автоматического отключения
     const CRITICAL_THRESHOLD = 500; // 500% = $50 при бюджете $10

     if (percentSpent >= CRITICAL_THRESHOLD) {
       console.log('🚨 CRITICAL: Disabling billing!');

       const projectId = process.env.GCP_PROJECT;
       const projectName = `projects/${projectId}`;

       try {
         // Отключаем billing
         await billing.updateProjectBillingInfo({
           name: projectName,
           projectBillingInfo: {
             billingAccountName: '', // Пустая строка = отключить billing
           },
         });

         console.log('✅ Billing disabled successfully');
         return 'Billing disabled';
       } catch (error) {
         console.error('❌ Error disabling billing:', error);
         throw error;
       }
     } else {
       console.log(`✅ Budget OK (${percentSpent}% < ${CRITICAL_THRESHOLD}%)`);
       return 'Budget within limits';
     }
   };
   ```

4. **Деплой функции**:
   ```bash
   gcloud functions deploy handleBudgetAlert \
     --runtime nodejs20 \
     --trigger-topic budget-alerts \
     --entry-point handleBudgetAlert \
     --region us-central1 \
     --set-env-vars GCP_PROJECT=profit-step
   ```

5. **Дайте права на отключение billing**:
   ```bash
   # Получите email service account функции
   gcloud functions describe handleBudgetAlert --region us-central1

   # Дайте права (замените на актуальный email)
   gcloud organizations add-iam-policy-binding YOUR_ORG_ID \
     --member serviceAccount:YOUR_FUNCTION_SERVICE_ACCOUNT \
     --role roles/billing.projectManager
   ```

### Подход 2: Manual Emergency Response

Если автоматическое отключение не настроено:

1. **При получении критического alert**:
   - НЕМЕДЛЕННО откройте Firebase Console
   - Перейдите в Functions
   - Найдите проблемную функцию по логам

2. **Отключите проблемную функцию**:
   ```bash
   firebase functions:delete FUNCTION_NAME
   ```

3. **Отключите billing проекта**:
   - Google Cloud Console → Billing
   - Select project → Disable billing

4. **Проверьте логи**:
   ```bash
   firebase functions:log
   ```

---

## 📈 Мониторинг

### Ежедневная проверка (первую неделю после деплоя)
1. **Firebase Console → Usage**:
   - Firestore: reads/writes
   - Functions: invocations
   - Storage: downloads/uploads

2. **Google Cloud Console → Billing**:
   - Current month spend
   - Daily spend trend

3. **Firebase Console → Functions → Logs**:
   - Ищите паттерны повторяющихся вызовов
   - Проверяйте что `⏩ Skipping` логи присутствуют

### Нормальные показатели (для справки)
- Firestore API calls: < 100,000/day для маленькой команды
- Functions invocations: < 10,000/day
- Daily billing: < $1/day

### Признаки infinite loop
- 🚨 Firestore API calls: миллионы за день
- 🚨 Functions invocations: сотни тысяч за час
- 🚨 Daily billing: $10+ за день
- 🚨 Одна функция вызывается сотни раз в секунду

---

## ✅ Checklist: Полная защита активирована

- [ ] Budget создан в Google Cloud Console ($10/month)
- [ ] Email alerts настроены на 50%, 90%, 100%, 500%
- [ ] Pub/Sub topic `budget-alerts` создан
- [ ] Cloud Function для auto-shutoff задеплоена (опционально)
- [ ] Тестовое уведомление получено (приходит сразу после создания)
- [ ] Emulators настроены для локального тестирования
- [ ] Idempotency guards добавлены во все onUpdate triggers
- [ ] `.env.local` настроен для использования emulators

---

## 🎓 Best Practices

1. **Тестируйте в emulators ВСЕГДА**:
   - Никогда не деплойте onUpdate триггеры без тестирования
   - Проверяйте логи на паттерны infinite loops

2. **Мониторьте первые 48 часов после деплоя**:
   - Проверяйте billing каждые 6 часов
   - Смотрите функции logs на аномалии

3. **Используйте staged rollout**:
   - Деплойте сначала в dev environment
   - Потом в staging
   - И только потом в production

4. **Документируйте все изменения**:
   - Какие функции добавлены
   - Какие риски infinite loops
   - Какие guards добавлены

---

## 📞 Support

Если нужна помощь:
1. Google Cloud Support: https://cloud.google.com/support
2. Firebase Support: https://firebase.google.com/support
3. Stack Overflow: https://stackoverflow.com/questions/tagged/google-cloud-billing

---

## 🔄 Следующие шаги

После настройки Budget Alerts:

1. ✅ Протестируйте в emulators
2. ✅ Задеплойте исправленные функции
3. ✅ Мониторьте 48 часов
4. ✅ Настройте регулярные проверки billing
5. ✅ Обновите документацию команды

**Помните**: Лучше потратить 30 минут на настройку защиты, чем $174 на исправление последствий! 💰
