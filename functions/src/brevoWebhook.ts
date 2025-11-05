/**
 * Brevo Webhook Handler
 * Обрабатывает события от Brevo (email delivery, opens, bounces, etc.)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Webhook handler для событий от Brevo
 * URL: https://us-central1-profit-step.cloudfunctions.net/brevoWebhookHandler
 */
export const brevoWebhookHandler = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    try {
      // Обработка GET запроса (для проверки Brevo при настройке webhook)
      if (req.method === 'GET') {
        res.status(200).json({
          status: 'ok',
          message: 'Brevo webhook endpoint is ready',
          service: 'Profit Step',
        });
        return;
      }

      // Проверяем метод запроса
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      console.log('📨 Received Brevo webhook:', JSON.stringify(req.body, null, 2));

      const event = req.body;

      // Извлекаем данные события
      const {
        event: eventType,
        email,
        'message-id': messageId,
        reason,
        subject,
        tag,
      } = event;

      if (!eventType || !email) {
        console.error('❌ Missing required fields in webhook payload');
        res.status(400).send('Bad Request: Missing event or email');
        return;
      }

      // 1. Записываем событие в emailEvents для аналитики
      await db.collection('emailEvents').add({
        email,
        eventType,
        messageId: messageId || null,
        reason: reason || null,
        subject: subject || null,
        tag: tag || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        rawData: event,
      });

      console.log(`✅ Email event logged: ${eventType} for ${email}`);

      // 2. Обновляем статус приглашения, если это invitation email
      if (tag && tag.includes('invitation')) {
        await updateInvitationStatus(email, eventType, reason);
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('❌ Error processing Brevo webhook:', error);
      res.status(500).send('Internal Server Error');
    }
  });

/**
 * Обновляет статус приглашения на основе email события
 */
async function updateInvitationStatus(
  email: string,
  eventType: string,
  reason?: string
): Promise<void> {
  try {
    // Находим приглашение по email
    const invitationsSnapshot = await db
      .collection('invitations')
      .where('email', '==', email)
      .orderBy('sentAt', 'desc')
      .limit(1)
      .get();

    if (invitationsSnapshot.empty) {
      console.log(`⚠️ No invitation found for email: ${email}`);
      return;
    }

    const invitationDoc = invitationsSnapshot.docs[0];
    const invitationData = invitationDoc.data();

    // Не обновляем если приглашение уже принято
    if (invitationData.status === 'accepted') {
      console.log(`ℹ️ Invitation already accepted, skipping update`);
      return;
    }

    const updates: any = {
      deliveryStatus: eventType,
      lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Обновляем статус в зависимости от типа события
    switch (eventType) {
      case 'delivered':
        updates.status = 'delivered';
        console.log(`📬 Invitation delivered to ${email}`);
        break;

      case 'opened':
      case 'click':
        updates.status = 'opened';
        updates.openedAt = admin.firestore.FieldValue.serverTimestamp();
        console.log(`👀 Invitation opened by ${email}`);
        break;

      case 'soft_bounce':
      case 'hard_bounce':
      case 'blocked':
        updates.status = 'failed';
        updates.failureReason = reason || eventType;
        console.log(`❌ Invitation failed for ${email}: ${reason || eventType}`);

        // Отправляем уведомление администратору
        await notifyAdminAboutFailedInvite(invitationData, reason || eventType);
        break;

      case 'spam':
      case 'complaint':
        updates.status = 'failed';
        updates.failureReason = 'spam';
        console.log(`🚫 Invitation marked as spam by ${email}`);

        // Отправляем уведомление администратору
        await notifyAdminAboutFailedInvite(invitationData, 'spam');
        break;

      case 'unsubscribed':
        console.log(`🔕 User unsubscribed: ${email}`);
        // Можно добавить в blacklist
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${eventType}`);
    }

    // Обновляем приглашение
    await invitationDoc.ref.update(updates);

    console.log(`✅ Invitation status updated for ${email}`);
  } catch (error) {
    console.error(`❌ Error updating invitation status:`, error);
    throw error;
  }
}

/**
 * Отправляет уведомление администратору о проблеме с доставкой
 */
async function notifyAdminAboutFailedInvite(
  invitationData: any,
  reason: string
): Promise<void> {
  try {
    const companyId = invitationData.companyId;
    const invitedBy = invitationData.invitedBy;

    // Создаем уведомление в Firestore
    await db.collection('notifications').add({
      userId: invitedBy,
      companyId,
      type: 'invitation_failed',
      title: 'Не удалось отправить приглашение',
      message: `Приглашение для ${invitationData.email} не было доставлено. Причина: ${reason}`,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        invitationId: invitationData.inviteId,
        email: invitationData.email,
        reason,
      },
    });

    console.log(`🔔 Admin notified about failed invite: ${invitationData.email}`);
  } catch (error) {
    console.error('❌ Error notifying admin:', error);
  }
}

/**
 * Тестовый endpoint для симуляции webhook событий (только для разработки)
 */
export const testBrevoWebhook = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    // Проверка аутентификации
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }

    const { email, eventType } = data;

    if (!email || !eventType) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'email and eventType are required'
      );
    }

    // Симулируем webhook событие
    const mockEvent = {
      event: eventType,
      email,
      'message-id': `test-${Date.now()}`,
      subject: 'Test Invitation',
      tag: 'invitation',
      date: new Date().toISOString(),
    };

    console.log('🧪 Test webhook event:', mockEvent);

    // Записываем событие
    await db.collection('emailEvents').add({
      email,
      eventType,
      messageId: mockEvent['message-id'],
      subject: mockEvent.subject,
      tag: mockEvent.tag,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      rawData: mockEvent,
      isTest: true,
    });

    // Обновляем статус приглашения
    await updateInvitationStatus(email, eventType);

    return {
      success: true,
      message: `Test ${eventType} event processed for ${email}`,
    };
  });
