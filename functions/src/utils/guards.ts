/**
 * Anti-Loop Guards Utilities
 * Централизованные утилиты для защиты от бесконечных циклов
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { COLLECTIONS } from './constants';

/**
 * Интерфейс для результата проверки Guard
 */
export interface GuardResult {
  shouldProceed: boolean;
  reason?: string;
}

/**
 * ЗАЩИТА 1: Проверка eventId для предотвращения дубликатов
 * Использует коллекцию processedEvents для tracking обработанных событий
 */
export async function checkEventIdGuard(
  eventId: string,
  functionName: string
): Promise<GuardResult> {
  const db = admin.firestore();
  const processedRef = db.collection(COLLECTIONS.PROCESSED_EVENTS).doc(eventId);

  try {
    const processed = await processedRef.get();

    if (processed.exists) {
      const data = processed.data();
      console.log(
        `⏩ EventId Guard: Event ${eventId} already processed by ${data?.functionName} at ${data?.timestamp?.toDate()}`
      );
      return {
        shouldProceed: false,
        reason: `Event already processed by ${data?.functionName}`,
      };
    }

    // Маркируем событие как обработанное
    await processedRef.set(
      {
        functionName,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        eventId,
      },
      { merge: true }
    );

    return { shouldProceed: true };
  } catch (error) {
    console.error(`❌ Error in checkEventIdGuard:`, error);
    // В случае ошибки разрешаем выполнение (fail-open)
    return { shouldProceed: true };
  }
}

/**
 * ЗАЩИТА 2: Проверка изменения конкретного поля
 * Сравнивает before и after значения
 */
export function checkFieldChangeGuard(
  before: any,
  after: any,
  fieldName: string
): GuardResult {
  const beforeValue = before?.[fieldName];
  const afterValue = after?.[fieldName];

  if (beforeValue === afterValue) {
    console.log(`⏩ Field Guard: ${fieldName} unchanged (${beforeValue} === ${afterValue})`);
    return {
      shouldProceed: false,
      reason: `Field ${fieldName} unchanged`,
    };
  }

  console.log(`✅ Field Guard: ${fieldName} changed (${beforeValue} → ${afterValue})`);
  return { shouldProceed: true };
}

/**
 * ЗАЩИТА 3: Проверка изменения ЛЮБОГО из указанных полей
 * Возвращает true если хотя бы одно поле изменилось
 */
export function checkAnyFieldChangeGuard(
  before: any,
  after: any,
  fieldNames: string[]
): GuardResult {
  const changedFields: string[] = [];

  for (const fieldName of fieldNames) {
    if (before?.[fieldName] !== after?.[fieldName]) {
      changedFields.push(fieldName);
    }
  }

  if (changedFields.length === 0) {
    console.log(`⏩ AnyField Guard: None of [${fieldNames.join(', ')}] changed`);
    return {
      shouldProceed: false,
      reason: `None of fields [${fieldNames.join(', ')}] changed`,
    };
  }

  console.log(`✅ AnyField Guard: Fields changed: [${changedFields.join(', ')}]`);
  return { shouldProceed: true };
}

/**
 * ЗАЩИТА 4: Проверка lastModifiedBy для предотвращения самообновлений
 * Проверяет, не была ли последняя модификация сделана этой же функцией
 */
export function checkSelfUpdateGuard(after: any, functionName: string): GuardResult {
  const lastModifiedBy = after?.lastModifiedBy;

  if (lastModifiedBy === functionName) {
    console.log(`⏩ SelfUpdate Guard: Last modified by ${functionName}, skipping self-update`);
    return {
      shouldProceed: false,
      reason: `Self-update detected (lastModifiedBy: ${functionName})`,
    };
  }

  return { shouldProceed: true };
}

/**
 * КОМБИНИРОВАННАЯ ЗАЩИТА: Все 4 проверки вместе
 * Рекомендуется для всех onUpdate триггеров
 */
export async function executeFullGuard(params: {
  eventId: string;
  functionName: string;
  before: any;
  after: any;
  fieldsToCheck: string[];
}): Promise<GuardResult> {
  const { eventId, functionName, before, after, fieldsToCheck } = params;

  // ЗАЩИТА 1: EventId check
  const eventIdCheck = await checkEventIdGuard(eventId, functionName);
  if (!eventIdCheck.shouldProceed) {
    return eventIdCheck;
  }

  // ЗАЩИТА 2: Field change check
  const fieldCheck = checkAnyFieldChangeGuard(before, after, fieldsToCheck);
  if (!fieldCheck.shouldProceed) {
    return fieldCheck;
  }

  // ЗАЩИТА 3: Self-update check
  const selfUpdateCheck = checkSelfUpdateGuard(after, functionName);
  if (!selfUpdateCheck.shouldProceed) {
    return selfUpdateCheck;
  }

  // Все проверки пройдены
  console.log(`✅ Full Guard: All checks passed for ${functionName}`);
  return { shouldProceed: true };
}

/**
 * Добавляет служебные метаданные к обновлению
 * Помечает кто и когда сделал изменение
 */
export function addUpdateMetadata(
  updateData: any,
  functionName: string
): any {
  return {
    ...updateData,
    lastModifiedBy: functionName,
    lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Логирует ошибку в коллекцию functionErrors
 * Для централизованного мониторинга ошибок
 */
export async function logFunctionError(params: {
  functionName: string;
  error: Error;
  context?: any;
}): Promise<void> {
  const { functionName, error, context } = params;

  try {
    const db = admin.firestore();
    await db.collection(COLLECTIONS.FUNCTION_ERRORS).add({
      functionName,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      context: context || {},
    });

    console.error(`❌ Error logged for ${functionName}:`, error.message);
  } catch (logError) {
    console.error(`❌ Failed to log error:`, logError);
  }
}

/**
 * Обертка для безопасного выполнения функции с обработкой ошибок
 * Автоматически логирует ошибки и предотвращает retry
 */
export async function safeExecute<T>(params: {
  functionName: string;
  context: functions.EventContext;
  executeFunc: () => Promise<T>;
}): Promise<T | null> {
  const { functionName, context, executeFunc } = params;

  try {
    return await executeFunc();
  } catch (error: any) {
    console.error(`❌ Error in ${functionName}:`, error);

    // Логируем ошибку в Firestore
    await logFunctionError({
      functionName,
      error,
      context: {
        eventId: context.eventId,
        eventType: context.eventType,
        timestamp: context.timestamp,
        params: context.params,
      },
    });

    // Возвращаем null для предотвращения retry
    return null;
  }
}

/**
 * Очистка старых processedEvents (для scheduled функции)
 * Удаляет события старше 7 дней
 */
export async function cleanupProcessedEvents(): Promise<void> {
  const db = admin.firestore();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const oldEvents = await db
    .collection(COLLECTIONS.PROCESSED_EVENTS)
    .where('timestamp', '<', admin.firestore.Timestamp.fromDate(sevenDaysAgo))
    .limit(500)
    .get();

  if (oldEvents.empty) {
    console.log('No old processed events to clean up');
    return;
  }

  const batch = db.batch();
  oldEvents.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  console.log(`Cleaned up ${oldEvents.size} old processed events`);
}
