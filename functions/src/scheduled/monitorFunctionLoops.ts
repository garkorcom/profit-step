/**
 * monitorFunctionLoops - Мониторинг бесконечных циклов
 *
 * Scheduled: Каждые 5 минут
 * Проверяет: Количество вызовов функций за последние 5 минут
 * Алертинг: Если больше 1000 вызовов - отправляет alert
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { COLLECTIONS, ALERT_THRESHOLDS } from '../utils/constants';

export const monitorFunctionLoops = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .pubsub.schedule('*/5 * * * *') // Каждые 5 минут
  .timeZone('UTC')
  .onRun(async (context) => {
    const db = admin.firestore();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    try {
      const metrics = await db
        .collection(COLLECTIONS.PROCESSED_EVENTS)
        .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(fiveMinutesAgo))
        .get();

      const functionsCount: Record<string, number> = {};

      metrics.docs.forEach((doc) => {
        const functionName = doc.data().functionName;
        functionsCount[functionName] = (functionsCount[functionName] || 0) + 1;
      });

      console.log('=== Function Invocations (Last 5 minutes) ===');
      console.log(JSON.stringify(functionsCount, null, 2));

      // Проверяем на превышение порога
      const alerts: string[] = [];

      Object.entries(functionsCount).forEach(([functionName, count]) => {
        if (count > ALERT_THRESHOLDS.INVOCATIONS_PER_5_MIN) {
          const alert = `🚨 ALERT: ${functionName} called ${count} times in 5 minutes (threshold: ${ALERT_THRESHOLDS.INVOCATIONS_PER_5_MIN})`;
          console.error(alert);
          alerts.push(alert);
        }
      });

      // Записываем алерты в отдельную коллекцию
      if (alerts.length > 0) {
        await db.collection('functionAlerts').add({
          alerts,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          functionsCount,
        });

        // TODO: Отправить email/Slack уведомление
        console.error(`🚨 ${alerts.length} alerts detected! Check functionAlerts collection.`);
      } else {
        console.log('✅ All functions within normal limits');
      }

      return null;
    } catch (error) {
      console.error('❌ Error in monitorFunctionLoops:', error);
      return null;
    }
  });
