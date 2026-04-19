/**
 * Warehouse audit log read route.
 *
 * Thin wrapper over the existing `agent_activity` collection filtered to
 * warehouse_* actions. Used by the Management UI to show history per
 * entity (item / location / document) or globally over a time window.
 */

import { Router } from 'express';
import { db } from '../../../agent/routeContext';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.get(
  '/api/warehouse/audit-log',
  wrapRoute(async (req, res) => {
    const { action, userId, entityId, from, to, limit: limitStr } = req.query;
    const lim = Math.min(Number(limitStr ?? 100), 500);

    let q: FirebaseFirestore.Query = db.collection('agent_activity');

    if (typeof action === 'string') {
      q = q.where('action', '==', action);
    } else {
      // Default: only warehouse_* actions. Firestore can't do prefix matches,
      // so we use a > range filter with \uf8ff sentinel.
      q = q.where('action', '>=', 'warehouse_').where('action', '<=', 'warehouse_\uf8ff');
    }

    if (typeof userId === 'string') q = q.where('userId', '==', userId);

    if (typeof from === 'string') {
      q = q.where('createdAt', '>=', new Date(from));
    }
    if (typeof to === 'string') {
      q = q.where('createdAt', '<=', new Date(to));
    }

    const snap = await q.orderBy('createdAt', 'desc').limit(lim).get();
    let entries = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
      id: string;
      metadata?: Record<string, unknown>;
    }>;

    // Post-filter by entityId since metadata is unstructured.
    if (typeof entityId === 'string') {
      entries = entries.filter((e) => {
        const m = e.metadata ?? {};
        return (
          m.itemId === entityId ||
          m.locationId === entityId ||
          m.documentId === entityId ||
          m.normId === entityId ||
          m.vendorId === entityId
        );
      });
    }

    res.status(200).json({ entries, total: entries.length });
  }),
);

export default router;
