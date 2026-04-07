# 🚀 functions/ — Улучшения Cloud Functions Backend

## 🔴 Критические

### 1. Декомпозиция onWorkerBotMessage.ts (2578 строк)
Самый большой файл в проекте. Содержит **всю** логику Telegram Worker Bot.

**Текущая структура**: Один гигантский switch/case.
**Целевая структура**: 
```
triggers/telegram/
├── onWorkerBotMessage.ts      → router (100 строк)
├── handlers/
│   ├── startHandler.ts        — /start, выбор клиента
│   ├── stopHandler.ts         — /stop, завершение смены
│   ├── costHandler.ts         — Отправка чека/расхода
│   ├── photoHandler.ts        — Обработка фото
│   ├── voiceHandler.ts        — Обработка голосовых
│   ├── locationHandler.ts     — Обработка геолокации
│   └── menuHandler.ts         — Inline keyboard callbacks
├── telegramUtils.ts           — Утилиты (sendMessage, formatKeyboard)
└── rateUtils.ts               — Расчет ставок
```

### 2. Включить Rate Limiting
```typescript
// index.ts:374 — TODO уже год как висит
// Создать Firestore индекс и включить!
```

### 3. Убрать тестовые файлы
Переместить из корня `functions/` в `functions/__tests__/`:
- `test_db.js`, `test_db2.js`, `test_db_final.js`
- `test_credentials.js`
- `investigate-victor.js`
- `check_sessions.js`

---

## 🟡 Среднесрочные

### 4. Firebase Functions Gen 2
Часть функций на v1 API (`functions.https.onCall`), часть на v2.
Стандартизировать на Gen 2 для:
- Более гибкий runtime (timeout, memory, concurrency)
- Cloud Run integration
- Traffic splitting

### 5. Cold Start Optimization
- Lazy-load тяжелых зависимостей (AI SDKs, Sharp)
- Modular Firebase Admin init
- Уменьшить размер бандла (tree-shaking)

### 6. Error Monitoring
Добавить structured logging + Cloud Error Reporting:
```typescript
const { error: logError } = functions.logger;
logError('Function failed', { error, context, userId });
```

### 7. Idempotency для триггеров
Сейчас триггеры могут сработать повторно при ошибке. Добавить:
```typescript
const eventId = context.eventId;
const ref = db.doc(`_processed_events/${eventId}`);
const exists = await ref.get();
if (exists.exists) return; // Already processed
await ref.set({ processedAt: FieldValue.serverTimestamp() });
```

---

## 🟢 Долгосрочные

### 8. Monorepo Structure
Вынести shared code (types, utils) в общий пакет:
```
packages/
  shared/         — types, validation schemas
  functions/      — Cloud Functions
  web/            — React frontend
```

### 9. Dead Letter Queue
Для failed triggers — отправлять в DLQ вместо silent fail.

### 10. Integration Tests
Расширить тестовое покрытие Agent API (уже есть jest.agentApi.config.js).
