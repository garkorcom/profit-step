/**
 * Scheduled Cloud Functions для агрегации метрик дашбордов
 * Запускаются по расписанию для подсчета Growth и Engagement метрик
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Агрегация метрик роста (Growth Metrics)
 * Запускается ежедневно в 2:00 AM
 * Подсчитывает новых пользователей и компании за предыдущий день
 */
export const aggregateGrowthMetrics = functions
  .region('us-central1')
  .pubsub.schedule('0 2 * * *')
  .timeZone('America/New_York')
  .onRun(async (context) => {
    try {
      console.log('🔄 Starting growth metrics aggregation...');

      // Вчерашняя дата (00:00:00 - 23:59:59)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const startOfDay = admin.firestore.Timestamp.fromDate(yesterday);

      const endOfDay = new Date(yesterday);
      endOfDay.setHours(23, 59, 59, 999);
      const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);

      // Подсчитываем новых пользователей
      const newUsersSnapshot = await db
        .collection('users')
        .where('createdAt', '>=', startOfDay)
        .where('createdAt', '<=', endTimestamp)
        .count()
        .get();

      const newUsers = newUsersSnapshot.data().count;

      // Подсчитываем новые компании
      const newCompaniesSnapshot = await db
        .collection('companies')
        .where('createdAt', '>=', startOfDay)
        .where('createdAt', '<=', endTimestamp)
        .count()
        .get();

      const newCompanies = newCompaniesSnapshot.data().count;

      // Подсчитываем общее количество пользователей и компаний
      const totalUsersSnapshot = await db.collection('users').count().get();
      const totalUsers = totalUsersSnapshot.data().count;

      const totalCompaniesSnapshot = await db.collection('companies').count().get();
      const totalCompanies = totalCompaniesSnapshot.data().count;

      // Сохраняем метрики
      const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

      await db.collection('growthMetrics').doc(dateStr).set({
        date: dateStr,
        newUsers,
        newCompanies,
        totalUsers,
        totalCompanies,
        calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`✅ Growth metrics saved for ${dateStr}:`, {
        newUsers,
        newCompanies,
        totalUsers,
        totalCompanies,
      });

      return { success: true, date: dateStr };
    } catch (error) {
      console.error('❌ Error aggregating growth metrics:', error);
      throw error;
    }
  });

/**
 * Агрегация метрик вовлеченности (Engagement Metrics)
 * Запускается ежедневно в 3:00 AM
 * Подсчитывает DAU, WAU, MAU и stickiness
 */
export const aggregateEngagementMetrics = functions
  .region('us-central1')
  .pubsub.schedule('0 3 * * *')
  .timeZone('America/New_York')
  .onRun(async (context) => {
    try {
      console.log('🔄 Starting engagement metrics aggregation...');

      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      // DAU - пользователи активные за последние 24 часа
      const dayAgo = new Date(now);
      dayAgo.setHours(now.getHours() - 24);
      const dayAgoTimestamp = admin.firestore.Timestamp.fromDate(dayAgo);

      const dauSnapshot = await db
        .collection('users')
        .where('lastSeen', '>=', dayAgoTimestamp)
        .where('status', '==', 'active')
        .count()
        .get();

      const dau = dauSnapshot.data().count;

      // WAU - пользователи активные за последние 7 дней
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoTimestamp = admin.firestore.Timestamp.fromDate(weekAgo);

      const wauSnapshot = await db
        .collection('users')
        .where('lastSeen', '>=', weekAgoTimestamp)
        .where('status', '==', 'active')
        .count()
        .get();

      const wau = wauSnapshot.data().count;

      // MAU - пользователи активные за последние 30 дней
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      const monthAgoTimestamp = admin.firestore.Timestamp.fromDate(monthAgo);

      const mauSnapshot = await db
        .collection('users')
        .where('lastSeen', '>=', monthAgoTimestamp)
        .where('status', '==', 'active')
        .count()
        .get();

      const mau = mauSnapshot.data().count;

      // Stickiness = DAU / MAU
      const stickiness = mau > 0 ? dau / mau : 0;

      // Сохраняем метрики
      const dateStr = today.toISOString().split('T')[0];

      await db.collection('engagementMetrics').doc(dateStr).set({
        date: dateStr,
        dau,
        wau,
        mau,
        stickiness,
        calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`✅ Engagement metrics saved for ${dateStr}:`, {
        dau,
        wau,
        mau,
        stickiness: (stickiness * 100).toFixed(2) + '%',
      });

      return { success: true, date: dateStr, dau, wau, mau, stickiness };
    } catch (error) {
      console.error('❌ Error aggregating engagement metrics:', error);
      throw error;
    }
  });

/**
 * Инициализация user activation tracking при создании пользователя
 */
export const initializeUserActivation = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onCreate(async (snap, context) => {
    try {
      const userId = context.params.userId;
      const userData = snap.data();

      console.log(`🔄 Initializing activation tracking for user: ${userId}`);

      await db.collection('userActivation').doc(userId).set({
        userId,
        signupCompleted: userData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        signupMethod: userData.signupMethod || 'email',
      });

      console.log(`✅ Activation tracking initialized for user: ${userId}`);
    } catch (error) {
      console.error('❌ Error initializing user activation:', error);
    }
  });

/**
 * Отслеживание этапов активации пользователя
 */
export const trackUserActivation = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    try {
      const userId = context.params.userId;
      const before = change.before.data();
      const after = change.after.data();

      const activationRef = db.collection('userActivation').doc(userId);
      const updates: any = {};

      // Проверяем заполнение профиля (title и displayName)
      if ((!before.title || before.title === '') && after.title && after.title !== '') {
        console.log(`✅ User ${userId} completed profile`);
        updates.profileCompleted = admin.firestore.FieldValue.serverTimestamp();
      }

      // Проверяем загрузку аватара
      if ((!before.photoURL || before.photoURL === '') && after.photoURL && after.photoURL !== '') {
        console.log(`✅ User ${userId} uploaded avatar`);
        updates.avatarUploaded = admin.firestore.FieldValue.serverTimestamp();
      }

      // Применяем обновления если есть
      if (Object.keys(updates).length > 0) {
        await activationRef.update(updates);
      }
    } catch (error) {
      console.error('❌ Error tracking user activation:', error);
    }
  });

/**
 * Отслеживание первого отправленного приглашения
 */
export const trackFirstInvite = functions
  .region('us-central1')
  .firestore.document('invitations/{inviteId}')
  .onCreate(async (snap, context) => {
    try {
      const inviteData = snap.data();
      const invitedBy = inviteData.invitedBy;

      console.log(`🔄 Checking first invite for user: ${invitedBy}`);

      const activationRef = db.collection('userActivation').doc(invitedBy);
      const activationDoc = await activationRef.get();

      // Проверяем, это первое приглашение?
      if (activationDoc.exists && !activationDoc.data()?.firstInviteSent) {
        await activationRef.update({
          firstInviteSent: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✅ First invite tracked for user: ${invitedBy}`);
      }
    } catch (error) {
      console.error('❌ Error tracking first invite:', error);
    }
  });
