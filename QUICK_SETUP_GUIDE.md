# 🚀 Quick Setup Guide - Budget Protection

## Автоматическая настройка защиты от $174+ счетов

Время: **10-15 минут**

---

## Шаг 1: Установка gcloud CLI (первый раз)

gcloud SDK уже скачан в `/tmp/google-cloud-sdk`. Установите его:

```bash
# Запустите установщик
/tmp/google-cloud-sdk/install.sh

# Следуйте инструкциям:
# - Нажмите Enter для установки в домашнюю папку
# - Введите 'Y' для обновления PATH
# - Введите 'Y' для bash/zsh completion

# Обновите shell
source ~/.zshrc
# ИЛИ source ~/.bash_profile (для bash)

# Проверьте установку
gcloud --version
```

Должно показать:
```
Google Cloud SDK 456.0.0
```

---

## Шаг 2: Авторизация в Google Cloud

```bash
# Авторизуйтесь через браузер
gcloud auth login

# Откроется браузер
# Войдите под аккаунтом с правами на profit-step проект
# Нажмите "Allow"

# Установите проект по умолчанию
gcloud config set project profit-step
```

---

## Шаг 3: Автоматическая настройка

Запустите автоматический скрипт:

```bash
cd /Users/denysharbuzov/Projects/profit-step
./SETUP_BUDGET_PROTECTION.sh
```

Скрипт автоматически:
1. ✅ Проверит gcloud установку
2. ✅ Включит нужные API
3. ✅ Создаст Pub/Sub topic
4. ✅ Задеплоит Auto-Shutoff функцию
5. ⚠️ Покажет команду для настройки прав

---

## Шаг 4: Настройка прав (ВАЖНО!)

После деплоя функции скопируйте и выполните команду из вывода скрипта:

```bash
gcloud projects add-iam-policy-binding profit-step \
  --member=serviceAccount:XXXXX@appspot.gserviceaccount.com \
  --role=roles/billing.projectManager
```

**Или через Console**:
1. Откройте: https://console.cloud.google.com/iam-admin/iam?project=profit-step
2. Найдите service account функции (email из вывода скрипта)
3. Нажмите Edit (карандаш)
4. "+ ADD ANOTHER ROLE"
5. Выберите: **Billing Project Manager**
6. Save

---

## Шаг 5: Создание бюджета

Откройте: https://console.cloud.google.com/billing/budgets

### 5.1 Scope
- Budget name: `profit-step-monthly-budget`
- Time range: `Monthly (recurring)`
- Projects: ☑ `profit-step`
- Services: All services
- **NEXT**

### 5.2 Amount
- Budget type: `Specified amount`
- Target amount: `$10`
- Include credits: ☐ (снять галочку)
- **NEXT**

### 5.3 Alert thresholds
Добавьте 4 порога (+ ADD THRESHOLD RULE для каждого):

| Percent | Trigger | Email | $ при $10 бюджете |
|---------|---------|-------|-------------------|
| 50%     | Actual  | ✅    | $5                |
| 90%     | Actual  | ✅    | $9                |
| 100%    | Actual  | ✅    | $10               |
| 500%    | Actual  | ✅    | $50 (auto-shutoff)|

### 5.4 Notifications
- Email recipients: Ваши emails
- **Pub/Sub topic**: Выберите `budget-alerts` ⚠️ ВАЖНО!
- **FINISH**

---

## Шаг 6: Проверка

### Проверьте функцию:
```bash
gcloud functions describe handleBudgetAlert --region=us-central1 --gen2
```

Должно показать:
- State: ACTIVE
- Trigger: projects/profit-step/topics/budget-alerts

### Проверьте логи:
```bash
gcloud functions logs read handleBudgetAlert --region=us-central1 --gen2 --limit=10
```

### (Опционально) Тестовое сообщение:
```bash
# Отправить тест (50% бюджета - не отключит billing)
gcloud pubsub topics publish budget-alerts \
  --message='{"costAmount":5,"budgetAmount":10,"budgetDisplayName":"test-budget"}' \
  --project=profit-step

# Через 10 секунд проверьте логи
gcloud functions logs read handleBudgetAlert --region=us-central1 --gen2 --limit=10
```

Должны увидеть:
```
✅ Budget OK: 50.00% < 500%
```

---

## ✅ Готово!

### Что защищает:

**Level 1 - Code Protection** ✅
- Idempotency guards в incrementLoginCount
- Защита от infinite loops в коде

**Level 2 - Development Protection** ✅
- Firebase Emulators настроены
- Локальное тестирование без затрат

**Level 3 - Infrastructure Protection** ✅
- Budget Alerts: 50%, 90%, 100%, 500%
- Auto-Shutoff при $50 через Cloud Function
- Email notifications на всех порогах

---

## 📊 Мониторинг

### Первые 48 часов (проверяйте каждые 6 часов):

**1. Firebase Console → Functions → Logs**
```
https://console.firebase.google.com/project/profit-step/functions/logs
```
Ищите:
- ✅ `⏩ Skipping loginCount update` - guards работают
- 🚨 Повторяющиеся вызовы - тревога!

**2. Google Cloud Console → Billing**
```
https://console.cloud.google.com/billing
```
Проверяйте:
- Current month spend (норма: < $10)
- Daily spend (норма: < $1/день)

**3. Cloud Function Logs**
```bash
gcloud functions logs read handleBudgetAlert --region=us-central1 --gen2 --limit=20
```

---

## 🚨 Emergency Response

Если получили alert или заметили проблему:

### При 50% ($5):
- ✅ Проверьте логи Functions
- ✅ Убедитесь что нет infinite loops
- ✅ Продолжайте мониторинг

### При 90% ($9):
- ⚠️ Срочно проверьте что происходит
- ⚠️ Откройте Firebase Console → Usage
- ⚠️ Будьте готовы отключить функции

### При 100% ($10):
- 🚨 Найдите причину немедленно
- 🚨 Рассмотрите отключение проблемных функций
- 🚨 Свяжитесь с Firebase Support

### При 500% ($50):
- 🔥 Auto-Shutoff автоматически отключит billing
- 🔥 Проект перестанет работать (защита активирована)
- 🔥 Исправьте проблему перед включением billing

---

## 📞 Support

- Firebase Console: https://console.firebase.google.com/project/profit-step
- Billing: https://console.cloud.google.com/billing
- Firebase Support: https://firebase.google.com/support
- Documentation: См. DEFENSIVE_PROGRAMMING_GUIDE.md

---

## 🎓 Best Practices

1. ✅ Всегда тестируйте в emulators перед production
2. ✅ Мониторьте первые 48 часов после каждого деплоя
3. ✅ Проверяйте billing еженедельно
4. ✅ Используйте idempotency guards во всех onUpdate triggers
5. ✅ Документируйте все изменения

---

**Готово! Ваш проект защищен от катастрофических счетов! 🛡️**
