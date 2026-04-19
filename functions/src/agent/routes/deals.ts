/**
 * Deal Routes — CRM funnel (spec CRM_OVERHAUL §5.1, Client Journey Sprint 1.1)
 *
 * Endpoints:
 *   POST   /api/deals           Create
 *   GET    /api/deals           List (filterable by clientId/status/stage/ownerId)
 *   GET    /api/deals/:id       Get
 *   PATCH  /api/deals/:id       Update — enforces lost_reason when status='lost'
 *   DELETE /api/deals/:id       Soft-cancel (status='lost' + lostReason='deleted')
 *
 * RLS: worker/driver see only own (createdBy); manager+admin see company-wide.
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, FieldValue, logger, logAgentActivity } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import {
  CreateDealSchema,
  UpdateDealSchema,
  ListDealsQuerySchema,
} from '../schemas/dealSchemas';

const router = Router();
const COLLECTION = 'deals';

// ─── POST /api/deals ────────────────────────────────────────────────

router.post('/api/deals', async (req, res, next) => {
  try {
    const data = CreateDealSchema.parse(req.body);
    logger.info('💼 deal:create', { clientId: data.clientId, title: data.title, stage: data.stage });

    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        res.status(200).json({ dealId: keyDoc.data()!.entityId, deduplicated: true });
        return;
      }
    }

    // Client sanity check
    const clientSnap = await db.collection('clients').doc(data.clientId).get();
    if (!clientSnap.exists) {
      res.status(404).json({ error: 'Client not found', clientId: data.clientId });
      return;
    }
    const client = clientSnap.data()!;

    const auditCtx = extractAuditContext(req);
    const doc = {
      clientId: data.clientId,
      clientName: client.name ?? null,
      companyId: client.companyId ?? null,
      title: data.title,
      pipelineId: data.pipelineId ?? null,
      stage: data.stage,
      status: data.status,
      value: data.value ?? null,
      priority: data.priority,
      expectedCloseDate: data.expectedCloseDate
        ? admin.firestore.Timestamp.fromDate(new Date(data.expectedCloseDate))
        : null,
      actualCloseDate: null,
      lostReason: null,
      source: data.source ?? 'manual',
      workAddress: data.workAddress ?? null,
      notes: data.notes ?? null,
      tags: data.tags,
      projectId: null,
      primaryEstimateId: null,
      ownerId: auditCtx.performedBy,
      createdBy: auditCtx.performedBy,
      createdBySource: auditCtx.source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection(COLLECTION).add(doc);

    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: COLLECTION,
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'deal_created',
      endpoint: '/api/deals',
      metadata: { dealId: docRef.id, clientId: data.clientId, title: data.title, stage: data.stage },
    });
    await logAudit(
      AuditHelpers.create('deal', docRef.id, { clientId: data.clientId, title: data.title, stage: data.stage }, auditCtx.performedBy, auditCtx.source as never),
    );

    res.status(201).json({ dealId: docRef.id, clientId: data.clientId, stage: data.stage });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/deals ─────────────────────────────────────────────────

router.get('/api/deals', async (req, res, next) => {
  try {
    const params = ListDealsQuerySchema.parse(req.query);
    logger.info('💼 deal:list', { ...params });

    let q: admin.firestore.Query = db.collection(COLLECTION);

    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    if (rlsRole === 'worker' || rlsRole === 'driver') {
      q = q.where('createdBy', '==', rlsUserId);
    }

    if (params.clientId) q = q.where('clientId', '==', params.clientId);
    if (params.status) q = q.where('status', '==', params.status);
    if (params.stage) q = q.where('stage', '==', params.stage);
    if (params.ownerId) q = q.where('ownerId', '==', params.ownerId);

    q = q.orderBy('createdAt', 'desc');
    if (params.offset > 0) q = q.offset(params.offset);
    q = q.limit(params.limit);

    const snap = await q.get();
    const deals = snap.docs.map(d => serializeDeal(d));
    res.json({ deals, count: deals.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/deals/:id ─────────────────────────────────────────────

router.get('/api/deals/:id', async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTION).doc(req.params.id).get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }
    res.json(serializeDeal(snap));
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/deals/:id ───────────────────────────────────────────

router.patch('/api/deals/:id', async (req, res, next) => {
  try {
    const data = UpdateDealSchema.parse(req.body);
    const dealId = req.params.id;
    logger.info('💼 deal:update', { dealId, fields: Object.keys(data) });

    const ref = db.collection(COLLECTION).doc(dealId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }
    const existing = snap.data()!;

    // §5.1 gate: lostReason required when flipping to lost.
    const finalStatus = data.status ?? existing.status;
    const finalLostReason = data.lostReason ?? existing.lostReason;
    if (finalStatus === 'lost' && !finalLostReason) {
      res.status(400).json({
        error: 'lostReason is required when status = lost (spec §5.1)',
        path: ['lostReason'],
      });
      return;
    }

    const updatePayload: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (k === 'expectedCloseDate' || k === 'actualCloseDate') {
        updatePayload[k] = v === null
          ? null
          : admin.firestore.Timestamp.fromDate(new Date(v as string));
      } else {
        updatePayload[k] = v;
      }
    }

    // Auto-set actualCloseDate when closing
    if (data.status === 'won' || data.status === 'lost') {
      if (!existing.actualCloseDate) {
        updatePayload.actualCloseDate = admin.firestore.Timestamp.now();
      }
    }

    await ref.update(updatePayload);

    const auditCtx = extractAuditContext(req);
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'deal_updated',
      endpoint: `/api/deals/${dealId}`,
      metadata: { dealId, fields: Object.keys(data), stage: data.stage, status: data.status },
    });
    await logAudit(
      AuditHelpers.update('deal', dealId, existing, data, auditCtx.performedBy, auditCtx.source as never),
    );

    res.json({ dealId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/deals/:id ──────────────────────────────────────────

router.delete('/api/deals/:id', async (req, res, next) => {
  try {
    const dealId = req.params.id;
    const ref = db.collection(COLLECTION).doc(dealId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }
    // Soft-cancel: flip to 'lost' with reason='deleted'
    await ref.update({
      status: 'lost',
      lostReason: 'deleted',
      actualCloseDate: admin.firestore.Timestamp.now(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ dealId, cancelled: true });
  } catch (e) {
    next(e);
  }
});

function serializeDeal(doc: admin.firestore.DocumentSnapshot): Record<string, unknown> {
  const d = doc.data()!;
  return {
    id: doc.id,
    clientId: d.clientId,
    clientName: d.clientName ?? null,
    companyId: d.companyId ?? null,
    title: d.title,
    pipelineId: d.pipelineId ?? null,
    stage: d.stage,
    status: d.status,
    value: d.value ?? null,
    priority: d.priority,
    expectedCloseDate: d.expectedCloseDate?.toDate?.()?.toISOString() ?? null,
    actualCloseDate: d.actualCloseDate?.toDate?.()?.toISOString() ?? null,
    lostReason: d.lostReason ?? null,
    source: d.source ?? null,
    workAddress: d.workAddress ?? null,
    notes: d.notes ?? null,
    tags: d.tags ?? [],
    projectId: d.projectId ?? null,
    primaryEstimateId: d.primaryEstimateId ?? null,
    ownerId: d.ownerId ?? null,
    createdBy: d.createdBy ?? null,
    createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
    updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? null,
  };
}

export default router;
