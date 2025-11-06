# Firebase Emulators Testing Guide

## 🎯 Цель
Тестирование Cloud Functions локально БЕЗ подключения к production и БЕЗ затрат.

## 🛡️ Защита от Infinite Loops
**КРИТИЧЕСКИ ВАЖНО**: Всегда тестируйте `onUpdate` триггеры в эмуляторах перед деплоем!

---

## 📦 Быстрый старт

### 1. Установка (если еще не сделано)
```bash
npm install -g firebase-tools
```

### 2. Настройка .env.local
```bash
# Скопируйте example файл
cp .env.local.example .env.local

# Включите emulators
echo "REACT_APP_USE_EMULATORS=true" > .env.local
```

### 3. Запуск Emulators
```bash
# В корневой папке проекта
firebase emulators:start

# Или с импортом данных из production (опционально)
firebase emulators:start --import=./emulator-data --export-on-exit
```

### 4. Запуск React App
```bash
# В другом терминале
npm start
```

Приложение автоматически подключится к эмуляторам!

---

## 🌐 Доступные URLs

После запуска эмуляторов:
- **Emulator UI**: http://localhost:4000 (главная панель управления)
- **Auth Emulator**: http://localhost:9099
- **Firestore Emulator**: http://localhost:8080
- **Functions Emulator**: http://localhost:5001
- **Storage Emulator**: http://localhost:9199
- **Hosting Emulator**: http://localhost:5000

---

## 🧪 Тестирование `incrementLoginCount` Fix

### Scenario: Проверка что исправлен infinite loop

1. **Запустите эмуляторы**:
   ```bash
   firebase emulators:start
   ```

2. **Откройте Emulator UI**: http://localhost:4000

3. **Создайте тестового пользователя** через Firestore tab:
   - Collection: `users`
   - Document ID: `test-user-1`
   - Fields:
     ```json
     {
       "email": "test@example.com",
       "displayName": "Test User",
       "companyId": "test-company",
       "status": "active",
       "role": "employee",
       "loginCount": 0,
       "lastSeen": null
     }
     ```

4. **Обновите lastSeen** (имитация входа):
   - Откройте документ `users/test-user-1`
   - Измените `lastSeen` на текущее время (Timestamp)
   - Сохраните

5. **Проверьте Logs в Functions tab**:
   - Должны увидеть: `📊 Login count incremented for user: test-user-1`
   - Должны увидеть ТОЛЬКО ОДИН вызов!

6. **Проверьте loginCount в Firestore**:
   - Откройте документ `users/test-user-1`
   - `loginCount` должен быть `1`

7. **Повторите шаг 4-6 несколько раз**:
   - При каждом изменении `lastSeen` → `loginCount` +1
   - НЕ должно быть бесконечного цикла!

### ✅ Ожидаемое поведение (после fix)
```
User update: lastSeen changed
  ↓
incrementLoginCount triggered
  ↓
Guard check: loginCount NOT changed yet → PROCEED
  ↓
Update loginCount +1
  ↓
incrementLoginCount triggered AGAIN (because loginCount changed)
  ↓
Guard check: loginCount DID change → SKIP UPDATE ✅
  ↓
No infinite loop! 🎉
```

### ❌ Признаки infinite loop (старая версия)
- Logs показывают сотни/тысячи вызовов за секунды
- `loginCount` увеличивается на 10, 100, 1000+ за один вход
- Functions emulator зависает или крашится

---

## 🔍 Расширенное тестирование

### Тестирование с реальным workflow

1. **Запустите emulators с export**:
   ```bash
   firebase emulators:start --export-on-exit=./emulator-data
   ```

2. **В React App (http://localhost:3000)**:
   - Зарегистрируйте пользователя
   - Войдите в систему
   - Обновите профиль
   - Загрузите аватар

3. **Проверьте Emulator UI**:
   - **Firestore tab**: Посмотрите все созданные документы
   - **Functions tab**: Посмотрите все вызовы и логи
   - **Auth tab**: Посмотрите зарегистрированных пользователей

4. **Остановите emulators** (Ctrl+C):
   - Данные автоматически экспортируются в `./emulator-data`

5. **Перезапустите с теми же данными**:
   ```bash
   firebase emulators:start --import=./emulator-data
   ```

---

## 🐛 Debug Tips

### Если emulators не запускаются
```bash
# Проверьте что порты не заняты
lsof -i :4000
lsof -i :8080
lsof -i :5001

# Убейте процессы если нужно
kill -9 <PID>
```

### Если React App не подключается
1. Проверьте `.env.local`:
   ```bash
   cat .env.local
   # Должно быть: REACT_APP_USE_EMULATORS=true
   ```

2. Проверьте console в браузере:
   ```
   Должны увидеть:
   🔧 Connecting to Firebase Emulators...
   ✅ Connected to Firebase Emulators
   ```

3. Перезапустите React App:
   ```bash
   # Остановите (Ctrl+C) и перезапустите
   npm start
   ```

### Если Functions не триггерятся
1. Проверьте что Functions скомпилированы:
   ```bash
   cd functions
   npm run build
   ```

2. Перезапустите emulators после изменений в Functions

---

## 📊 Мониторинг в Production

После деплоя в production, проверьте:

1. **Firebase Console → Functions → Logs**:
   - Ищите паттерн: многократные вызовы одной функции за миллисекунды
   - Должны видеть `⏩ Skipping loginCount update` логи

2. **Firebase Console → Usage**:
   - Следите за Firestore reads/writes
   - Должны быть нормальные цифры (не миллионы)

3. **Google Cloud Console → Billing**:
   - Проверяйте ежедневно первые 2-3 дня после деплоя

---

## 🚀 Деплой после тестирования

Когда все протестировано в emulators:

```bash
# 1. Build functions
cd functions
npm run build

# 2. Deploy только functions
firebase deploy --only functions

# 3. Следите за логами
firebase functions:log --only incrementLoginCount
```

---

## 📝 Checklist перед деплоем

- [ ] Emulators запускаются без ошибок
- [ ] Все Functions триггерятся корректно
- [ ] `incrementLoginCount` НЕ создает infinite loop
- [ ] Логи показывают `⏩ Skipping` когда нужно
- [ ] `loginCount` инкрементируется ровно на +1 при каждом входе
- [ ] Нет ошибок в Functions logs
- [ ] TypeScript компилируется без ошибок

---

## 🆘 Emergency Response

Если после деплоя обнаружен infinite loop:

1. **Немедленно отключите проблемную функцию**:
   ```bash
   firebase functions:delete incrementLoginCount
   ```

2. **Проверьте billing**:
   - Google Cloud Console → Billing
   - Если счет растет - отключите billing (см. DEFENSIVE_PROGRAMMING_GUIDE.md)

3. **Исправьте и протестируйте в emulators**

4. **Задеплойте исправленную версию**
