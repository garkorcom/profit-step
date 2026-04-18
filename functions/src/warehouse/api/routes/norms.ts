/**
 * Norm routes.
 */

import { Router } from 'express';
import { db, FieldValue, logAgentActivity } from '../../../agent/routeContext';
import { CreateWhNormSchema, UpdateWhNormSchema } from '../../database/schemas';
import { WH_COLLECTIONS } from '../../database/collections';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.post(
  '/api/warehouse/norms',
  wrapRoute(async (req, res) => {
    const data = CreateWhNormSchema.parse(req.body);
    const ref = db.collection(WH_COLLECTIONS.norms).doc(`norm_${data.taskType}`);
    const existing = await ref.get();
    if (existing.exists) {
      res.status(409).json({
        error: { code: 'VALIDATION_ERROR', message: `Norm for taskType ${data.taskType} already exists` },
      });
      return;
    }
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
      action: 'warehouse_norm_created',
      endpoint: '/api/warehouse/norms',
      metadata: { normId: ref.id, taskType: data.taskType },
    });
    res.status(201).json({ normId: ref.id, taskType: data.taskType });
  }),
);

router.get(
  '/api/warehouse/norms',
  wrapRoute(async (req, res) => {
    const { taskType } = req.query;
    let q: FirebaseFirestore.Query = db.collection(WH_COLLECTIONS.norms).where('isActive', '==', true);
    if (typeof taskType === 'string') q = q.where('taskType', '==', taskType);
    const snap = await q.limit(200).get();
    res.status(200).json({
      norms: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      total: snap.size,
    });
  }),
);

router.get(
  '/api/warehouse/norms/:id',
  wrapRoute(async (req, res) => {
    const snap = await db.collection(WH_COLLECTIONS.norms).doc(req.params.id).get();
    if (!snap.exists) {
      res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: `Norm ${req.params.id} not found` } });
      return;
    }
    res.status(200).json({ norm: { id: snap.id, ...snap.data() } });
  }),
);

router.patch(
  '/api/warehouse/norms/:id',
  wrapRoute(async (req, res) => {
    const updates = UpdateWhNormSchema.parse(req.body);
    const ref = db.collection(WH_COLLECTIONS.norms).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: `Norm ${req.params.id} not found` } });
      return;
    }
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
    res.status(200).json({ normId: req.params.id, updated: Object.keys(updates) });
  }),
);

router.delete(
  '/api/warehouse/norms/:id',
  wrapRoute(async (req, res) => {
    const ref = db.collection(WH_COLLECTIONS.norms).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: `Norm ${req.params.id} not found` } });
      return;
    }
    await ref.update({
      isActive: false,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: req.agentUserId ?? 'api',
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(200).json({ normId: req.params.id, archived: true });
  }),
);

export default router;
