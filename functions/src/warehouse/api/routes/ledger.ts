/**
 * Ledger read routes.
 *
 * Endpoints:
 *   GET /api/warehouse/ledger?itemId=X&from=..&to=..
 *   GET /api/warehouse/ledger?projectId=P&phaseCode=rough_in
 *   GET /api/warehouse/ledger?documentId=doc_...
 *   GET /api/warehouse/ledger/cost-summary?projectId=P&groupBy=phaseCode
 */

import { Router } from 'express';
import * as admin from 'firebase-admin';
import { db } from '../../../agent/routeContext';
import { WH_COLLECTIONS } from '../../database/collections';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.get(
  '/api/warehouse/ledger/cost-summary',
  wrapRoute(async (req, res) => {
    const { projectId, phaseCode, groupBy } = req.query;
    if (typeof projectId !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'projectId required' } });
      return;
    }
    let q: FirebaseFirestore.Query = db
      .collection(WH_COLLECTIONS.ledger)
      .where('projectId', '==', projectId);
    if (typeof phaseCode === 'string') q = q.where('phaseCode', '==', phaseCode);

    const snap = await q.limit(5000).get();
    const buckets = new Map<string, { totalCost: number; entryCount: number }>();
    let totalCost = 0;

    for (const d of snap.docs) {
      const data = d.data() as any;
      const entryCost = (data.deltaQty ?? 0) * -1 * (data.unitCostAtPosting ?? 0);
      // signed cost: negative deltaQty (out) = positive expense
      const key = typeof groupBy === 'string' ? (data[groupBy] ?? null) : '_all';
      const existing = buckets.get(String(key)) ?? { totalCost: 0, entryCount: 0 };
      existing.totalCost += entryCost;
      existing.entryCount += 1;
      buckets.set(String(key), existing);
      totalCost += entryCost;
    }

    res.status(200).json({
      projectId,
      groupBy: typeof groupBy === 'string' ? groupBy : null,
      buckets: Array.from(buckets.entries()).map(([k, v]) => ({
        [typeof groupBy === 'string' ? groupBy : 'bucket']: k === 'null' ? null : k,
        totalCost: Math.round(v.totalCost * 100) / 100,
        entryCount: v.entryCount,
      })),
      totalCost: Math.round(totalCost * 100) / 100,
    });
  }),
);

router.get(
  '/api/warehouse/ledger',
  wrapRoute(async (req, res) => {
    const { itemId, locationId, projectId, phaseCode, documentId, from, to } = req.query;

    if (!itemId && !locationId && !projectId && !documentId) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Pass at least one filter: itemId / locationId / projectId / documentId',
        },
      });
      return;
    }

    let q: FirebaseFirestore.Query = db.collection(WH_COLLECTIONS.ledger);
    if (typeof itemId === 'string') q = q.where('itemId', '==', itemId);
    if (typeof locationId === 'string') q = q.where('locationId', '==', locationId);
    if (typeof projectId === 'string') q = q.where('projectId', '==', projectId);
    if (typeof phaseCode === 'string') q = q.where('phaseCode', '==', phaseCode);
    if (typeof documentId === 'string') q = q.where('documentId', '==', documentId);

    if (typeof from === 'string') {
      q = q.where('eventDate', '>=', admin.firestore.Timestamp.fromDate(new Date(from)));
    }
    if (typeof to === 'string') {
      q = q.where('eventDate', '<=', admin.firestore.Timestamp.fromDate(new Date(to)));
    }

    const snap = await q.orderBy('eventDate', 'desc').limit(500).get();
    res.status(200).json({
      entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      total: snap.size,
    });
  }),
);

export default router;
