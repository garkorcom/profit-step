/**
 * Cost Routes — POST, GET list, DELETE (3 endpoints)
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, FieldValue, Timestamp, logger, logAgentActivity, fuzzySearchClient, COST_CATEGORY_LABELS } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import {
  CreateCostSchema,
  ListCostsQuerySchema,
} from '../schemas';
import { requireScope } from '../agentMiddleware';
import { publishCostEvent } from '../utils/eventPublisher';

const router = Router();

// ─── POST /api/costs ────────────────────────────────────────────────

router.post('/api/costs', requireScope('costs:write', 'admin'), async (req, res, next) => {
  try {
    const data = CreateCostSchema.parse(req.body);
    logger.info('💰 costs:create', { clientId: data.clientId, category: data.category, amount: data.amount });

    // Dedup
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('💰 costs:deduplicated', { costId: existing.entityId });
        res.status(200).json({ costId: existing.entityId, deduplicated: true });
        return;
      }
    }

    // Auto-resolve projectId if not provided but clientId exists
    let resolvedProjectId = data.projectId || null;
    if (!resolvedProjectId && data.clientId) {
      // Check if client has exactly one active project
      const clientProjectsSnap = await db.collection('projects')
        .where('clientId', '==', data.clientId)
        .where('status', '==', 'active')
        .limit(2) // Limit to 2 to detect if there's more than 1
        .get();

      if (clientProjectsSnap.size === 1) {
        resolvedProjectId = clientProjectsSnap.docs[0].id;
        logger.info('💰 costs:auto-resolved projectId', { clientId: data.clientId, projectId: resolvedProjectId });
      }
    }

    const effectiveAmount = data.category === 'reimbursement'
      ? -Math.abs(data.amount) : data.amount;

    const costAuditCtx = extractAuditContext(req);
    const docRef = await db.collection('costs').add({
      userId: req.agentUserId,
      userName: req.agentUserName,
      clientId: data.clientId,
      clientName: data.clientName,
      category: data.category,
      categoryLabel: COST_CATEGORY_LABELS[data.category] || data.category,
      amount: effectiveAmount,
      originalAmount: Math.abs(data.amount),
      description: data.description || null,
      receiptPhotoUrl: null,
      voiceNoteUrl: null,
      status: 'confirmed',
      source: costAuditCtx.source || 'openclaw',
      createdBy: costAuditCtx.performedBy,
      createdBySource: costAuditCtx.source,
      taskId: data.taskId || null,
      projectId: resolvedProjectId,
      siteId: data.siteId || null,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'costs',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('💰 costs:created', { costId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'cost_created',
      endpoint: '/api/costs',
      metadata: { costId: docRef.id, category: data.category, amount: effectiveAmount },
    });

    await logAudit(AuditHelpers.create('cost', docRef.id, { category: data.category, amount: effectiveAmount, clientId: data.clientId }, costAuditCtx.performedBy, costAuditCtx.source as any));

    // Publish event
    publishCostEvent('created', docRef.id,
      `Cost $${effectiveAmount} (${data.category}) added`,
      { category: data.category, amount: effectiveAmount, clientId: data.clientId },
      null, // broadcast — admin sees all costs
    );

    res.status(201).json({ costId: docRef.id });
  } catch (e) {
    next(e);
  }
});


// ─── GET /api/costs/list ───────────────────────────────────────────

router.get('/api/costs/list', requireScope('costs:read', 'admin'), async (req, res, next) => {
  try {
    const params = ListCostsQuerySchema.parse(req.query);
    let clientId = params.clientId;

    // Resolve clientName → clientId via fuzzy search
    if (!clientId && params.clientName) {
      const match = await fuzzySearchClient(params.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    logger.info('💰 costs:list', { clientId, category: params.category, limit: params.limit });

    let q: admin.firestore.Query = db.collection('costs');

    if (clientId) {
      q = q.where('clientId', '==', clientId);
    }

    // Category filter: comma-separated
    if (params.category) {
      const categories = params.category.split(',').map((c) => c.trim()).filter(Boolean);
      if (categories.length === 1) {
        q = q.where('category', '==', categories[0]);
      } else if (categories.length > 1 && categories.length <= 10) {
        q = q.where('category', 'in', categories);
      }
    }

    // Date range filters
    const hasDateFilter = !!(params.from || params.to);
    if (params.from) {
      q = q.where('createdAt', '>=', Timestamp.fromDate(new Date(params.from)));
    }
    if (params.to) {
      // Add 1 day to 'to' to include the entire day
      const toDate = new Date(params.to);
      toDate.setDate(toDate.getDate() + 1);
      q = q.where('createdAt', '<', Timestamp.fromDate(toDate));
    }

    // Sort
    if (hasDateFilter) {
      q = q.orderBy('createdAt', params.sortDir);
    } else {
      q = q.orderBy(params.sortBy, params.sortDir);
    }

    // Count total before pagination
    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    // Apply pagination
    if (params.offset > 0) {
      q = q.offset(params.offset);
    }
    q = q.limit(params.limit);

    const snap = await q.get();
    const costs = snap.docs.map((d) => {
      const c = d.data();
      return {
        id: d.id,
        clientId: c.clientId,
        clientName: c.clientName,
        category: c.category,
        categoryLabel: c.categoryLabel,
        amount: c.amount,
        originalAmount: c.originalAmount,
        description: c.description || null,
        taskId: c.taskId || null,
        projectId: c.projectId || null,
        status: c.status,
        source: c.source || null,
        createdAt: c.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Aggregate sum by category
    const byCategory: Record<string, number> = {};
    let totalAmount = 0;
    costs.forEach((c) => {
      totalAmount += c.amount;
      byCategory[c.category] = (byCategory[c.category] || 0) + c.amount;
    });

    res.json({
      costs,
      total,
      hasMore: params.offset + costs.length < total,
      sum: { total: +totalAmount.toFixed(2), byCategory },
    });
  } catch (e) {
    next(e);
  }
});


// ─── DELETE /api/costs/:id (Phase 2) ────────────────────────────────

router.delete('/api/costs/:id', requireScope('costs:write', 'admin'), async (req, res, next) => {
  try {
    const costId = req.params.id;
    logger.info('💰 costs:void', { costId });

    const costRef = db.collection('costs').doc(costId);
    const costDoc = await costRef.get();

    if (!costDoc.exists) {
      res.status(404).json({ error: 'Расход не найден' });
      return;
    }

    const costData = costDoc.data()!;
    if (costData.status === 'voided') {
      res.status(400).json({ error: 'Расход уже удалён (voided)' });
      return;
    }

    const voidAuditCtx = extractAuditContext(req);
    await costRef.update({
      status: 'voided',
      voidedAt: FieldValue.serverTimestamp(),
      voidedBy: req.agentUserId,
      updatedBy: voidAuditCtx.performedBy,
      updatedBySource: voidAuditCtx.source,
    });

    logger.info('💰 costs:voided', { costId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'cost_voided',
      endpoint: `/api/costs/${costId}`,
      metadata: { costId, previousAmount: costData.amount, category: costData.category },
    });

    await logAudit(AuditHelpers.delete('cost', costId, { amount: costData.amount, category: costData.category }, voidAuditCtx.performedBy, voidAuditCtx.source as any));

    res.json({ costId, voided: true, message: 'Расход удалён (voided)' });
  } catch (e) {
    next(e);
  }
});


export default router;
