/**
 * logUserUpdates - Логирование изменений пользователя
 *
 * Триггер: document.onUpdate на users/{userId}
 * Действие: Записывает в activityLog (НЕ обновляет users!)
 * Игнорирует: Служебные поля (loginCount, lastModifiedBy и т.д.)
 *
 * ЗАЩИТЫ:
 * 1. EventId tracking
 * 2. Field change check - проверяет "значимые" поля
 * 3. Self-update check
 * 4. Игнорирует изменения служебных полей
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  checkEventIdGuard,
  checkSelfUpdateGuard,
  safeExecute,
} from '../../utils/guards';
import { FUNCTION_NAMES, USER_FIELDS, COLLECTIONS } from '../../utils/constants';

// "Значимые" поля для логирования
const SIGNIFICANT_FIELDS = [
  USER_FIELDS.ROLE,
  USER_FIELDS.TITLE,
  USER_FIELDS.PHONE,
  USER_FIELDS.PHOTO_URL,
  USER_FIELDS.STATUS,
  USER_FIELDS.EMAIL,
  USER_FIELDS.DISPLAY_NAME,
  USER_FIELDS.COMPANY_ID,
];

export const logUserUpdates = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    const functionName = FUNCTION_NAMES.LOG_USER_UPDATES;
    const userId = context.params.userId;

    return safeExecute({
      functionName,
      context,
      executeFunc: async () => {
        const before = change.before.data();
        const after = change.after.data();

        // ========================================
        // ЗАЩИТА 1: EventId check
        // ========================================

        const eventIdCheck = await checkEventIdGuard(context.eventId, functionName);
        if (!eventIdCheck.shouldProceed) {
          return null;
        }

        // ========================================
        // ЗАЩИТА 2: Self-update check
        // ========================================

        const selfUpdateCheck = checkSelfUpdateGuard(after, functionName);
        if (!selfUpdateCheck.shouldProceed) {
          return null;
        }

        // ========================================
        // ЗАЩИТА 3: Проверяем изменились ли "значимые" поля
        // ========================================

        const changes: Record<string, { before: any; after: any }> = {};

        for (const field of SIGNIFICANT_FIELDS) {
          if (before[field] !== after[field]) {
            changes[field] = {
              before: before[field],
              after: after[field],
            };
          }
        }

        if (Object.keys(changes).length === 0) {
          console.log(
            `⏩ ${functionName}: No significant changes for user ${userId}, skipping log`
          );
          return null;
        }

        // ========================================
        // ЛОГИРОВАНИЕ (в отдельную коллекцию!)
        // ========================================

        if (!after.companyId) {
          console.log(`⏩ ${functionName}: User ${userId} has no companyId, skipping`);
          return null;
        }

        const db = admin.firestore();

        // Определяем тип действия
        let action = 'profile_updated';
        if (changes[USER_FIELDS.ROLE]) {
          action = 'role_changed';
        } else if (changes[USER_FIELDS.STATUS]) {
          action = changes[USER_FIELDS.STATUS].after === 'active'
            ? 'user_activated'
            : 'user_deactivated';
        } else if (changes[USER_FIELDS.PHOTO_URL]) {
          action = 'avatar_uploaded';
        }

        await db.collection(COLLECTIONS.ACTIVITY_LOG).add({
          companyId: after.companyId,
          userId,
          actorId: userId,
          action,
          changes,
          metadata: {
            displayName: after.displayName,
            email: after.email,
          },
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(
          `✅ ${functionName}: Logged ${action} for user ${userId}. ` +
          `Changed fields: ${Object.keys(changes).join(', ')}`
        );

        return null;
      },
    });
  });
