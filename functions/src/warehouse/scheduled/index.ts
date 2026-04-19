/**
 * Warehouse scheduled Cloud Functions.
 *
 * Wraps the pure functions in `warehouse/crons/` with Firebase pubsub
 * schedulers. The pure functions stay test-friendly (synchronous, deterministic)
 * while the wrappers handle data loading, persistence, and logging.
 *
 * All three jobs persist their output to Firestore collections the UI can
 * read on-demand:
 *   - wh_reorder_reports          — UC6 weekly snapshot
 *   - wh_dead_stock_reports       — UC8 monthly snapshot
 *   - wh_anomaly_reports          — UC5 daily digest
 *
 * Timezone: America/New_York (the business runs on Florida time).
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { buildLowStockReorder, findDeadStock } from '../crons';
import { loadCatalogFull, loadBalancesForItems, loadVendorsFull } from '../api/loaders';
import { WH_COLLECTIONS } from '../database/collections';

const TIME_ZONE = 'America/New_York';

function getDb(): admin.firestore.Firestore {
  return admin.firestore();
}

/**
 * UC6 — Low stock reorder snapshot. Runs every Friday at 09:00 Florida time.
 * Output stored to `wh_reorder_reports/{date}` so UI can show the latest
 * cached report without re-scanning.
 */
export const warehouseLowStockSnapshot = functions.pubsub
  .schedule('0 9 * * 5')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const db = getDb();
    const [items, vendors] = await Promise.all([loadCatalogFull(db), loadVendorsFull(db)]);
    const balances = await loadBalancesForItems(db, items.map((i) => i.id));
    const report = buildLowStockReorder({ items, balances, vendors });

    const reportId = new Date().toISOString().slice(0, 10);
    await db
      .collection('wh_reorder_reports')
      .doc(reportId)
      .set({
        id: reportId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...report,
      });

    console.log('🏭 warehouse:low_stock.snapshot', {
      reportId,
      lineCount: report.lines.length,
      grandTotalEstimated: report.grandTotalEstimated,
    });
  });

/**
 * UC8 — Dead stock snapshot. Runs the 1st of every month at 08:00 Florida time.
 * Scans up to 20K recent ledger entries to build last-activity map.
 */
export const warehouseDeadStockSnapshot = functions.pubsub
  .schedule('0 8 1 * *')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const db = getDb();
    const items = await loadCatalogFull(db);
    const balances = await loadBalancesForItems(db, items.map((i) => i.id));

    const lastLedgerActivityMs = new Map<string, number>();
    const snap = await db
      .collection(WH_COLLECTIONS.ledger)
      .orderBy('eventDate', 'desc')
      .limit(20000)
      .get();
    for (const d of snap.docs) {
      const data = d.data() as { itemId?: string; eventDate?: admin.firestore.Timestamp };
      if (!data.itemId || !data.eventDate) continue;
      const ms = data.eventDate.toMillis();
      const prev = lastLedgerActivityMs.get(data.itemId);
      if (prev === undefined || ms > prev) {
        lastLedgerActivityMs.set(data.itemId, ms);
      }
    }

    const report = findDeadStock({
      items,
      balances,
      lastLedgerActivityMs,
      nowMs: Date.now(),
      inactivityDays: 90,
    });

    const reportId = new Date().toISOString().slice(0, 10);
    await db
      .collection('wh_dead_stock_reports')
      .doc(reportId)
      .set({
        id: reportId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...report,
      });

    console.log('🏭 warehouse:dead_stock.snapshot', {
      reportId,
      totalItems: report.totalItems,
      totalValue: report.totalValue,
    });
  });

// UC5 Anomaly scan: deferred. detectAnomaliesBatch needs per-issue context
// (task, norm, averageCostByItemId) that requires joining the tasks collection
// and per-line ledger entries — a proper loader deserves its own PR.
// Tracked in BACKLOG.
