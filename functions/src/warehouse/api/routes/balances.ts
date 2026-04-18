/**
 * Balance routes — read-only projection of ledger state.
 *
 * Endpoints:
 *   GET /api/warehouse/balances?locationId=X          balances at a location
 *   GET /api/warehouse/balances?itemId=Y              balances for an item (all locs)
 *   GET /api/warehouse/balances/available?locationId&itemId  single cell
 */

import { Router } from 'express';
import { db } from '../../../agent/routeContext';
import { WH_COLLECTIONS } from '../../database/collections';
import { makeBalanceKey } from '../../core/types';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.get(
  '/api/warehouse/balances/available',
  wrapRoute(async (req, res) => {
    const { locationId, itemId } = req.query;
    if (typeof locationId !== 'string' || typeof itemId !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'locationId and itemId required' } });
      return;
    }
    const key = makeBalanceKey(locationId, itemId);
    const snap = await db.collection(WH_COLLECTIONS.balances).doc(key).get();
    if (!snap.exists) {
      res.status(200).json({ locationId, itemId, onHandQty: 0, reservedQty: 0, availableQty: 0 });
      return;
    }
    res.status(200).json(snap.data());
  }),
);

router.get(
  '/api/warehouse/balances',
  wrapRoute(async (req, res) => {
    const { locationId, itemId, minAvailableQty } = req.query;

    if (!locationId && !itemId) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Pass locationId or itemId',
        },
      });
      return;
    }

    let q: FirebaseFirestore.Query = db.collection(WH_COLLECTIONS.balances);
    if (typeof locationId === 'string') q = q.where('locationId', '==', locationId);
    if (typeof itemId === 'string') q = q.where('itemId', '==', itemId);

    const snap = await q.limit(500).get();
    const balances = snap.docs.map((d) => d.data());
    const filtered = typeof minAvailableQty === 'string'
      ? balances.filter((b: any) => (b.availableQty ?? 0) >= Number(minAvailableQty))
      : balances;

    if (typeof itemId === 'string' && !locationId) {
      // aggregated view across locations
      const totalOnHand = filtered.reduce((a, b: any) => a + (b.onHandQty ?? 0), 0);
      const totalReserved = filtered.reduce((a, b: any) => a + (b.reservedQty ?? 0), 0);
      const totalAvailable = totalOnHand - totalReserved;
      res.status(200).json({
        itemId,
        totalOnHand,
        totalReserved,
        totalAvailable,
        perLocation: filtered,
      });
      return;
    }

    res.status(200).json({
      locationId,
      balances: filtered,
      total: filtered.length,
    });
  }),
);

export default router;
