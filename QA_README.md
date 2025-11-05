# QA Testing Guide - Quick Start

Этот документ - **быстрый старт** для QA команды. Полный план см. в [QA_TEST_PLAN.md](./QA_TEST_PLAN.md)

---

## 🚀 Quick Setup

### 1. Установка зависимостей

```bash
npm install

# Также установить Firebase CLI глобально
npm install -g firebase-tools
```

### 2. Настройка Firebase Emulator

```bash
# Первый раз — авторизация
firebase login

# Запуск эмулятора
npm run emulator
```

Эмулятор запустится на:
- **Firestore UI:** http://localhost:4000/firestore
- **Firestore API:** localhost:8080
- **Functions:** localhost:5001
- **Auth:** localhost:9099

### 3. Генерация тестовых данных

```bash
# Создать тестовые данные (5 компаний, 10 юзеров на компанию, 30 дней истории)
npm run seed:test

# Кастомные параметры
npm run seed:test -- --companies=10 --users=20 --days=60

# Очистка всех тестовых данных
npm run seed:clean
```

**Что генерируется:**
- 5 компаний
- 50 пользователей (10 на компанию)
- 1000+ событий в `activityLog`
- 25 приглашений в разных статусах
- 50+ email events (от Brevo)
- 50 воронок активации
- 30 дней метрик (growth, engagement, cost)
- 10-50 системных ошибок

---

## 🧪 Запуск Тестов

### Unit Tests

```bash
# Все юнит-тесты с coverage
npm run test:unit

# Watch mode (для разработки)
npm test

# Только конкретный файл
npm run test:unit src/components/admin/EnhancedMembersTable.test.tsx
```

### Security Tests (Firestore Rules)

```bash
# Тесты безопасности
npm run test:security
```

**Что тестируем:**
- ✅ Company isolation (админ компании A не может читать данные компании B)
- ✅ User isolation (юзер может читать только свои данные)
- ✅ Super admin access (полный доступ)

### Integration Tests

```bash
# Интеграционные тесты (с эмулятором)
npm run emulator:test
```

### E2E Tests (Cypress)

```bash
# Headless mode (CI)
npm run test:e2e

# Interactive mode (для отладки)
npm run test:e2e:open
```

### Все тесты разом

```bash
npm run test:all
```

---

## 📊 Performance Testing

### Frontend Performance (Lighthouse)

```bash
npm run test:lighthouse
```

**Требования:**
- Performance score > 90
- First Contentful Paint < 1.5s
- Largest Contentful Paint < 2.5s
- Total Blocking Time < 200ms

### Backend Load Testing (Artillery)

```bash
npm run test:load
```

Тест симулирует:
- 60s warm-up (5 RPS)
- 300s sustained load (50 RPS)
- Проверяет p95 latency < 500ms
- Проверяет error rate < 1%

Результаты сохраняются в `reports/load-test.json`

---

## 🔍 Test Cases Reference

Все тест-кейсы с детальными шагами и expected results см. в [QA_TEST_PLAN.md](./QA_TEST_PLAN.md), секция 4-6.

### Backend Testing

| Test Case | Что тестирует | Файл |
|-----------|---------------|------|
| **#1** | `aggregateGrowthMetrics` scheduled function | `functions/test/aggregateGrowthMetrics.test.ts` |
| **#2** | `syncCostData` с моками BigQuery | `functions/test/syncCostData.test.ts` |
| **#3** | Brevo webhook handler (bounced emails) | `functions/test/brevoWebhook.test.ts` |
| **#4** | `logUserActivity` Firestore trigger | `functions/test/logUserActivity.test.ts` |

### Security Testing

| Test Case | Что тестирует | Файл |
|-----------|---------------|------|
| **#5** | Company isolation (cross-company access denied) | `firestore.rules.test.ts` |
| **#6** | User isolation (can't read other users' data) | `firestore.rules.test.ts` |
| **#7** | Super admin access (full access) | `firestore.rules.test.ts` |

### Frontend Testing

| Test Case | Что тестирует | Файл |
|-----------|---------------|------|
| **#8** | ActivationFunnel component calculations | `src/pages/superadmin/components/ActivationFunnel.test.tsx` |
| **#9** | DailyCostChart rendering and projections | `src/pages/superadmin/components/DailyCostChart.test.tsx` |
| **#10** | EnhancedMembersTable company isolation | `src/components/admin/EnhancedMembersTable.test.tsx` |
| **#11** | Resend invitation E2E flow | `cypress/e2e/company-admin/resend-invitation.cy.ts` |
| **#12** | Activity feed filters | `cypress/e2e/company-admin/activity-feed-filters.cy.ts` |

---

## 📝 Manual Testing Checklists

### Super Admin Dashboard

```
[ ] Логин как super admin
[ ] Открыть /superadmin/dashboard
[ ] Проверить Growth Metrics Panel:
    [ ] Карточки "New Users", "New Companies" показывают данные
    [ ] График роста отображается
[ ] Проверить Engagement Metrics Panel:
    [ ] DAU, WAU, MAU карточки
    [ ] Stickiness % корректный
    [ ] DAU trend chart отображается
[ ] Проверить Cost Control Panel:
    [ ] "This Month" cost
    [ ] "Projected" monthly cost
    [ ] Daily cost breakdown chart
[ ] Проверить System Health Panel:
    [ ] Error rate card
    [ ] Email delivery rate
    [ ] API latency
    [ ] Recent errors table
```

### Company Admin Dashboard

```
[ ] Логин как company admin
[ ] Открыть /admin/dashboard
[ ] Проверить Team Overview KPIs:
    [ ] Все 4 карточки показывают данные
[ ] Проверить Team Members Table:
    [ ] Видны только пользователи СВОЕЙ компании
    [ ] Кнопка "Invite User" работает
[ ] Проверить Activity Feed:
    [ ] События отображаются
    [ ] Фильтр по типу действия работает
    [ ] Фильтр по дате работает
    [ ] Real-time обновления (опционально)
```

---

## 🐛 Debugging Tips

### Эмулятор не стартует

```bash
# Убедитесь что порты свободны
lsof -ti:4000,5001,8080,9099 | xargs kill -9

# Очистить cache
firebase emulators:start --clear-cache
```

### Тесты падают с "permission-denied"

```bash
# Проверить, что security rules правильно загружены
cat firestore.rules

# Убедиться что эмулятор запущен
curl http://localhost:8080
```

### Seed script не работает

```bash
# Убедитесь что используете Node 16+
node --version

# Проверить что эмулятор запущен
firebase emulators:start

# В другом терминале
npm run seed:test
```

### Cypress тесты падают

```bash
# Сначала убедитесь что приложение запущено
npm start

# В другом терминале
npm run test:e2e:open
```

---

## 📅 Weekly QA Routine

### Понедельник
- [ ] Запустить full test suite: `npm run test:all`
- [ ] Проверить coverage report (должен быть > 80%)
- [ ] Review новых PRs с security tests

### Среда
- [ ] Manual testing нового функционала
- [ ] Update test data если schema изменилась
- [ ] Run performance tests: `npm run test:lighthouse`

### Пятница
- [ ] Regression testing на staging
- [ ] Load test: `npm run test:load`
- [ ] Update QA Test Plan если нужно
- [ ] Commit test improvements в Git

---

## 🚨 Critical Bugs Protocol

Если нашли критический баг:

1. **Воспроизвести** на эмуляторе
2. **Создать failing test** который воспроизводит баг
3. **Открыть GitHub Issue** с тегом `critical-bug`
4. **Notify** в Slack #dev-team
5. **Document** в QA Log (см. `qa-logs/`)

---

## 📚 Дополнительные Ресурсы

- [QA_TEST_PLAN.md](./QA_TEST_PLAN.md) — Полный план тестирования
- [Firebase Emulator Docs](https://firebase.google.com/docs/emulator-suite)
- [Cypress Best Practices](https://docs.cypress.io/guides/references/best-practices)
- [Jest Documentation](https://jestjs.io/docs/getting-started)

---

**Вопросы?** Пишите в Slack #qa-team или открывайте issue в GitHub.
