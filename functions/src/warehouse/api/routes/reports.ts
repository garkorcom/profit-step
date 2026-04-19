/**
 * Warehouse reports routes.
 *
 * Endpoints:
 *   GET /api/warehouse/reports/low-stock     UC6 on-demand reorder suggestion
 *   GET /api/warehouse/reports/dead-stock    UC8 on-demand dead stock scan
 *
 * Thin wrappers over pure functions in `crons/` so UI and cron share logic.
 * No caching yet — catalog size is bounded and each report is a single pass.
 */

import { Router } from 'express';
import { db } from '../../../agent/routeContext';
import { WH_COLLECTIONS } from '../../database/collections';
import { loadCatalogFull, loadBalancesForItems, loadVendorsFull } from '../loaders';
import { buildLowStockReorder, findDeadStock } from '../../crons';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.get(
  '/api/warehouse/reports/low-stock',
  wrapRoute(async (_req, res) => {
    const [items, vendors] = await Promise.all([
      loadCatalogFull(db),
      loadVendorsFull(db),
    ]);
    const balances = await loadBalancesForItems(db, items.map((i) => i.id));
    const report = buildLowStockReorder({ items, balances, vendors });
    res.status(200).json(report);
  }),
);

router.get(
  '/api/warehouse/reports/dead-stock',
  wrapRoute(async (req, res) => {
    const thresholdDays = Math.max(1, Math.min(365, Number(req.query.thresholdDays ?? 90)));
    const items = await loadCatalogFull(db);
    const balances = await loadBalancesForItems(db, items.map((i) => i.id));

    // Build per-item last ledger activity map from a bounded ledger scan.
    const lastLedgerActivityMs = new Map<string, number>();
    const snap = await db
      .collection(WH_COLLECTIONS.ledger)
      .orderBy('eventDate', 'desc')
      .limit(10000)
      .get();
    for (const d of snap.docs) {
      const data = d.data() as { itemId?: string; eventDate?: FirebaseFirestore.Timestamp };
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
      inactivityDays: thresholdDays,
    });
    res.status(200).json(report);
  }),
);

export default router;
