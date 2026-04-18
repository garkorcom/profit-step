/**
 * Item catalog routes.
 *
 * Endpoints:
 *   POST   /api/warehouse/items
 *   GET    /api/warehouse/items
 *   GET    /api/warehouse/items/:id
 *   PATCH  /api/warehouse/items/:id         only mutable fields
 *   DELETE /api/warehouse/items/:id         soft-delete (isActive=false)
 */

import { Router } from 'express';
import { db, FieldValue, logger, logAgentActivity } from '../../../agent/routeContext';
import { CreateWhItemSchema, UpdateWhItemSchema } from '../../database/schemas';
import { WH_COLLECTIONS } from '../../database/collections';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.post(
  '/api/warehouse/items',
  wrapRoute(async (req, res) => {
    const data = CreateWhItemSchema.parse(req.body);
    const ref = db.collection(WH_COLLECTIONS.items).doc(`item_${data.sku.toLowerCase().replace(/[^a-z0-9]/g, '_')}`);
    const existing = await ref.get();
    if (existing.exists) {
      res.status(409).json({ error: { code: 'VALIDATION_ERROR', message: `Item with SKU ${data.sku} already exists`, details: { itemId: ref.id } } });
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

    logger.info('🏭 warehouse:item.created', { itemId: ref.id, sku: data.sku });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_item_created',
      endpoint: '/api/warehouse/items',
      metadata: { itemId: ref.id, sku: data.sku },
    });

    res.status(201).json({ itemId: ref.id, sku: data.sku });
  }),
);

router.get(
  '/api/warehouse/items',
  wrapRoute(async (req, res) => {
    const { category, active, search, limit: limitStr } = req.query;
    let q: FirebaseFirestore.Query = db.collection(WH_COLLECTIONS.items);
    if (typeof category === 'string') q = q.where('category', '==', category);
    if (active === 'false') {
      q = q.where('isActive', '==', false);
    } else {
      q = q.where('isActive', '==', true);
    }
    const lim = Math.min(Number(limitStr ?? 100), 500);
    const snap = await q.orderBy('name').limit(lim).get();
    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (typeof search === 'string') {
      const needle = search.toLowerCase();
      items = items.filter((i: any) =>
        i.name?.toLowerCase().includes(needle) || i.sku?.toLowerCase().includes(needle),
      );
    }

    res.status(200).json({ items, total: items.length });
  }),
);

router.get(
  '/api/warehouse/items/:id',
  wrapRoute(async (req, res) => {
    const snap = await db.collection(WH_COLLECTIONS.items).doc(req.params.id).get();
    if (!snap.exists) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Item ${req.params.id} not found` } });
      return;
    }
    res.status(200).json({ item: { id: snap.id, ...snap.data() } });
  }),
);

router.patch(
  '/api/warehouse/items/:id',
  wrapRoute(async (req, res) => {
    const updates = UpdateWhItemSchema.parse(req.body);
    const ref = db.collection(WH_COLLECTIONS.items).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Item ${req.params.id} not found` } });
      return;
    }
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
    res.status(200).json({ itemId: req.params.id, updated: Object.keys(updates) });
  }),
);

router.delete(
  '/api/warehouse/items/:id',
  wrapRoute(async (req, res) => {
    const ref = db.collection(WH_COLLECTIONS.items).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: `Item ${req.params.id} not found` } });
      return;
    }
    await ref.update({
      isActive: false,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: req.agentUserId ?? 'api',
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(200).json({ itemId: req.params.id, archived: true });
  }),
);

export default router;
