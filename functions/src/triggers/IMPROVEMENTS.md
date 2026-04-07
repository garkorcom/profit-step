# 🚀 functions/src/triggers/ — Улучшения Триггеров

## 🔴 Критические

### 1. Idempotency
Firestore триггеры **могут сработать повторно**. Сейчас нет защиты.

**Решение — Event ID tracking:**
```typescript
export const onCostCreated = functions.firestore
  .document('costs/{costId}')
  .onCreate(async (snapshot, context) => {
    const eventId = context.eventId;
    
    // Проверка дубля
    const processed = await db.doc(`_processed/${eventId}`).get();
    if (processed.exists) {
      console.log(`⚡ Duplicate event ${eventId}, skipping`);
      return;
    }
    
    // Бизнес-логика
    await processNewCost(snapshot.data());
    
    // Пометить как обработанный
    await db.doc(`_processed/${eventId}`).set({
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      function: 'onCostCreated',
    });
  });
```

### 2. Anti-loop Protection
В `functions/src/index.ts` упоминается "enterprise anti-loop protection".
Проверить что все триггеры используют `antiLoop` guard при обновлении документов:
```typescript
// Не допускать бесконечный цикл update → trigger → update
if (snapshot.data()._lastUpdatedBy === 'trigger') return;
```

---

## 🟡 Среднесрочные

### 3. Telegram триггеры → Modular Handlers
`onWorkerBotMessage.ts` (2578 строк) — **самый большой файл**. Разбить на handlers (см. `functions/IMPROVEMENTS.md`).

### 4. Error Recovery
Сейчас при ошибке в триггере:
- Ошибка логируется
- Пользователь ничего не знает
- Данные могут остаться в inconsistent state

**Решение**: Dead Letter Queue + Alert
```typescript
try {
  await processNewTask(data);
} catch (error) {
  await db.collection('_dlq').add({
    trigger: 'onTaskCreate',
    docId: context.params.taskId,
    error: error.message,
    data: data,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Alert admin
  await sendAlert('trigger_failed', { trigger: 'onTaskCreate', error });
  throw error; // Re-throw для Cloud Functions error reporting
}
```

### 5. Batch Processing
`onBlueprintBatchCreated` создает отдельный триггер для каждой страницы.
При 50+ страницах — это 50+ concurrent functions.
Использовать batch processing или queue.

---

## 🟢 Долгосрочные

### 6. Cloud Tasks Queue
Для тяжелых операций (Blueprint AI, PDF generation) — использовать Cloud Tasks вместо прямых триггеров.

### 7. Event Sourcing
Полный audit trail всех изменений через event log.

### 8. Monitoring Dashboard
Визуализация trigger execution metrics (latency, errors, volume).
