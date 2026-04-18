/**
 * Vendor catalog routes.
 *
 * Endpoints:
 *   POST   /api/warehouse/vendors
 *   GET    /api/warehouse/vendors
 *   GET    /api/warehouse/vendors/:id
 *   PATCH  /api/warehouse/vendors/:id
 *   DELETE /api/warehouse/vendors/:id         soft-delete (isActive=false)
 */

import { Router } from 'express';
import { db, FieldValue, logger, logAgentActivity } from '../../../agent/routeContext';
import { CreateWhVendorSchema, UpdateWhVendorSchema } from '../../database/schemas';
import { WH_COLLECTIONS } from '../../database/collections';
import { wrapRoute } from '../errorHandler';

const router = Router();

router.post(
  '/api/warehouse/vendors',
  wrapRoute(async (req, res) => {
    const data = CreateWhVendorSchema.parse(req.body);
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const ref = db.collection(WH_COLLECTIONS.vendors).doc(`vendor_${slug}`);
    const existing = await ref.get();
    if (existing.exists) {
      res.status(409).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Vendor ${data.name} already exists`,
          details: { vendorId: ref.id },
        },
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

    logger.info('🏭 warehouse:vendor.created', { vendorId: ref.id, name: data.name });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_vendor_created',
      endpoint: '/api/warehouse/vendors',
      metadata: { vendorId: ref.id, name: data.name },
    });

    res.status(201).json({ vendorId: ref.id, name: data.name });
  }),
);

router.get(
  '/api/warehouse/vendors',
  wrapRoute(async (req, res) => {
    const { active, vendorType } = req.query;
    let q: FirebaseFirestore.Query = db.collection(WH_COLLECTIONS.vendors);
    if (active === 'false') {
      q = q.where('isActive', '==', false);
    } else {
      q = q.where('isActive', '==', true);
    }
    if (typeof vendorType === 'string') q = q.where('vendorType', '==', vendorType);
    const snap = await q.limit(200).get();
    const vendors = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.status(200).json({ vendors, total: vendors.length });
  }),
);

router.get(
  '/api/warehouse/vendors/:id',
  wrapRoute(async (req, res) => {
    const snap = await db.collection(WH_COLLECTIONS.vendors).doc(req.params.id).get();
    if (!snap.exists) {
      res.status(404).json({ error: { code: 'VENDOR_NOT_FOUND', message: `Vendor ${req.params.id} not found` } });
      return;
    }
    res.status(200).json({ vendor: { id: snap.id, ...snap.data() } });
  }),
);

router.patch(
  '/api/warehouse/vendors/:id',
  wrapRoute(async (req, res) => {
    const updates = UpdateWhVendorSchema.parse(req.body);
    const ref = db.collection(WH_COLLECTIONS.vendors).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: { code: 'VENDOR_NOT_FOUND', message: `Vendor ${req.params.id} not found` } });
      return;
    }
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
    res.status(200).json({ vendorId: req.params.id, updated: Object.keys(updates) });
  }),
);

router.delete(
  '/api/warehouse/vendors/:id',
  wrapRoute(async (req, res) => {
    const ref = db.collection(WH_COLLECTIONS.vendors).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: { code: 'VENDOR_NOT_FOUND', message: `Vendor ${req.params.id} not found` } });
      return;
    }
    await ref.update({
      isActive: false,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: req.agentUserId ?? 'api',
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(200).json({ vendorId: req.params.id, archived: true });
  }),
);

export default router;
