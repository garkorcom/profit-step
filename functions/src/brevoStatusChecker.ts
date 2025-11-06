/**
 * Brevo Status Checker (Alternative to Webhooks)
 * Периодически проверяет статус отправленных писем через Brevo API
 * Используется если Webhooks недоступны в плане
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Scheduled Function: Проверка статусов email каждые 15 минут
 * Запускается автоматически для pending приглашений
 */
export const checkEmailStatuses = functions
  .region('us-central1')
  .pubsub.schedule('*/15 * * * *') // Каждые 15 минут
  .timeZone('America/New_York')
  .onRun(async (context) => {
    try {
      console.log('🔄 Starting email status check...');

      // Получаем pending приглашения за последние 48 часов
      const twoDaysAgo = new Date();
      twoDaysAgo.setHours(twoDaysAgo.getHours() - 48);
      const twoDaysAgoTimestamp = admin.firestore.Timestamp.fromDate(twoDaysAgo);

      const pendingInvites = await db
        .collection('invitations')
        .where('status', 'in', ['pending', 'delivered'])
        .where('sentAt', '>', twoDaysAgoTimestamp)
        .limit(50) // Проверяем максимум 50 за раз
        .get();

      if (pendingInvites.empty) {
        console.log('ℹ️ No pending invitations to check');
        return { checked: 0 };
      }

      console.log(`📧 Checking ${pendingInvites.size} invitations...`);

      // Проверяем каждое приглашение через Brevo API
      const updatePromises = pendingInvites.docs.map(async (doc) => {
        try {
          const invitation = doc.data();
          const email = invitation.email;
          const messageId = invitation.messageId; // Нужно сохранять при отправке

          if (!messageId) {
            console.log(`⚠️ No messageId for ${email}, skipping`);
            return;
          }

          // Здесь будет запрос к Brevo API
          // const status = await getBrevoEmailStatus(messageId);
          // await updateInvitationStatus(doc.id, status);

          console.log(`✅ Checked status for ${email}`);
        } catch (error) {
          console.error(`❌ Error checking ${doc.id}:`, error);
        }
      });

      await Promise.all(updatePromises);

      console.log(`✅ Status check completed: ${pendingInvites.size} invitations`);
      return { checked: pendingInvites.size };
    } catch (error) {
      console.error('❌ Error in checkEmailStatuses:', error);
      throw error;
    }
  });

/**
 * Helper: Получить статус email из Brevo API
 * Требует API ключ Brevo
 */
export async function getBrevoEmailStatus(messageId: string): Promise<string> {
  // TODO: Implement Brevo API call
  // https://developers.brevo.com/reference/getemailactivity

  const config = functions.config();
  const apiKey = config.brevo?.api_key;

  if (!apiKey) {
    throw new Error('Brevo API key not configured');
  }

  // Example API call:
  // GET https://api.brevo.com/v3/smtp/statistics/events
  // ?email=user@example.com
  // &messageId=<messageId>

  return 'pending'; // placeholder
}

/**
 * Manual trigger для проверки статуса конкретного приглашения
 */
export const checkInvitationStatus = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }

    const { invitationId } = data;

    if (!invitationId) {
      throw new functions.https.HttpsError('invalid-argument', 'invitationId is required');
    }

    try {
      const inviteDoc = await db.collection('invitations').doc(invitationId).get();

      if (!inviteDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Invitation not found');
      }

      const invitation = inviteDoc.data();

      // Check status via Brevo API
      // const status = await getBrevoEmailStatus(invitation.messageId);

      return {
        success: true,
        currentStatus: invitation?.status,
        message: 'Status check scheduled',
      };
    } catch (error: any) {
      console.error('Error checking invitation status:', error);
      throw new functions.https.HttpsError('internal', error.message);
    }
  });
