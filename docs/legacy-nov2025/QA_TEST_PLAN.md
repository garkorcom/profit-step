# QA Test Plan: Двухуровневая Система Дашбордов
## Super Admin & Company Admin Analytics Platform

**Версия:** 1.0
**Дата:** 2025-11-04
**QA Lead:** SDET Team
**Статус:** Ready for Implementation
**Длительность:** 10 недель (параллельно с разработкой)

---

## Содержание

- [1. Тестовая Стратегия](#1-тестовая-стратегия)
- [2. Инфраструктура и Инструменты](#2-инфраструктура-и-инструменты)
- [3. Data Seeding Strategy](#3-data-seeding-strategy)
- [4. Backend Testing](#4-backend-testing)
- [5. Security Testing](#5-security-testing)
- [6. Frontend Testing](#6-frontend-testing)
- [7. Performance Testing](#7-performance-testing)
- [8. E2E Testing](#8-e2e-testing)
- [9. Пофазный Plan по Неделям](#9-пофазный-plan-по-неделям)
- [10. CI/CD Integration](#10-cicd-integration)
- [11. Test Coverage Goals](#11-test-coverage-goals)

---

## 1. Тестовая Стратегия

### 1.1 Pyramid of Testing

```
        ┌─────────────┐
        │   E2E (10%) │  ← Cypress (critical user flows)
        ├─────────────┤
        │ Integration │  ← Firebase Emulator (30%)
        │    (30%)    │
        ├─────────────┤
        │  Unit Tests │  ← Jest (60%)
        │    (60%)    │
        └─────────────┘
```

### 1.2 Test Types

| Test Type | Coverage | Tools | Execution Frequency |
|-----------|----------|-------|---------------------|
| **Unit Tests** | 60% | Jest, React Testing Library | Every commit (local + CI) |
| **Integration Tests** | 30% | Firebase Emulator, Mocha | Every PR |
| **Security Tests** | 100% | Firebase Rules Unit Testing | Every PR + Nightly |
| **E2E Tests** | Critical flows | Cypress | Pre-release + Nightly |
| **Performance Tests** | Dashboards | Lighthouse, Artillery | Weekly + Pre-release |
| **Accessibility** | WCAG 2.1 AA | axe-core | Every PR |

### 1.3 Окружения

```yaml
environments:
  local:
    firestore: "Emulator"
    functions: "Emulator"
    auth: "Emulator"
    purpose: "Dev & Unit tests"

  dev:
    project: "profit-step-dev"
    url: "https://profit-step-dev.web.app"
    purpose: "Integration tests, Feature testing"
    data: "Test data only"

  staging:
    project: "profit-step-staging"
    url: "https://profit-step-staging.web.app"
    purpose: "E2E tests, UAT, Performance tests"
    data: "Production-like data"

  production:
    project: "profit-step"
    url: "https://profit-step.web.app"
    purpose: "Smoke tests only (post-deploy)"
    data: "Real data"
```

---

## 2. Инфраструктура и Инструменты

### 2.1 Установка Зависимостей

```json
{
  "devDependencies": {
    // Testing frameworks
    "jest": "^29.7.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.5.0",
    "@testing-library/jest-dom": "^6.0.0",

    // Firebase testing
    "@firebase/rules-unit-testing": "^3.0.0",
    "firebase-functions-test": "^3.1.0",

    // E2E
    "cypress": "^13.6.0",
    "@cypress/code-coverage": "^3.12.0",

    // Mocking & Data generation
    "@faker-js/faker": "^8.3.0",
    "msw": "^2.0.0",

    // Performance
    "lighthouse": "^11.0.0",
    "artillery": "^2.0.0",

    // Accessibility
    "axe-core": "^4.8.0",
    "cypress-axe": "^1.5.0"
  }
}
```

### 2.2 Конфигурация Jest

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src', '<rootDir>/functions/src'],

  // Coverage
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'functions/src/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThresholds: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80,
    },
  },

  // Setup
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Module paths
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss)$': 'identity-obj-proxy',
  },
};
```

### 2.3 Firebase Emulator Configuration

```json
// firebase.json
{
  "emulators": {
    "auth": { "port": 9099 },
    "functions": { "port": 5001 },
    "firestore": { "port": 8080 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

---

## 3. Data Seeding Strategy

### 3.1 Использование Скрипта seedTestData.ts

**Цель:** Создать реалистичные данные для всех 10+ коллекций Firestore.

#### 3.1.1 Запуск

```bash
# Полная генерация данных (5 компаний, 10 юзеров на компанию)
npm run seed:test

# Кастомные параметры
npm run seed:test -- --companies=10 --users=20 --days=60

# Очистка тестовых данных
npm run seed:test -- --clean
```

#### 3.1.2 Что Генерируется

| Коллекция | Количество | Описание |
|-----------|------------|----------|
| `companies` | 5 (default) | Фейковые компании с реалистичными названиями |
| `users` | 50 (5×10) | Юзеры с разными ролями (admin, manager, user) |
| `activityLog` | 1000+ | События активности за последние 30 дней |
| `invitations` | 25 (5×5) | Приглашения в разных статусах |
| `emailEvents` | 50+ | События от Brevo (sent, delivered, opened, bounced) |
| `userActivation` | 50 | Воронка активации (4 этапа) |
| `growthMetrics` | 30 | Дневные метрики роста за 30 дней |
| `engagementMetrics` | 30 | DAU/WAU/MAU за 30 дней |
| `costReports` | 30 | Ежедневные cost breakdown |
| `systemErrors` | 10-50 (random) | Фейковые ошибки из Cloud Functions |

#### 3.1.3 Test Data Patterns

Данные содержат **реалистичные паттерны** для проверки edge cases:

- **Неполная активация:** 20% пользователей застряли на "Profile Completed"
- **Bounced emails:** 10% приглашений имеют статус "bounced"
- **Spike в активности:** Некоторые дни имеют аномально высокую активность
- **Ошибки:** Разные severity levels (low, medium, high, critical)

---

## 4. Backend Testing

### 4.1 Тестирование Cloud Functions

#### 4.1.1 Setup для Function Testing

```typescript
// functions/test/setup.ts
import * as admin from 'firebase-admin';
import * as testEnv from 'firebase-functions-test';

// Initialize test environment
const test = testEnv({
  projectId: 'profit-step-test',
});

// Initialize admin with emulator
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
admin.initializeApp({ projectId: 'profit-step-test' });

export { test, admin };
```

---

### 4.2 Test Cases: Scheduled Functions

#### TEST CASE #1: `aggregateGrowthMetrics` (Ручной запуск)

**Цель:** Проверить, что функция правильно подсчитывает новых пользователей и компании.

**Preconditions:**
1. Запустить Firebase Emulator
2. Засеять тестовые данные: `npm run seed:test`
3. Дата запуска: `2025-01-15`

**Test Steps:**

```typescript
// functions/test/aggregateGrowthMetrics.test.ts
import { test, admin } from './setup';
import { aggregateGrowthMetrics } from '../src/metricsAggregation';

describe('aggregateGrowthMetrics', () => {
  let wrapped: any;
  const db = admin.firestore();

  beforeAll(async () => {
    // Seed specific test data
    await db.collection('users').doc('user1').set({
      createdAt: admin.firestore.Timestamp.fromDate(new Date('2025-01-15')),
      companyId: 'company1',
    });
    await db.collection('companies').doc('company1').set({
      createdAt: admin.firestore.Timestamp.fromDate(new Date('2025-01-15')),
      name: 'Test Company',
    });

    // Wrap the function
    wrapped = test.wrap(aggregateGrowthMetrics);
  });

  it('should aggregate growth metrics correctly', async () => {
    // Execute function (simulate scheduler)
    await wrapped({ timestamp: new Date('2025-01-16').toISOString() });

    // Verify results
    const metricsDoc = await db.collection('growthMetrics').doc('2025-01-15').get();
    expect(metricsDoc.exists).toBe(true);

    const data = metricsDoc.data();
    expect(data?.newUsers).toBe(1);
    expect(data?.newCompanies).toBe(1);
  });

  it('should handle date boundaries correctly', async () => {
    // Test midnight edge case
    await db.collection('users').doc('user_midnight').set({
      createdAt: admin.firestore.Timestamp.fromDate(new Date('2025-01-15T23:59:59Z')),
      companyId: 'company1',
    });

    await wrapped({ timestamp: new Date('2025-01-16').toISOString() });

    const metricsDoc = await db.collection('growthMetrics').doc('2025-01-15').get();
    expect(metricsDoc.data()?.newUsers).toBe(2); // Should include midnight user
  });
});
```

**Expected Results:**
- ✅ В коллекции `growthMetrics` создается документ с ID = `2025-01-15`
- ✅ Поле `newUsers` = количество пользователей, созданных в этот день
- ✅ Поле `newCompanies` = количество компаний, созданных в этот день
- ✅ Поле `metadata.calculatedAt` содержит timestamp выполнения функции

**Pass Criteria:** Все assertions проходят, функция отрабатывает < 2 секунд.

---

#### TEST CASE #2: `syncCostData` (Моки BigQuery)

**Цель:** Проверить синхронизацию cost data без реального доступа к Billing API.

**Стратегия Моков:**

```typescript
// functions/test/syncCostData.test.ts
import { test, admin } from './setup';
import * as sinon from 'sinon';
import { BigQuery } from '@google-cloud/bigquery';
import { syncCostData } from '../src/costSync';

describe('syncCostData', () => {
  let bigQueryStub: sinon.SinonStub;
  const db = admin.firestore();

  beforeEach(() => {
    // Mock BigQuery response
    bigQueryStub = sinon.stub(BigQuery.prototype, 'query').resolves([
      [
        {
          date: '2025-01-15',
          service: 'firestore',
          cost: 12.34,
        },
        {
          date: '2025-01-15',
          service: 'functions',
          cost: 5.67,
        },
      ],
    ]);
  });

  afterEach(() => {
    bigQueryStub.restore();
  });

  it('should sync cost data from BigQuery', async () => {
    const wrapped = test.wrap(syncCostData);
    await wrapped();

    // Verify Firestore write
    const costDoc = await db.collection('costReports').doc('2025-01-15').get();
    expect(costDoc.exists).toBe(true);

    const data = costDoc.data();
    expect(data?.breakdown.firestore).toBe(12.34);
    expect(data?.breakdown.cloudFunctions).toBe(5.67);
    expect(data?.totalCost).toBe(18.01); // 12.34 + 5.67
  });

  it('should handle BigQuery errors gracefully', async () => {
    bigQueryStub.rejects(new Error('BigQuery timeout'));

    const wrapped = test.wrap(syncCostData);
    await expect(wrapped()).rejects.toThrow();

    // Verify error logged to systemErrors
    const errors = await db.collection('systemErrors')
      .where('functionName', '==', 'syncCostData')
      .get();
    expect(errors.empty).toBe(false);
  });
});
```

**Expected Results:**
- ✅ Данные из мока BigQuery сохраняются в `costReports/{date}`
- ✅ `totalCost` правильно подсчитывается как сумма всех сервисов
- ✅ Ошибки BigQuery логируются в `systemErrors`

---

### 4.3 Test Cases: Webhook Handlers

#### TEST CASE #3: Симуляция Brevo Webhook (Bounced Email)

**Цель:** Проверить, что вебхук правильно обрабатывает события от Brevo.

**Test Steps:**

```typescript
// functions/test/brevoWebhook.test.ts
import { test, admin } from './setup';
import { brevoWebhookHandler } from '../src/brevoWebhook';
import * as express from 'express';

describe('Brevo Webhook Handler', () => {
  const db = admin.firestore();
  let wrapped: any;

  beforeEach(async () => {
    // Setup test invitation
    await db.collection('invitations').doc('inv123').set({
      email: 'test@example.com',
      companyId: 'company1',
      status: 'sent',
      brevoData: {
        messageId: 'msg-abc-123',
      },
    });

    wrapped = test.wrap(brevoWebhookHandler);
  });

  it('should handle bounced email event', async () => {
    // Simulate Brevo webhook payload
    const req = {
      body: {
        event: 'hard_bounce',
        'message-id': 'msg-abc-123',
        email: 'test@example.com',
        date: '2025-01-15 10:30:00',
        reason: 'invalid_domain',
      },
    } as express.Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as express.Response;

    // Execute webhook
    await wrapped(req, res);

    // Verify response
    expect(res.status).toHaveBeenCalledWith(200);

    // Verify Firestore updates
    const invDoc = await db.collection('invitations').doc('inv123').get();
    expect(invDoc.data()?.status).toBe('bounced');

    // Verify emailEvent created
    const emailEvents = await db.collection('emailEvents')
      .where('messageId', '==', 'msg-abc-123')
      .get();
    expect(emailEvents.size).toBe(1);
    expect(emailEvents.docs[0].data().event).toBe('hard_bounce');
  });

  it('should handle delivered email event', async () => {
    const req = {
      body: {
        event: 'delivered',
        'message-id': 'msg-abc-123',
        email: 'test@example.com',
      },
    } as express.Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as express.Response;

    await wrapped(req, res);

    const invDoc = await db.collection('invitations').doc('inv123').get();
    expect(invDoc.data()?.status).toBe('delivered');
  });

  it('should reject unauthorized webhooks', async () => {
    const req = {
      body: { event: 'spam' },
      headers: {}, // No auth header
    } as express.Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as express.Response;

    await wrapped(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

**Ручное Тестирование через cURL:**

```bash
# Отправить фейковый webhook на локальный эмулятор
curl -X POST http://localhost:5001/profit-step-dev/us-central1/brevoWebhookHandler \
  -H "Content-Type: application/json" \
  -d '{
    "event": "hard_bounce",
    "message-id": "msg-abc-123",
    "email": "test@example.com",
    "date": "2025-01-15 10:30:00",
    "reason": "invalid_domain"
  }'

# Проверить результат в Firestore UI
open http://localhost:4000/firestore/data/emailEvents
```

**Expected Results:**
- ✅ HTTP 200 response
- ✅ Invitation status обновляется на `bounced`
- ✅ Новый документ в `emailEvents` с типом `hard_bounce`
- ✅ Неавторизованные запросы отклоняются с 401

---

### 4.4 Test Cases: Firestore Triggers

#### TEST CASE #4: `logUserActivity` (onUpdate Trigger)

**Цель:** Проверить, что изменения в коллекции `users` автоматически логируются.

**Test Steps:**

```typescript
// functions/test/logUserActivity.test.ts
import { test, admin } from './setup';
import { logUserActivity } from '../src/activityLogger';
import * as testHelper from 'firebase-functions-test';

describe('User Activity Logger Trigger', () => {
  const db = admin.firestore();
  let wrapped: any;

  beforeEach(() => {
    wrapped = test.wrap(logUserActivity);
  });

  it('should log role change', async () => {
    const beforeSnap = testHelper().firestore.makeDocumentSnapshot(
      {
        id: 'user123',
        email: 'user@test.com',
        role: 'manager',
        companyId: 'company1',
      },
      'users/user123'
    );

    const afterSnap = testHelper().firestore.makeDocumentSnapshot(
      {
        id: 'user123',
        email: 'user@test.com',
        role: 'admin', // Changed!
        companyId: 'company1',
      },
      'users/user123'
    );

    // Execute trigger
    await wrapped({
      before: beforeSnap,
      after: afterSnap,
    });

    // Verify activity log
    const logs = await db.collection('activityLog')
      .where('userId', '==', 'user123')
      .where('action', '==', 'role_changed')
      .get();

    expect(logs.size).toBe(1);
    const logData = logs.docs[0].data();
    expect(logData.metadata.oldRole).toBe('manager');
    expect(logData.metadata.newRole).toBe('admin');
  });

  it('should log profile completion', async () => {
    const beforeSnap = testHelper().firestore.makeDocumentSnapshot(
      { profileCompleted: false },
      'users/user456'
    );

    const afterSnap = testHelper().firestore.makeDocumentSnapshot(
      { profileCompleted: true },
      'users/user456'
    );

    await wrapped({ before: beforeSnap, after: afterSnap });

    const logs = await db.collection('activityLog')
      .where('action', '==', 'profile_completed')
      .get();

    expect(logs.size).toBe(1);
  });

  it('should NOT log if no significant changes', async () => {
    const beforeSnap = testHelper().firestore.makeDocumentSnapshot(
      { lastLoginAt: new Date('2025-01-15') },
      'users/user789'
    );

    const afterSnap = testHelper().firestore.makeDocumentSnapshot(
      { lastLoginAt: new Date('2025-01-16') }, // Only login time changed
      'users/user789'
    );

    await wrapped({ before: beforeSnap, after: afterSnap });

    // Should NOT create activity log for trivial updates
    const logs = await db.collection('activityLog')
      .where('userId', '==', 'user789')
      .get();

    expect(logs.size).toBe(0);
  });
});
```

**Manual E2E Test:**

```bash
# 1. Запустить эмулятор
firebase emulators:start

# 2. Изменить роль в Firestore UI
# Открыть http://localhost:4000/firestore
# Найти users/{userId}
# Изменить поле 'role' с 'manager' на 'admin'

# 3. Проверить activityLog
# Должна появиться новая запись с action='role_changed'
```

**Expected Results:**
- ✅ При изменении роли создается `activityLog` с `action: 'role_changed'`
- ✅ Metadata содержит `oldRole` и `newRole`
- ✅ Тривиальные изменения (например, только `lastLoginAt`) не логируются

---

## 5. Security Testing

### 5.1 Стратегия: Firebase Rules Unit Testing

**Инструмент:** `@firebase/rules-unit-testing`

**Подход:** Создать тесты, которые аутентифицируются под разными пользователями и проверяют:
- ✅ **Что разрешено:** Позитивные сценарии
- ❌ **Что запрещено:** Негативные сценарии (permission-denied)

---

### 5.2 Setup для Security Testing

```typescript
// firestore.rules.test.ts
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'profit-step-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});
```

---

### 5.3 Test Cases: Company Isolation

#### TEST CASE #5: Company Admin Isolation (Negative Test)

**Цель:** Admin компании A НЕ МОЖЕТ читать данные компании B.

```typescript
describe('Company Admin Isolation', () => {
  it('should DENY cross-company activityLog access', async () => {
    // Seed data for Company B
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('activityLog')
        .doc('log1')
        .set({
          companyId: 'company_B',
          userId: 'user_B_1',
          action: 'login',
        });
    });

    // Try to read as Company A admin
    const companyAContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const queryAttempt = companyAContext
      .firestore()
      .collection('activityLog')
      .where('companyId', '==', 'company_B')
      .get();

    await assertFails(queryAttempt); // ❌ Should be DENIED
  });

  it('should ALLOW same-company activityLog access', async () => {
    // Seed data for Company A
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('activityLog')
        .doc('log2')
        .set({
          companyId: 'company_A',
          userId: 'user_A_1',
          action: 'login',
        });
    });

    // Try to read as Company A admin
    const companyAContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const queryAttempt = companyAContext
      .firestore()
      .collection('activityLog')
      .where('companyId', '==', 'company_A')
      .get();

    await assertSucceeds(queryAttempt); // ✅ Should be ALLOWED
  });
});
```

**Expected Results:**
- ❌ Cross-company access returns `permission-denied`
- ✅ Same-company access succeeds
- ✅ Без authentication вообще никакой доступ

---

#### TEST CASE #6: User Data Isolation

**Цель:** Обычный user может читать только свои `userActivation` данные.

```typescript
describe('User Data Isolation', () => {
  it('should DENY reading other user activation data', async () => {
    // Seed activation data for another user
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('userActivation')
        .doc('other_user_id')
        .set({
          userId: 'other_user_id',
          companyId: 'company_A',
          signupCompleted: true,
        });
    });

    // Try to read as different user
    const userContext = testEnv.authenticatedContext('user123', {
      companyId: 'company_A',
      role: 'user',
    });

    const readAttempt = userContext
      .firestore()
      .collection('userActivation')
      .doc('other_user_id')
      .get();

    await assertFails(readAttempt); // ❌ Should be DENIED
  });

  it('should ALLOW reading own activation data', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('userActivation')
        .doc('user123')
        .set({
          userId: 'user123',
          companyId: 'company_A',
          signupCompleted: true,
        });
    });

    const userContext = testEnv.authenticatedContext('user123', {
      companyId: 'company_A',
      role: 'user',
    });

    const readAttempt = userContext
      .firestore()
      .collection('userActivation')
      .doc('user123')
      .get();

    await assertSucceeds(readAttempt); // ✅ Should be ALLOWED
  });
});
```

---

#### TEST CASE #7: Super Admin Access

**Цель:** Super Admin имеет полный доступ ко всем коллекциям.

```typescript
describe('Super Admin Access', () => {
  it('should ALLOW super admin to read systemErrors', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('systemErrors')
        .doc('error1')
        .set({
          timestamp: new Date(),
          errorType: 'timeout',
        });
    });

    const superAdminContext = testEnv.authenticatedContext('super_admin_1', {
      role: 'super_admin',
    });

    const readAttempt = superAdminContext
      .firestore()
      .collection('systemErrors')
      .doc('error1')
      .get();

    await assertSucceeds(readAttempt); // ✅ Should be ALLOWED
  });

  it('should ALLOW super admin to read all costReports', async () => {
    const superAdminContext = testEnv.authenticatedContext('super_admin_1', {
      role: 'super_admin',
    });

    const queryAttempt = superAdminContext
      .firestore()
      .collection('costReports')
      .get();

    await assertSucceeds(queryAttempt); // ✅ Should be ALLOWED
  });

  it('should DENY regular admin from reading systemErrors', async () => {
    const adminContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const readAttempt = adminContext
      .firestore()
      .collection('systemErrors')
      .get();

    await assertFails(readAttempt); // ❌ Should be DENIED
  });
});
```

**Expected Results:**
- ✅ Super admin может читать `systemErrors`, `costReports`, `growthMetrics`
- ❌ Company admin НЕ МОЖЕТ читать super-admin коллекции
- ✅ Security rules корректно проверяют custom claim `role: 'super_admin'`

---

## 6. Frontend Testing

### 6.1 Component Unit Tests

#### TEST CASE #8: ActivationFunnel Component

**Цель:** Проверить, что компонент правильно рассчитывает % конверсии на каждом шаге.

```typescript
// src/pages/superadmin/components/ActivationFunnel.test.tsx
import { render, screen } from '@testing-library/react';
import ActivationFunnel from './ActivationFunnel';

describe('ActivationFunnel', () => {
  it('should calculate conversion percentages correctly', () => {
    const mockData = {
      signupCompleted: 100,
      emailVerified: 80,
      profileCompleted: 50,
      firstAction: 30,
    };

    render(<ActivationFunnel data={mockData} />);

    // Check percentages
    expect(screen.getByText('100%')).toBeInTheDocument(); // Step 1
    expect(screen.getByText('80%')).toBeInTheDocument();  // Step 2
    expect(screen.getByText('50%')).toBeInTheDocument();  // Step 3
    expect(screen.getByText('30%')).toBeInTheDocument();  // Step 4

    // Check conversion rates
    expect(screen.getByText('80.0%')).toBeInTheDocument(); // 80/100
    expect(screen.getByText('62.5%')).toBeInTheDocument(); // 50/80
    expect(screen.getByText('60.0%')).toBeInTheDocument(); // 30/50
  });

  it('should handle edge case: 0 users', () => {
    const mockData = {
      signupCompleted: 0,
      emailVerified: 0,
      profileCompleted: 0,
      firstAction: 0,
    };

    render(<ActivationFunnel data={mockData} />);

    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });
});
```

---

#### TEST CASE #9: DailyCostChart Component

**Цель:** Проверить, что график отображает данные и правильно прогнозирует.

```typescript
// src/pages/superadmin/components/DailyCostChart.test.tsx
import { render, screen } from '@testing-library/react';
import DailyCostChart from './DailyCostChart';

describe('DailyCostChart', () => {
  it('should render chart with cost data', () => {
    const mockCostReports = [
      { date: '2025-01-01', totalCost: 10.5 },
      { date: '2025-01-02', totalCost: 12.3 },
      { date: '2025-01-03', totalCost: 11.8 },
    ];

    render(<DailyCostChart data={mockCostReports} />);

    // Check that chart is rendered
    expect(screen.getByRole('img', { name: /cost chart/i })).toBeInTheDocument();
  });

  it('should calculate projected monthly cost', () => {
    const mockCostReports = [
      { date: '2025-01-01', totalCost: 10 },
      { date: '2025-01-02', totalCost: 10 },
      { date: '2025-01-03', totalCost: 10 },
    ];

    render(<DailyCostChart data={mockCostReports} />);

    // Average = 10, Days in month = 31, Projected = 310
    expect(screen.getByText(/\$310/i)).toBeInTheDocument();
  });
});
```

---

### 6.2 Integration Tests with Firestore

#### TEST CASE #10: EnhancedMembersTable (Company Isolation)

**Цель:** Проверить, что таблица показывает только пользователей из своей компании.

```typescript
// src/components/admin/EnhancedMembersTable.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { AuthContext } from '../../auth/AuthContext';
import EnhancedMembersTable from './EnhancedMembersTable';

// Mock Firestore
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(),
}));

describe('EnhancedMembersTable - Company Isolation', () => {
  it('should display only company A users when logged in as company A admin', async () => {
    const mockAuthContext = {
      userProfile: {
        id: 'admin_A',
        companyId: 'company_A',
        role: 'admin',
      },
    };

    // Mock Firestore response (только юзеры Company A)
    const { getDocs } = require('firebase/firestore');
    getDocs.mockResolvedValue({
      docs: [
        { id: 'user_A_1', data: () => ({ email: 'user1@companyA.com', companyId: 'company_A' }) },
        { id: 'user_A_2', data: () => ({ email: 'user2@companyA.com', companyId: 'company_A' }) },
      ],
    });

    render(
      <AuthContext.Provider value={mockAuthContext}>
        <EnhancedMembersTable />
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('user1@companyA.com')).toBeInTheDocument();
      expect(screen.getByText('user2@companyA.com')).toBeInTheDocument();
      expect(screen.queryByText('userB@companyB.com')).not.toBeInTheDocument();
    });
  });
});
```

---

### 6.3 E2E User Flow Tests

#### TEST CASE #11: Resend Invitation Flow (Cypress E2E)

**Цель:** Полная проверка flow: Нажатие кнопки → API call → UI update → Email отправка.

```typescript
// cypress/e2e/company-admin/resend-invitation.cy.ts
describe('Resend Invitation Flow', () => {
  beforeEach(() => {
    // Login as company admin
    cy.login('admin@company-a.test', 'TestPassword123');
    cy.visit('/admin/team');
  });

  it('should resend invitation and update UI', () => {
    // 1. Find pending invitation
    cy.contains('pending@user.com')
      .parents('tr')
      .within(() => {
        // 2. Check initial status
        cy.contains('Pending').should('exist');

        // 3. Click "Resend" button
        cy.contains('button', 'Resend').click();
      });

    // 4. Verify UI feedback
    cy.contains('Invitation resent successfully').should('be.visible');

    // 5. Verify status updated to "Resent"
    cy.contains('pending@user.com')
      .parents('tr')
      .contains('Resent')
      .should('exist');

    // 6. Verify backend update (check Firestore or intercept API)
    cy.request('GET', '/api/admin/invitations?email=pending@user.com')
      .its('body.status')
      .should('eq', 'resent');
  });

  it('should show error if resend fails', () => {
    // Mock API failure
    cy.intercept('POST', '/api/admin/resend-invitation', {
      statusCode: 500,
      body: { error: 'Email service unavailable' },
    }).as('resendFail');

    cy.contains('pending@user.com')
      .parents('tr')
      .contains('button', 'Resend')
      .click();

    cy.wait('@resendFail');

    // Verify error message
    cy.contains('Failed to resend invitation').should('be.visible');
  });
});
```

**Manual Verification:**
После выполнения теста, проверить Brevo dashboard:
```
1. Открыть https://app.brevo.com/logs
2. Найти email на "pending@user.com"
3. Убедиться, что новое письмо отправлено
```

---

#### TEST CASE #12: Activity Feed Filters

**Цель:** Проверить, что фильтры работают корректно.

```typescript
// cypress/e2e/company-admin/activity-feed-filters.cy.ts
describe('Activity Feed Filters', () => {
  beforeEach(() => {
    cy.login('admin@company-a.test', 'TestPassword123');
    cy.visit('/admin/dashboard');
  });

  it('should filter by action type', () => {
    // 1. Initial state: all activities visible
    cy.get('[data-testid="activity-item"]').should('have.length.greaterThan', 5);

    // 2. Open filter dropdown
    cy.get('[data-testid="activity-filter"]').click();

    // 3. Select "role_changed" filter
    cy.contains('Role Changed').click();

    // 4. Verify only role_changed activities are shown
    cy.get('[data-testid="activity-item"]').each(($item) => {
      cy.wrap($item).should('contain', 'Role changed');
    });

    // 5. Clear filter
    cy.get('[data-testid="clear-filter"]').click();

    // 6. Verify all activities are back
    cy.get('[data-testid="activity-item"]').should('have.length.greaterThan', 5);
  });

  it('should filter by date range', () => {
    // Select "Last 7 days"
    cy.get('[data-testid="date-range-filter"]').select('7days');

    // Verify all visible activities are within 7 days
    cy.get('[data-testid="activity-timestamp"]').each(($timestamp) => {
      const activityDate = new Date($timestamp.text());
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      expect(activityDate).to.be.greaterThan(sevenDaysAgo);
    });
  });
});
```

---

## 7. Performance Testing

### 7.1 Frontend Performance (Lighthouse)

**Test Case #13: Dashboard Load Performance**

```javascript
// performance/lighthouse.test.js
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');

async function runLighthouse(url) {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
  const options = {
    logLevel: 'info',
    output: 'json',
    port: chrome.port,
  };

  const runnerResult = await lighthouse(url, options);
  await chrome.kill();

  return runnerResult.lhr;
}

describe('Dashboard Performance', () => {
  it('should meet performance thresholds', async () => {
    const report = await runLighthouse('https://profit-step-staging.web.app/admin/dashboard');

    expect(report.categories.performance.score).toBeGreaterThan(0.9); // > 90
    expect(report.audits['first-contentful-paint'].numericValue).toBeLessThan(1500); // < 1.5s
    expect(report.audits['largest-contentful-paint'].numericValue).toBeLessThan(2500); // < 2.5s
    expect(report.audits['total-blocking-time'].numericValue).toBeLessThan(200); // < 200ms
  });
});
```

---

### 7.2 Backend Load Testing (Artillery)

**Test Case #14: Company Admin Dashboard под нагрузкой**

```yaml
# artillery-load-test.yml
config:
  target: "https://profit-step-staging.web.app"
  phases:
    - duration: 60
      arrivalRate: 5
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Sustained load (50 RPS)"

  ensure:
    p95: 500  # 95th percentile < 500ms
    maxErrorRate: 1  # < 1% errors

scenarios:
  - name: "Company Admin Dashboard Load"
    flow:
      - post:
          url: "/api/auth/login"
          json:
            email: "admin@test-company.com"
            password: "{{ $processEnvironment.TEST_PASSWORD }}"
          capture:
            - json: "$.token"
              as: "authToken"

      - get:
          url: "/api/admin/activity/feed?limit=50"
          headers:
            Authorization: "Bearer {{ authToken }}"

      - get:
          url: "/api/admin/team/members"
          headers:
            Authorization: "Bearer {{ authToken }}"
```

**Run:**
```bash
npm run test:load
# Или
artillery run artillery-load-test.yml --output report.json
artillery report report.json --output report.html
```

---

## 8. E2E Testing Strategy

### 8.1 Critical User Flows (Must Pass)

```yaml
critical_flows:
  - name: "Super Admin: View Growth Metrics"
    priority: P0
    frequency: "Every release"
    steps:
      - Login as super admin
      - Navigate to /superadmin/dashboard
      - Verify growth chart renders
      - Verify metrics cards show data
      - Export CSV (optional)

  - name: "Company Admin: Invite User"
    priority: P0
    frequency: "Every release"
    steps:
      - Login as company admin
      - Navigate to /admin/team
      - Click "Invite User"
      - Fill form (email, role)
      - Submit
      - Verify invitation appears in table
      - Verify email sent (check Brevo mock)

  - name: "User: Complete Activation"
    priority: P1
    frequency: "Weekly"
    steps:
      - Signup new user
      - Verify email
      - Complete profile
      - Perform first action
      - Verify activation funnel updated

  - name: "Company Admin: Filter Activity Feed"
    priority: P1
    frequency: "Weekly"
    steps:
      - Login as company admin
      - Navigate to /admin/dashboard
      - Apply date filter
      - Apply action type filter
      - Verify results
      - Clear filters
```

---

## 9. Пофазный Plan по Неделям

### Week 1-2: Backend Foundation + Security

**Dev Tasks:**
- Firestore schema setup
- Security Rules v1
- `logUserActivity` trigger

**QA Tasks:**
- [ ] Setup Firebase Emulator
- [ ] Write `firestore.rules.test.ts` (TEST CASE #5, #6, #7)
- [ ] Write `logUserActivity.test.ts` (TEST CASE #4)
- [ ] Run seed script: `npm run seed:test`

**Deliverables:**
- ✅ 100% Security Rules coverage
- ✅ Trigger tests passing

---

### Week 3-4: Metrics Aggregation

**Dev Tasks:**
- `aggregateGrowthMetrics` function
- `aggregateEngagementMetrics` function

**QA Tasks:**
- [ ] Write `aggregateGrowthMetrics.test.ts` (TEST CASE #1)
- [ ] Manual trigger test на Emulator
- [ ] Verify data in `growthMetrics` collection
- [ ] Load test с 10K users

**Deliverables:**
- ✅ Scheduled functions tests
- ✅ Performance < 10 seconds для агрегации 10K пользователей

---

### Week 5: Email Integration

**Dev Tasks:**
- `brevoWebhookHandler` function
- `checkEmailStatuses` scheduled function

**QA Tasks:**
- [ ] Write `brevoWebhook.test.ts` (TEST CASE #3)
- [ ] Manual webhook test с cURL
- [ ] Integration test с Brevo sandbox
- [ ] Verify `emailEvents` collection

**Deliverables:**
- ✅ Webhook tests (all event types)
- ✅ Error handling tests

---

### Week 6-7: Super Admin Dashboard

**Dev Tasks:**
- GrowthPanel, EngagementPanel, CostControlPanel

**QA Tasks:**
- [ ] Component unit tests (TEST CASE #8, #9)
- [ ] Integration tests (mock Firestore)
- [ ] Cypress E2E (login → view dashboard)
- [ ] Lighthouse performance test
- [ ] Accessibility audit (axe-core)

**Deliverables:**
- ✅ Component coverage > 80%
- ✅ Lighthouse score > 90
- ✅ WCAG 2.1 AA compliance

---

### Week 8-9: Company Admin Dashboard

**Dev Tasks:**
- TeamManagementPanel, ActivityFeedPanel, InviteUserDialog

**QA Tasks:**
- [ ] EnhancedMembersTable test (TEST CASE #10)
- [ ] Resend invitation E2E (TEST CASE #11)
- [ ] Activity feed filters (TEST CASE #12)
- [ ] Cross-company isolation test
- [ ] Load test (50 concurrent admins)

**Deliverables:**
- ✅ E2E tests для всех CRUD операций
- ✅ Security isolation verified

---

### Week 10: UAT + Final Testing

**QA Tasks:**
- [ ] Full regression suite (все tests)
- [ ] UAT с реальными stakeholders
- [ ] Performance testing на staging
- [ ] Security audit (OWASP Top 10)
- [ ] Documentation review

**Deliverables:**
- ✅ All tests passing (>95%)
- ✅ UAT sign-off
- ✅ Production deployment plan

---

## 10. CI/CD Integration

### 10.1 GitHub Actions Workflow

```yaml
# .github/workflows/qa-pipeline.yml
name: QA Pipeline

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3

  security-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Start Firestore Emulator
        run: |
          firebase emulators:start --only firestore &
          sleep 10

      - name: Run security tests
        run: npm run test:security

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Start all emulators
        run: firebase emulators:exec --only firestore,functions 'npm run test:integration'

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run Cypress
        uses: cypress-io/github-action@v5
        with:
          start: npm start
          wait-on: 'http://localhost:3000'
          browser: chrome

      - name: Upload test videos
        uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: cypress-videos
          path: cypress/videos
```

---

## 11. Test Coverage Goals

### 11.1 Minimum Thresholds

```javascript
// jest.config.js
module.exports = {
  coverageThresholds: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80,
    },
    // Higher threshold for critical paths
    './src/api/*.ts': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
```

### 11.2 Tracking

| Component | Unit | Integration | E2E | Security | Total |
|-----------|------|-------------|-----|----------|-------|
| **Backend (Functions)** | 85% | 90% | - | 100% | **91%** |
| **Frontend (React)** | 80% | 70% | 50% | - | **75%** |
| **API Layer** | 90% | 95% | - | 100% | **95%** |
| **Security Rules** | - | - | - | 100% | **100%** |

---

## 12. Приложения

### 12.1 Test Data Credentials

```bash
# .env.test
SUPER_ADMIN_EMAIL=qa.superadmin@profit-step.test
SUPER_ADMIN_PASSWORD=QATestPass123!

COMPANY_A_ADMIN=qa.admin.a@profit-step.test
COMPANY_B_ADMIN=qa.admin.b@profit-step.test
TEST_USER_PASSWORD=TestUser123!

BREVO_TEST_API_KEY=xkeysib-test-***
```

### 12.2 Quick Start Commands

```bash
# Setup
npm install
firebase emulators:start

# Seed test data
npm run seed:test -- --companies=5 --users=10

# Run all tests
npm run test:all

# Run specific test suites
npm run test:unit
npm run test:security
npm run test:integration
npm run test:e2e

# Performance
npm run test:lighthouse
npm run test:load

# Cleanup
npm run seed:test -- --clean
```

---

**Итого:** Полный QA Test Plan, покрывающий все уровни тестирования, готов к исполнению параллельно с разработкой. Каждая неделя имеет четкие deliverables, критерии успеха и автоматизацию через CI/CD.
