/**
 * Location routes.
 */

import { Router } from 'express';
import { db, FieldValue, logAgentActivity } from '../../../agent/routeContext';
import { CreateWhLocationSchema, UpdateWhLocationSchema } from '../../database/schemas';
import { WH_COLLECTIONS } from '../../database/collections';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.post(
  '/api/warehouse/locations',
  wrapRoute(async (req, res) => {
    const data = CreateWhLocationSchema.parse(req.body);
    const ref = db.collection(WH_COLLECTIONS.locations).doc();
    await ref.set({
      id: ref.id,
      schemaVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: req.agentUserId ?? 'api',
      createdByType: 'human',
      isActive: true,
      ...data,
    });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_location_created',
      endpoint: '/api/warehouse/locations',
      metadata: { locationId: ref.id, locationType: data.locationType },
    });
    res.status(201).json({ locationId: ref.id, locationType: data.locationType });
  }),
);

router.get(
  '/api/warehouse/locations',
  wrapRoute(async (req, res) => {
    const { type, ownerEmployeeId } = req.query;
    let q: FirebaseFirestore.Query = db.collection(WH_COLLECTIONS.locations).where('isActive', '==', true);
    if (typeof type === 'string') q = q.where('locationType', '==', type);
    if (typeof ownerEmployeeId === 'string') q = q.where('ownerEmployeeId', '==', ownerEmployeeId);
    const snap = await q.limit(200).get();
    res.status(200).json({
      locations: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      total: snap.size,
    });
  }),
);

router.get(
  '/api/warehouse/locations/:id',
  wrapRoute(async (req, res) => {
    const snap = await db.collection(WH_COLLECTIONS.locations).doc(req.params.id).get();
    if (!snap.exists) {
      res.status(404).json({ error: { code: 'LOCATION_NOT_FOUND', message: `Location ${req.params.id} not found` } });
      return;
    }
    res.status(200).json({ location: { id: snap.id, ...snap.data() } });
  }),
);

router.patch(
  '/api/warehouse/locations/:id',
  wrapRoute(async (req, res) => {
    const updates = UpdateWhLocationSchema.parse(req.body);
    const ref = db.collection(WH_COLLECTIONS.locations).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: { code: 'LOCATION_NOT_FOUND', message: `Location ${req.params.id} not found` } });
      return;
    }
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
    res.status(200).json({ locationId: req.params.id, updated: Object.keys(updates) });
  }),
);

export default router;
