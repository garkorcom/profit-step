/**
 * Site Routes — POST, GET, PATCH (3 endpoints)
 */
import { Router } from 'express';

import { db, FieldValue, logger, logAgentActivity } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import {
  CreateSiteSchema,
  UpdateSiteSchema,
} from '../schemas';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
// SITES — Phase 1 Foundation
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/sites ────────────────────────────────────────────────

router.post('/api/sites', async (req, res, next) => {
  try {
    const data = CreateSiteSchema.parse(req.body);
    logger.info('🏗️ sites:create', { clientId: data.clientId, name: data.name });

    // Validate client exists
    const clientDoc = await db.collection('clients').doc(data.clientId).get();
    if (!clientDoc.exists) {
      res.status(400).json({ error: `Клиент с ID "${data.clientId}" не найден` });
      return;
    }

    const siteAuditCtx = extractAuditContext(req);
    const docRef = await db.collection('sites').add({
      clientId: data.clientId,
      name: data.name,
      address: data.address,
      city: data.city || null,
      state: data.state || null,
      zip: data.zip || null,
      geo: data.geo || null,
      sqft: data.sqft || null,
      type: data.type || null,
      permitNumber: data.permitNumber || null,
      status: data.status,
      createdBy: siteAuditCtx.performedBy,
      createdBySource: siteAuditCtx.source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('🏗️ sites:created', { siteId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'site_created',
      endpoint: '/api/sites',
      metadata: { siteId: docRef.id, name: data.name, clientId: data.clientId },
    });

    await logAudit(AuditHelpers.create('site', docRef.id, { name: data.name, clientId: data.clientId, address: data.address }, siteAuditCtx.performedBy, siteAuditCtx.source as any));

    res.status(201).json({ siteId: docRef.id, name: data.name });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/sites ─────────────────────────────────────────────────

router.get('/api/sites', async (req, res, next) => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    logger.info('🏗️ sites:list', { clientId });

    const snap = await db.collection('sites')
      .where('clientId', '==', clientId)
      .get();

    const sites = snap.docs.map((d) => {
      const s = d.data();
      return {
        id: d.id,
        clientId: s.clientId,
        name: s.name,
        address: s.address,
        city: s.city || null,
        state: s.state || null,
        zip: s.zip || null,
        geo: s.geo || null,
        sqft: s.sqft || null,
        type: s.type || null,
        permitNumber: s.permitNumber || null,
        status: s.status,
        createdAt: s.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: s.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ sites, count: sites.length });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/sites/:id ───────────────────────────────────────────

router.patch('/api/sites/:id', async (req, res, next) => {
  try {
    const siteId = req.params.id;
    const data = UpdateSiteSchema.parse(req.body);

    logger.info('🏗️ sites:update', { siteId, fields: Object.keys(data) });

    const siteRef = db.collection('sites').doc(siteId);
    const siteDoc = await siteRef.get();

    if (!siteDoc.exists) {
      res.status(404).json({ error: 'Site не найден' });
      return;
    }

    const siteUpdateCtx = extractAuditContext(req);
    const oldSiteData = siteDoc.data()!;
    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: siteUpdateCtx.performedBy,
      updatedBySource: siteUpdateCtx.source,
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.address !== undefined) updatePayload.address = data.address;
    if (data.city !== undefined) updatePayload.city = data.city;
    if (data.state !== undefined) updatePayload.state = data.state;
    if (data.zip !== undefined) updatePayload.zip = data.zip;
    if (data.geo !== undefined) updatePayload.geo = data.geo;
    if (data.sqft !== undefined) updatePayload.sqft = data.sqft;
    if (data.type !== undefined) updatePayload.type = data.type;
    if (data.permitNumber !== undefined) updatePayload.permitNumber = data.permitNumber;
    if (data.status !== undefined) updatePayload.status = data.status;

    await siteRef.update(updatePayload);

    logger.info('🏗️ sites:updated', { siteId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'site_updated',
      endpoint: `/api/sites/${siteId}`,
      metadata: { siteId, fields: Object.keys(data) },
    });

    const siteFrom: Record<string, any> = {};
    const siteTo: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      if ((data as any)[key] !== undefined) {
        siteFrom[key] = oldSiteData[key] ?? null;
        siteTo[key] = (data as any)[key];
      }
    }
    await logAudit(AuditHelpers.update('site', siteId, siteFrom, siteTo, siteUpdateCtx.performedBy, siteUpdateCtx.source as any));

    res.json({ siteId, updated: true });
  } catch (e) {
    next(e);
  }
});


export default router;
