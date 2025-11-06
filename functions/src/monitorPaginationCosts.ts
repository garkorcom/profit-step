/**
 * Monitoring Cloud Function: Pagination Costs Tracker
 *
 * Назначение:
 * - Отслеживает использование пагинации TeamAdminPage
 * - Рассчитывает текущие и проектируемые расходы
 * - Создает алерты при превышении бюджета
 * - Предотвращает финансовые риски
 *
 * Триггер: Scheduled (каждые 15 минут)
 * Budget Limit: $10/day
 * Alert Thresholds: $5/day (warning), $8/day (critical)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Интерфейс для метрик пагинации
 */
interface PaginationMetrics {
  timestamp: admin.firestore.Timestamp;
  firestoreReads: number;
  cost: number;
  source: 'TeamAdminPage' | 'API';
  userId?: string;
  companyId?: string;
}

/**
 * Интерфейс для алерта превышения бюджета
 */
interface CostAlert {
  timestamp: admin.firestore.Timestamp;
  severity: 'warning' | 'critical' | 'emergency';
  projectedDailyCost: number;
  currentCost: number;
  budgetLimit: number;
  message: string;
  metricsWindow: string;
}

/**
 * Scheduled Function: Мониторинг расходов на пагинацию
 * Запускается каждые 15 минут
 */
export const monitorPaginationCosts = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(async (context) => {
    const startTime = Date.now();

    try {
      console.log('🔍 Starting pagination costs monitoring...');

      // ============================================
      // 1️⃣ Get metrics for last 15 minutes
      // ============================================
      const fifteenMinutesAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 15 * 60 * 1000);

      const metricsSnapshot = await db
        .collection('paginationMetrics')
        .where('timestamp', '>=', fifteenMinutesAgo)
        .get();

      console.log(`📊 Found ${metricsSnapshot.size} pagination requests in last 15 minutes`);

      if (metricsSnapshot.empty) {
        console.log('✅ No pagination activity detected. System idle.');
        return null;
      }

      // ============================================
      // 2️⃣ Calculate total reads and costs
      // ============================================
      let totalReads = 0;
      let totalCost = 0;
      const uniqueUsers = new Set<string>();

      metricsSnapshot.forEach((doc) => {
        const data = doc.data() as PaginationMetrics;
        totalReads += data.firestoreReads || 0;
        totalCost += data.cost || 0;
        if (data.userId) {
          uniqueUsers.add(data.userId);
        }
      });

      console.log(`📈 Metrics Summary (15 min):`);
      console.log(`   - Total Reads: ${totalReads}`);
      console.log(`   - Total Cost: $${totalCost.toFixed(4)}`);
      console.log(`   - Unique Users: ${uniqueUsers.size}`);
      console.log(`   - Avg Reads/Request: ${(totalReads / metricsSnapshot.size).toFixed(1)}`);

      // ============================================
      // 3️⃣ Project daily costs
      // ============================================
      const costPer15Min = totalCost;
      const projectedDailyCost = costPer15Min * 96; // 96 intervals per day (24 hrs * 4)

      console.log(`💰 Cost Projections:`);
      console.log(`   - Current (15 min): $${costPer15Min.toFixed(4)}`);
      console.log(`   - Projected (24 hrs): $${projectedDailyCost.toFixed(2)}`);
      console.log(`   - Budget Limit: $10.00/day`);

      // ============================================
      // 4️⃣ Check budget thresholds and create alerts
      // ============================================
      const BUDGET_LIMIT = 10.0; // $10/day
      const WARNING_THRESHOLD = 5.0; // $5/day (50%)
      const CRITICAL_THRESHOLD = 8.0; // $8/day (80%)

      if (projectedDailyCost >= CRITICAL_THRESHOLD) {
        // 🚨 CRITICAL: Approaching budget limit
        const alert: CostAlert = {
          timestamp: admin.firestore.Timestamp.now(),
          severity: 'critical',
          projectedDailyCost,
          currentCost: costPer15Min,
          budgetLimit: BUDGET_LIMIT,
          message: `🚨 CRITICAL: Projected daily cost ($${projectedDailyCost.toFixed(2)}) approaching budget limit ($${BUDGET_LIMIT})!`,
          metricsWindow: '15 minutes',
        };

        await db.collection('costAlerts').add(alert);

        console.error('🚨 CRITICAL ALERT CREATED!');
        console.error(`   Projected Daily Cost: $${projectedDailyCost.toFixed(2)}`);
        console.error(`   Budget Limit: $${BUDGET_LIMIT}`);
        console.error(`   Usage: ${((projectedDailyCost / BUDGET_LIMIT) * 100).toFixed(1)}%`);
      } else if (projectedDailyCost >= WARNING_THRESHOLD) {
        // ⚠️ WARNING: Higher than expected usage
        const alert: CostAlert = {
          timestamp: admin.firestore.Timestamp.now(),
          severity: 'warning',
          projectedDailyCost,
          currentCost: costPer15Min,
          budgetLimit: BUDGET_LIMIT,
          message: `⚠️ WARNING: Projected daily cost ($${projectedDailyCost.toFixed(2)}) exceeding normal levels.`,
          metricsWindow: '15 minutes',
        };

        await db.collection('costAlerts').add(alert);

        console.warn('⚠️ WARNING ALERT CREATED!');
        console.warn(`   Projected Daily Cost: $${projectedDailyCost.toFixed(2)}`);
        console.warn(`   Budget Limit: $${BUDGET_LIMIT}`);
        console.warn(`   Usage: ${((projectedDailyCost / BUDGET_LIMIT) * 100).toFixed(1)}%`);
      } else {
        // ✅ Normal operation
        console.log('✅ Cost levels normal. Within budget.');
        console.log(`   Usage: ${((projectedDailyCost / BUDGET_LIMIT) * 100).toFixed(1)}% of budget`);
      }

      // ============================================
      // 5️⃣ Store aggregated metrics for dashboard
      // ============================================
      await db.collection('paginationMetricsAggregated').add({
        timestamp: admin.firestore.Timestamp.now(),
        window: '15min',
        totalReads,
        totalCost,
        projectedDailyCost,
        uniqueUsers: uniqueUsers.size,
        requestCount: metricsSnapshot.size,
        avgReadsPerRequest: totalReads / metricsSnapshot.size,
      });

      // ============================================
      // 6️⃣ Cleanup old metrics (keep last 24 hours only)
      // ============================================
      const oneDayAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
      const oldMetricsSnapshot = await db
        .collection('paginationMetrics')
        .where('timestamp', '<', oneDayAgo)
        .limit(500)
        .get();

      if (!oldMetricsSnapshot.empty) {
        const batch = db.batch();
        oldMetricsSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        console.log(`🧹 Cleaned up ${oldMetricsSnapshot.size} old metrics records`);
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Monitoring completed in ${duration}ms`);

      return {
        success: true,
        totalReads,
        totalCost,
        projectedDailyCost,
        duration,
      };
    } catch (error) {
      console.error('❌ Error in monitorPaginationCosts:', error);

      // Log error to functionErrors collection for debugging
      await db.collection('functionErrors').add({
        functionName: 'monitorPaginationCosts',
        error: error instanceof Error ? error.message : String(error),
        timestamp: admin.firestore.Timestamp.now(),
        severity: 'error',
      });

      throw error;
    }
  });

/**
 * Helper Function: Log pagination metrics from client
 * Called by client-side code to track pagination usage
 *
 * Usage:
 * ```typescript
 * const logPaginationMetrics = httpsCallable(functions, 'logPaginationMetrics');
 * await logPaginationMetrics({
 *   firestoreReads: 26,
 *   cost: 0.0000156,
 *   source: 'TeamAdminPage'
 * });
 * ```
 */
export const logPaginationMetrics = functions.https.onCall(async (data, context) => {
  // Require authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { firestoreReads, cost, source } = data;

    if (typeof firestoreReads !== 'number' || typeof cost !== 'number') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'firestoreReads and cost must be numbers'
      );
    }

    // Store metrics
    await db.collection('paginationMetrics').add({
      timestamp: admin.firestore.Timestamp.now(),
      firestoreReads,
      cost,
      source: source || 'unknown',
      userId: context.auth.uid,
      companyId: data.companyId || null,
    } as PaginationMetrics);

    console.log(`📊 Logged pagination metrics: ${firestoreReads} reads, $${cost.toFixed(6)}`);

    return {
      success: true,
      message: 'Metrics logged successfully',
    };
  } catch (error) {
    console.error('Error logging pagination metrics:', error);
    throw new functions.https.HttpsError('internal', 'Failed to log metrics');
  }
});
