/**
 * incrementLoginCount - Инкремент счетчика входов
 *
 * Триггер: document.onUpdate на users/{userId}
 * Срабатывает: ТОЛЬКО когда изменяется lastSeen или lastLoginAt
 * НЕ срабатывает: При изменении loginCount (защита от цикла)
 *
 * ЗАЩИТЫ:
 * 1. EventId tracking - предотвращает дубликаты
 * 2. Field change check - проверяет изменение lastSeen
 * 3. Self-update check - проверяет lastModifiedBy
 * 4. Метаданные - добавляет lastModifiedBy и lastModifiedAt
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  executeFullGuard,
  addUpdateMetadata,
  safeExecute,
} from '../../utils/guards';
import { FUNCTION_NAMES, USER_FIELDS } from '../../utils/constants';

export const incrementLoginCount = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    const functionName = FUNCTION_NAMES.INCREMENT_LOGIN_COUNT;
    const userId = context.params.userId;

    return safeExecute({
      functionName,
      context,
      executeFunc: async () => {
        const before = change.before.data();
        const after = change.after.data();

        // ========================================
        // ПОЛНАЯ ЗАЩИТА ОТ INFINITE LOOP
        // ========================================

        const guardResult = await executeFullGuard({
          eventId: context.eventId,
          functionName,
          before,
          after,
          fieldsToCheck: [USER_FIELDS.LAST_SEEN, USER_FIELDS.LAST_LOGIN_AT],
        });

        if (!guardResult.shouldProceed) {
          console.log(`${functionName}: Skipped for user ${userId}. Reason: ${guardResult.reason}`);
          return null;
        }

        // ========================================
        // ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: loginCount не должен был измениться
        // ========================================

        if (before.loginCount !== after.loginCount) {
          console.log(
            `⏩ ${functionName}: loginCount already changed (${before.loginCount} → ${after.loginCount}), ` +
            `skipping to avoid loop`
          );
          return null;
        }

        // ========================================
        // БЕЗОПАСНОЕ ОБНОВЛЕНИЕ
        // ========================================

        const updateData = addUpdateMetadata(
          {
            loginCount: admin.firestore.FieldValue.increment(1),
            lastLoginCountUpdate: admin.firestore.FieldValue.serverTimestamp(),
          },
          functionName
        );

        await change.after.ref.update(updateData);

        console.log(
          `✅ ${functionName}: Login count incremented for user ${userId} ` +
          `(${before.loginCount} → ${before.loginCount + 1})`
        );

        return null;
      },
    });
  });
