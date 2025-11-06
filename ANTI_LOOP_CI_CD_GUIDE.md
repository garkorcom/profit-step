# 🛡️ Anti-Loop CI/CD Pipeline - Complete Guide

**Автоматическая система защиты от бесконечных циклов в Firebase Functions**

---

## 🎯 Что это?

Трёхуровневая автоматизированная система которая **физически блокирует** deployment кода с потенциальными infinite loops.

### Проблема которую решаем:
- ❌ Один bug в `onUpdate` триггере = $174+ счет за 5 дней
- ❌ 13+ миллионов Firestore API calls
- ❌ Катастрофические billing charges

### Решение:
✅ **4 автоматических компонента** которые НЕ пропустят опасный код в production

---

## 📊 Компоненты системы

### 1️⃣ Юнит-Тесты (Jest + Firebase Emulators)
**Файлы**:
- `functions/test/antiloop.trackUserActivation.test.ts`
- `functions/test/antiloop.incrementLoginCount.test.ts`
- `functions/jest.config.js`

**Что делают**:
- Запускают Firebase Emulators локально
- Симулируют множественные обновления документов
- Проверяют что Idempotency Guards работают
- Проверяют что нет infinite loops

**Запуск**:
```bash
cd functions

# Запустить только anti-loop тесты
npm run test:antiloop

# Запустить все тесты
npm test

# Запустить с coverage
npm run test:coverage
```

**Пример теста**:
```typescript
test('должен увеличить loginCount на +1 (НЕ infinite loop)', async () => {
  // 1. Создаем пользователя с loginCount = 1
  await db.collection('users').doc(testUserId).set({
    loginCount: 1,
    lastSeen: Timestamp.fromDate(new Date('2025-01-01')),
  });

  // 2. Симулируем вход (обновляем lastSeen)
  await db.collection('users').doc(testUserId).update({
    lastSeen: FieldValue.serverTimestamp(),
  });

  await wait(2000);

  // 3. ПРОВЕРКА: loginCount должен быть = 2 (НЕ 1000+!)
  const userDoc = await db.collection('users').doc(testUserId).get();
  expect(userDoc.data()?.loginCount).toBe(2);
  expect(userDoc.data()?.loginCount).toBeLessThan(10); // ← CRITICAL CHECK
});
```

---

### 2️⃣ Custom ESLint Rule
**Файлы**:
- `functions/eslint-rules/firebase-no-trigger-loop.js`
- `functions/.eslintrc.js`

**Что делает**:
- Анализирует AST (Abstract Syntax Tree) кода
- Ищет `onUpdate`/`onWrite` триггеры
- Проверяет есть ли `update()` на тот же документ
- Проверяет наличие Idempotency Guards
- **БЛОКИРУЕТ commit** если Guard отсутствует

**Запуск**:
```bash
cd functions

# Проверить код
npm run lint

# Исправить автоматически (где возможно)
npm run lint:fix
```

**Что ловит**:
```typescript
// ❌ ОШИБКА: ESLint выдаст ERROR
export const badFunction = functions
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    // Нет Idempotency Guard!
    await change.after.ref.update({ count: 1 }); // ← INFINITE LOOP!
  });

// ✅ OK: ESLint пропустит
export const goodFunction = functions
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data(); // ← Guard
    const after = change.after.data();

    if (before.field === after.field) return; // ← Guard check

    await change.after.ref.update({ count: 1 }); // ← Безопасно
  });
```

---

### 3️⃣ Pull Request Template
**Файл**: `.github/pull_request_template.md`

**Что делает**:
- Автоматически добавляется к каждому PR
- Чек-лист который НЕЛЬЗЯ проигнорировать
- Напоминает разработчику о рисках
- Требует подтверждения тестирования

**Чек-лист включает**:
- ✅ Добавлены Idempotency Guards
- ✅ Протестировано в Firebase Emulators
- ✅ Написаны юнит-тесты
- ✅ Запущен `npm run lint`
- ✅ Понимаю риски ($10,000+ счет)

---

### 4️⃣ GitHub Actions CI/CD Pipeline
**Файл**: `.github/workflows/firebase-deploy-gate.yml`

**Что делает**:
- Запускается на каждый `push` в `main` или PR
- Выполняет **5 jobs** последовательно
- **БЛОКИРУЕТ deployment** если хоть один job провалился

**Jobs**:

#### Job 1: 🔍 Static Analysis (ESLint)
```yaml
- Run: npm run lint
- Checks: Custom anti-loop ESLint rule
- Fails if: Обнаружен потенциальный infinite loop
```

#### Job 2: 🧪 Unit Tests
```yaml
- Starts: Firebase Emulators
- Run: npm run test:antiloop
- Checks: Anti-loop tests pass
- Fails if: Тесты падают или зависают
```

#### Job 3: 🏗️ Build Check
```yaml
- Run: npm run build
- Checks: TypeScript компилируется
- Fails if: Compilation errors
```

#### Job 4: 🔒 Security Audit
```yaml
- Run: npm audit
- Checks: Нет critical vulnerabilities
- Warning only: Не блокирует deployment
```

#### Job 5: 🚀 Deploy (Conditional)
```yaml
- Runs ONLY if: Jobs 1-4 passed
- Runs ONLY if: Push to main branch
- Action: firebase deploy
- Result: Deployment to production
```

**Пример вывода при ошибке**:
```
🔍 Static Analysis (ESLint) ❌ FAILED

Error: firebase-no-trigger-loop
  Line 42: 🚨 DANGER: Potential infinite loop detected!
  onUpdate trigger calls update() on the same document without idempotency guard.

  This can cause millions of API calls and $$$$ billing.

  Add: `if (change.before.data()... === change.after.data()...) return;` at the start.

❌ Deployment BLOCKED
```

---

## 🚀 Как использовать систему

### Для разработчика:

#### 1. Локальная разработка

**Перед написанием кода:**
```bash
# Читайте гайд
cat DEFENSIVE_PROGRAMMING_GUIDE.md
```

**Во время разработки:**
```bash
# Запускайте emulators
firebase emulators:start

# В другом терминале
npm start  # React app подключится к emulators
```

**После написания кода:**
```bash
cd functions

# 1. Проверьте lint
npm run lint

# 2. Запустите anti-loop тесты
npm run test:antiloop

# 3. Запустите все тесты
npm test

# 4. Build
npm run build
```

#### 2. Создание Pull Request

1. Commit и push код
2. GitHub автоматически добавит PR template
3. **ЗАПОЛНИТЕ ВСЕ ЧЕКБОКСЫ** в template
4. Дождитесь GitHub Actions (зеленые галочки)
5. Request review

**GitHub Actions покажет**:
- ✅ Static Analysis passed
- ✅ Tests passed
- ✅ Build successful
- ✅ Ready to deploy

#### 3. После Merge

**Автоматически**:
- GitHub Actions запустится на `main`
- Все проверки выполнятся снова
- Если все ✅ → deployment в production
- Если хоть одна ❌ → deployment заблокирован

**Вручную**:
- Мониторьте Firebase Console → Functions → Logs
- Проверяйте каждые 6 часов первые 48 часов
- Ищите паттерны повторяющихся вызовов

---

### Для code reviewer:

#### Что проверять в PR:

**1. Чек-лист заполнен**:
- Все чекбоксы отмечены
- Автор понимает риски

**2. GitHub Actions зеленые**:
- ✅ Lint passed
- ✅ Tests passed
- ✅ Build passed

**3. Code review**:
```typescript
// Проверьте что есть Guards в onUpdate/onWrite:

// ✅ GOOD
export const myTrigger = functions
  .firestore.document('path/{id}')
  .onUpdate(async (change, context) => {
    const before = change.before.data(); // ← Guard 1
    const after = change.after.data();   // ← Guard 2

    // Guard 3: Early exit
    if (before.field === after.field) {
      return null; // ← ВАЖНО!
    }

    // Безопасное обновление
    await someOtherCollection.update({ ... });
  });
```

**4. Тесты покрывают новый код**:
- Есть тест для нового триггера
- Тест проверяет Idempotency Guard
- Тест проверяет что нет infinite loop

#### Если что-то не так:

**Request Changes и комментарий**:
```markdown
⚠️ Changes Requested: Missing Idempotency Guard

Функция `incrementSomething` (line 42) использует `onUpdate` но не имеет Guard.

Это может вызвать infinite loop и катастрофический billing.

Пожалуйста добавьте:
```typescript
const before = change.before.data();
const after = change.after.data();

if (before.count !== after.count) {
  return null; // Skip if already updated
}
```

См. `DEFENSIVE_PROGRAMMING_GUIDE.md` для примеров.
```

---

## 🧪 Тестирование системы

### Тест 1: Проверка ESLint Rule

**Создайте файл с намеренной ошибкой**:
```typescript
// functions/src/test-bad-function.ts
export const testBadFunction = functions
  .firestore.document('test/{id}')
  .onUpdate(async (change) => {
    await change.after.ref.update({ bad: true }); // ← No guard!
  });
```

**Запустите lint**:
```bash
npm run lint
```

**Ожидаемый результат**: ❌ ERROR от `firebase-no-trigger-loop`

---

### Тест 2: Проверка Anti-Loop Tests

**Запустите тесты**:
```bash
# Убедитесь что emulators запущены
firebase emulators:start &

# Запустите anti-loop тесты
cd functions
npm run test:antiloop
```

**Ожидаемый результат**:
```
PASS test/antiloop.incrementLoginCount.test.ts
  🚨 CRITICAL Anti-Loop: incrementLoginCount
    ✓ должен увеличить loginCount на +1 при первом входе (2543 ms)
    ✓ должен увеличить loginCount на +1 при втором входе (2134 ms)
    ✓ 🔥 STRESS: должен выдержать 10 входов подряд (8765 ms)
    ✓ 💰 BILLING PROTECTION: worst case scenario (6543 ms)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

---

### Тест 3: Проверка GitHub Actions

**1. Создайте тестовую ветку**:
```bash
git checkout -b test/ci-cd-pipeline
```

**2. Внесите изменение**:
```bash
echo "// Test CI/CD" >> functions/src/index.ts
git add -A
git commit -m "test: CI/CD pipeline"
git push origin test/ci-cd-pipeline
```

**3. Создайте PR**:
- Откройте GitHub
- Create Pull Request
- Наблюдайте за GitHub Actions

**4. Проверьте**:
- ✅ Все jobs прошли
- ✅ PR можно merge
- ✅ Comment от бота с результатами

---

## 📊 Мониторинг после deployment

### Day 1-2 (Первые 48 часов) - Критический период

**Каждые 6 часов проверяйте**:

**1. Firebase Console → Functions → Logs**
```
https://console.firebase.google.com/project/profit-step/functions/logs
```

Ищите:
- ✅ `⏩ Skipping loginCount update` - Guards работают!
- ✅ `📊 Login count incremented` - Нормальная работа
- 🚨 Повторяющиеся вызовы за секунды - ТРЕВОГА!

**2. Google Cloud Console → Billing**
```
https://console.cloud.google.com/billing?project=profit-step
```

Проверяйте:
- Current day spend (норма: < $1/день)
- Firestore API calls (норма: < 100,000/день)
- Functions invocations (норма: < 10,000/день)

**3. Cloud Function Metrics**
```bash
gcloud functions logs read FUNCTION_NAME --region=us-central1 --gen2
```

### Week 1 - Regular monitoring

**Раз в день проверяйте**:
- Functions logs
- Billing dashboard
- Alerts emails

### Month 1+ - Automated monitoring

**Настройте**:
- Budget Alerts (уже настроены)
- Auto-Shutoff функция (уже задеплоена)
- Weekly billing reports

---

## 🚨 Emergency Response

### Если GitHub Actions заблокировали deployment:

**1. НЕ пытайтесь обойти систему!**
- ❌ Не делайте `--no-verify`
- ❌ Не деплойте вручную
- ❌ Не игнорируйте ошибки

**2. Анализируйте ошибку**:
```bash
# Локально проверьте
npm run lint
npm test

# Прочитайте ошибку внимательно
```

**3. Исправьте проблему**:
- Добавьте Idempotency Guard
- Напишите тест
- Убедитесь что lint прошел

**4. Push исправление**:
- GitHub Actions запустятся снова
- Если все ✅ → deployment разблокирован

---

### Если заметили infinite loop в production:

**НЕМЕДЛЕННО**:
```bash
# 1. Отключите проблемную функцию
firebase functions:delete FUNCTION_NAME

# 2. Проверьте billing
# https://console.cloud.google.com/billing

# 3. Если billing растет - отключите проект
# (Auto-Shutoff функция должна сработать автоматически при $50)
```

---

## ✅ Checklist: Система работает

- [ ] ESLint rule установлен и настроен
- [ ] Anti-loop тесты написаны и проходят
- [ ] PR template отображается в новых PR
- [ ] GitHub Actions запускаются на каждый push/PR
- [ ] Deployment блокируется если тесты падают
- [ ] Emulators работают локально
- [ ] Budget Alerts настроены ($10/месяц)
- [ ] Auto-Shutoff функция задеплоена
- [ ] Команда знает о системе и использует её

---

## 📚 Дополнительные ресурсы

**Документация**:
- `DEFENSIVE_PROGRAMMING_GUIDE.md` - Полное руководство по защите
- `EMULATORS_TESTING.md` - Как тестировать локально
- `BUDGET_ALERTS_SETUP.md` - Настройка billing защиты
- `INFINITE_LOOP_FIX_SUMMARY.md` - История бага и исправления

**Тесты**:
- `functions/test/antiloop.*.test.ts` - Anti-loop тесты
- `functions/jest.config.js` - Jest конфигурация

**CI/CD**:
- `.github/workflows/firebase-deploy-gate.yml` - Pipeline
- `.github/pull_request_template.md` - PR template
- `functions/.eslintrc.js` - ESLint конфигурация

---

## 🎓 Training для команды

**Для новых разработчиков**:

**День 1: Теория**
1. Прочитать `DEFENSIVE_PROGRAMMING_GUIDE.md`
2. Изучить примеры infinite loops
3. Понять как работают Idempotency Guards

**День 2: Практика**
1. Запустить Firebase Emulators
2. Создать тестовый onUpdate триггер
3. Написать юнит-тест для него
4. Запустить ESLint и исправить ошибки

**День 3: CI/CD**
1. Создать тестовую ветку
2. Сделать PR с изменениями
3. Наблюдать за GitHub Actions
4. Понять что происходит при ошибке

**Сертификация**:
- [ ] Понимаю как работают onUpdate триггеры
- [ ] Могу написать Idempotency Guard
- [ ] Могу запустить Emulators локально
- [ ] Могу написать юнит-тест для триггера
- [ ] Понимаю как работает CI/CD pipeline
- [ ] Знаю как реагировать на emergency

---

## 💰 ROI (Return on Investment)

**Стоимость внедрения системы**: ~8 часов работы

**Предотвращенные потери**:
- $174+ billing disaster (уже случился раз)
- $10,000+ potential future disasters
- Бесконечные часы debugging в production
- Репутационные потери

**ROI**: **∞** (бесценно!)

---

## 🎉 Итог

**У вас теперь есть**:
1. ✅ Автоматические юнит-тесты с Emulators
2. ✅ Custom ESLint правило для статического анализа
3. ✅ PR Template с обязательным чек-листом
4. ✅ GitHub Actions CI/CD который блокирует опасный код

**Результат**:
🛡️ **Infinite loops физически не могут попасть в production!**

**Следующий шаг**:
Запустите `npm test` и убедитесь что все работает! 🚀
