/**
 * Activity Logger Cloud Functions
 * Автоматически логируют активность пользователей в компании
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Вспомогательная функция для создания лога активности
 */
async function logActivity(params: {
  companyId: string;
  userId: string;
  actorId: string;
  action: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    await db.collection('activityLog').add({
      ...params,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`📝 Activity logged: ${params.action} by ${params.actorId}`);
  } catch (error) {
    console.error('❌ Error logging activity:', error);
  }
}

/**
 * Логирование при создании пользователя (signup/invite accepted)
 */
export const logUserCreated = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onCreate(async (snap, context) => {
    try {
      const userId = context.params.userId;
      const userData = snap.data();

      if (!userData.companyId) {
        console.log('⚠️ User has no companyId, skipping activity log');
        return;
      }

      await logActivity({
        companyId: userData.companyId,
        userId,
        actorId: userData.invitedBy || userId, // Если приглашен - кто пригласил, иначе сам
        action: userData.invitedBy ? 'user_joined' : 'user_registered',
        metadata: {
          displayName: userData.displayName,
          email: userData.email,
          role: userData.role,
          signupMethod: userData.signupMethod || 'email',
        },
      });
    } catch (error) {
      console.error('❌ Error logging user creation:', error);
    }
  });

/**
 * Логирование изменений пользователя
 */
export const logUserUpdates = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    try {
      const userId = context.params.userId;
      const before = change.before.data();
      const after = change.after.data();

      if (!after.companyId) {
        return;
      }

      // Изменение роли
      if (before.role !== after.role) {
        await logActivity({
          companyId: after.companyId,
          userId,
          actorId: userId, // В реальности нужно получать из context
          action: 'role_changed',
          metadata: {
            oldRole: before.role,
            newRole: after.role,
            displayName: after.displayName,
          },
        });
      }

      // Обновление профиля (title или другие поля)
      if (before.title !== after.title || before.phone !== after.phone) {
        await logActivity({
          companyId: after.companyId,
          userId,
          actorId: userId,
          action: 'profile_updated',
          metadata: {
            displayName: after.displayName,
            changes: {
              title: before.title !== after.title ? { old: before.title, new: after.title } : undefined,
              phone: before.phone !== after.phone ? { old: before.phone, new: after.phone } : undefined,
            },
          },
        });
      }

      // Загрузка аватара
      if ((!before.photoURL || before.photoURL === '') && after.photoURL) {
        await logActivity({
          companyId: after.companyId,
          userId,
          actorId: userId,
          action: 'avatar_uploaded',
          metadata: {
            displayName: after.displayName,
          },
        });
      }

      // Изменение статуса (активация/деактивация)
      if (before.status !== after.status) {
        await logActivity({
          companyId: after.companyId,
          userId,
          actorId: userId, // В реальности нужно получать actorId из request context
          action: after.status === 'active' ? 'user_activated' : 'user_deactivated',
          metadata: {
            displayName: after.displayName,
            oldStatus: before.status,
            newStatus: after.status,
          },
        });
      }
    } catch (error) {
      console.error('❌ Error logging user updates:', error);
    }
  });

/**
 * Логирование удаления пользователя
 */
export const logUserDeleted = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onDelete(async (snap, context) => {
    try {
      const userId = context.params.userId;
      const userData = snap.data();

      if (!userData.companyId) {
        return;
      }

      await logActivity({
        companyId: userData.companyId,
        userId,
        actorId: 'system', // В реальности нужно получать из context
        action: 'user_deleted',
        metadata: {
          displayName: userData.displayName,
          email: userData.email,
          role: userData.role,
        },
      });
    } catch (error) {
      console.error('❌ Error logging user deletion:', error);
    }
  });

/**
 * Логирование отправки приглашения
 */
export const logInvitationSent = functions
  .region('us-central1')
  .firestore.document('invitations/{inviteId}')
  .onCreate(async (snap, context) => {
    try {
      const inviteData = snap.data();

      await logActivity({
        companyId: inviteData.companyId,
        userId: inviteData.invitedBy, // Кто будет пользователь - пока неизвестно
        actorId: inviteData.invitedBy,
        action: 'invitation_sent',
        metadata: {
          email: inviteData.email,
          role: inviteData.role,
          inviteId: context.params.inviteId,
        },
      });
    } catch (error) {
      console.error('❌ Error logging invitation:', error);
    }
  });

/**
 * Логирование принятия приглашения
 */
export const logInvitationAccepted = functions
  .region('us-central1')
  .firestore.document('invitations/{inviteId}')
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data();
      const after = change.after.data();

      // Проверяем что статус изменился на accepted
      if (before.status !== 'accepted' && after.status === 'accepted') {
        // Находим пользователя по email
        const usersSnapshot = await db
          .collection('users')
          .where('email', '==', after.email)
          .limit(1)
          .get();

        if (!usersSnapshot.empty) {
          const userDoc = usersSnapshot.docs[0];
          const userId = userDoc.id;

          await logActivity({
            companyId: after.companyId,
            userId,
            actorId: userId,
            action: 'invitation_accepted',
            metadata: {
              email: after.email,
              invitedBy: after.invitedBy,
              inviteId: context.params.inviteId,
            },
          });
        }
      }
    } catch (error) {
      console.error('❌ Error logging invitation acceptance:', error);
    }
  });

/**
 * Инкремент счетчика входов при каждом lastSeen update
 * ✅ FIXED: Added idempotency guards to prevent infinite loop
 */
export const incrementLoginCount = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data();
      const after = change.after.data();
      const userId = context.params.userId;

      // 🛡️ IDEMPOTENCY GUARD: Only proceed if lastSeen actually changed
      // This prevents infinite loop: lastSeen update → loginCount update → triggers onUpdate → exits here
      if (before.lastSeen === after.lastSeen) {
        console.log(`⏩ Guard activated: lastSeen did not change for user ${userId}. Exiting.`);
        return null;
      }

      // Safe to increment: lastSeen changed (user actually logged in)
      await change.after.ref.update({
        loginCount: admin.firestore.FieldValue.increment(1),
      });

      console.log(`📊 Login count incremented for user: ${userId}`);
      return null;
    } catch (error) {
      console.error('❌ Error incrementing login count:', error);
      return null;
    }
  });

/**
 * Обновление счетчика членов команды в компании (denormalization)
 */
export const updateCompanyMemberCount = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onWrite(async (change, context) => {
    try {
      let companyId: string | null = null;

      // Определяем companyId
      if (change.after.exists) {
        companyId = change.after.data()?.companyId;
      } else if (change.before.exists) {
        companyId = change.before.data()?.companyId;
      }

      if (!companyId) {
        return;
      }

      // Подсчитываем активных членов команды
      const membersSnapshot = await db
        .collection('users')
        .where('companyId', '==', companyId)
        .where('status', '==', 'active')
        .count()
        .get();

      const memberCount = membersSnapshot.data().count;

      // Обновляем компанию
      await db.collection('companies').doc(companyId).update({
        memberCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`👥 Company ${companyId} member count updated: ${memberCount}`);
    } catch (error) {
      console.error('❌ Error updating company member count:', error);
    }
  });
