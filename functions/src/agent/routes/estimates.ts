/**
 * Estimate Routes — POST, GET list, PATCH, convert-to-tasks (4 endpoints)
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import {
  db, FieldValue, Timestamp, logger, logAgentActivity,
  fuzzySearchClient, searchClientByAddress,
  autoCreateClientByAddress, resolveOwnerCompanyId,
} from '../routeContext';
import {
  CreateEstimateSchema,
  ListEstimatesQuerySchema,
  UpdateEstimateSchema,
} from '../schemas';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
// ESTIMATES & PROJECTS — Estimator Agent Endpoints
// ═══════════════════════════════════════════════════════════════════


// ─── POST /api/estimates ────────────────────────────────────────────

router.post('/api/estimates', async (req, res, next) => {
  try {
    const data = CreateEstimateSchema.parse(req.body);
    logger.info('📐 estimates:create', { clientId: data.clientId, address: data.address, itemCount: data.items.length, key: data.idempotencyKey });

    // Dedup check via _idempotency collection
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('📐 estimates:deduplicated', { estimateId: existing.entityId });
        res.status(200).json({ estimateId: existing.entityId, deduplicated: true });
        return;
      }
    }

    // Resolve client: by clientId, or auto-find/create by address
    let clientId = data.clientId;
    let clientName = data.clientName;

    if (!clientId && data.address) {
      // Search by address first (deduplication)
      const found = await searchClientByAddress(data.address);
      if (found) {
        clientId = found.id;
        clientName = clientName || found.name;
        logger.info('📐 estimates:client found by address', { clientId, address: data.address });
      } else {
        // Auto-create client with address as name
        const created = await autoCreateClientByAddress(data.address, 'estimate');
        clientId = created.id;
        clientName = clientName || created.name;
        logger.info('📐 estimates:client auto-created', { clientId, address: data.address });
      }
    }

    if (!clientId) {
      res.status(400).json({ error: 'Необходим clientId или address для создания estimate' });
      return;
    }

    // Validate clientId exists in Firestore
    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
      res.status(400).json({ error: `Клиент с ID "${clientId}" не найден` });
      return;
    }

    const companyId = await resolveOwnerCompanyId();

    // Generate estimate number
    const number = `EST-${Date.now().toString().slice(-6)}`;

    const subtotal = data.items.reduce((sum, item) => sum + item.total, 0);
    const taxRate = data.taxRate || 0;
    const taxAmount = +(subtotal * (taxRate / 100)).toFixed(2);
    const total = +(subtotal + taxAmount).toFixed(2);

    const docRef = await db.collection('estimates').add({
      companyId,
      clientId,
      clientName: clientName || '',
      siteId: data.siteId || null,
      number,
      status: 'draft',
      estimateType: data.estimateType || 'commercial',
      items: data.items,
      subtotal: +subtotal.toFixed(2),
      taxRate,
      taxAmount,
      total,
      notes: data.notes || '',
      terms: data.terms || '',
      validUntil: data.validUntil ? Timestamp.fromDate(new Date(data.validUntil)) : null,
      createdBy: req.agentUserId,
      source: 'openclaw_estimator',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Store idempotency key with 24h TTL
    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'estimates',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('📐 estimates:created', { estimateId: docRef.id, number, total });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'estimate_created',
      endpoint: '/api/estimates',
      metadata: { estimateId: docRef.id, number, clientId, total },
    });

    res.status(201).json({ estimateId: docRef.id, number, total });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/estimates/list ────────────────────────────────────────

router.get('/api/estimates/list', async (req, res, next) => {
  try {
    const params = ListEstimatesQuerySchema.parse(req.query);
    let clientId = params.clientId;

    if (!clientId && params.clientName) {
      const match = await fuzzySearchClient(params.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    const companyId = await resolveOwnerCompanyId();
    logger.info('📐 estimates:list', { companyId, clientId, status: params.status });

    let q: admin.firestore.Query = db.collection('estimates')
      .where('companyId', '==', companyId);

    if (clientId) {
      q = q.where('clientId', '==', clientId);
    }

    if (params.status) {
      const statuses = params.status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        q = q.where('status', '==', statuses[0]);
      } else if (statuses.length > 1 && statuses.length <= 10) {
        q = q.where('status', 'in', statuses);
      }
    }

    q = q.orderBy('createdAt', 'desc');

    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    if (params.offset > 0) {
      q = q.offset(params.offset);
    }
    q = q.limit(params.limit);

    const snap = await q.get();
    const estimates = snap.docs.map(d => {
      const e = d.data();
      return {
        id: d.id,
        number: e.number,
        clientId: e.clientId,
        clientName: e.clientName,
        status: e.status,
        subtotal: e.subtotal,
        taxRate: e.taxRate,
        taxAmount: e.taxAmount,
        total: e.total,
        estimateType: e.estimateType || 'commercial',
        itemCount: e.items?.length || 0,
        notes: e.notes || '',
        validUntil: e.validUntil?.toDate?.()?.toISOString() || null,
        createdAt: e.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: e.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ estimates, total, hasMore: params.offset + estimates.length < total });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/estimates/:id ───────────────────────────────────────

router.patch('/api/estimates/:id', async (req, res, next) => {
  try {
    const estimateId = req.params.id;
    const data = UpdateEstimateSchema.parse(req.body);

    logger.info('📐 estimates:update', { estimateId, fields: Object.keys(data) });

    const estimateRef = db.collection('estimates').doc(estimateId);
    const estimateDoc = await estimateRef.get();

    if (!estimateDoc.exists) {
      res.status(404).json({ error: 'Смета не найдена' });
      return;
    }

    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (data.estimateType !== undefined) updatePayload.estimateType = data.estimateType;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.notes !== undefined) updatePayload.notes = data.notes;
    if (data.terms !== undefined) updatePayload.terms = data.terms;
    if (data.taxRate !== undefined) updatePayload.taxRate = data.taxRate;

    if (data.validUntil !== undefined) {
      updatePayload.validUntil = data.validUntil
        ? Timestamp.fromDate(new Date(data.validUntil))
        : null;
    }

    if (data.items !== undefined) {
      updatePayload.items = data.items;
      const subtotal = data.items.reduce((sum, item) => sum + item.total, 0);
      const taxRate = data.taxRate ?? estimateDoc.data()!.taxRate ?? 0;
      const taxAmount = +(subtotal * (taxRate / 100)).toFixed(2);
      updatePayload.subtotal = +subtotal.toFixed(2);
      updatePayload.taxAmount = taxAmount;
      updatePayload.total = +(subtotal + taxAmount).toFixed(2);
    }

    await estimateRef.update(updatePayload);

    logger.info('📐 estimates:updated', { estimateId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'estimate_updated',
      endpoint: `/api/estimates/${estimateId}`,
      metadata: { estimateId, fields: Object.keys(data) },
    });

    res.json({ estimateId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/estimates/:id/convert-to-tasks ──────────────────────

router.post('/api/estimates/:id/convert-to-tasks', async (req, res, next) => {
  try {
    const estimateId = req.params.id;
    const agentUserId = req.agentUserId;
    logger.info('📐 estimates:convert-to-tasks', { estimateId });

    // Atomic transaction: read estimate + check status + create tasks + update status
    const result = await db.runTransaction(async (tx) => {
      const estimateRef = db.collection('estimates').doc(estimateId);
      const estimateDoc = await tx.get(estimateRef);

      if (!estimateDoc.exists) {
        return { error: 'not_found' } as const;
      }

      const estimate = estimateDoc.data()!;

      if (estimate.status === 'converted') {
        return { error: 'already_converted', taskId: estimate.convertedToTaskId } as const;
      }

      // Group items by type for sub-tasks
      const byType: Record<string, { items: any[]; total: number }> = {};
      for (const item of (estimate.items || [])) {
        const type = item.type || 'other';
        if (!byType[type]) byType[type] = { items: [], total: 0 };
        byType[type].items.push(item);
        byType[type].total += item.total || 0;
      }

      const createdTaskIds: string[] = [];

      // Parent task
      const parentRef = db.collection('gtd_tasks').doc();
      const itemsSummary = (estimate.items || [])
        .map((i: any) => `• ${i.description}: ${i.quantity} × $${i.unitPrice} = $${i.total}`)
        .join('\n');

      tx.set(parentRef, {
        ownerId: agentUserId,
        title: `${estimate.number}: ${estimate.clientName} — Electrical`,
        description: `Converted from estimate ${estimate.number}.\n${estimate.notes || ''}\n\nItems:\n${itemsSummary}\n\nTotal: $${estimate.total}`,
        status: 'next_action',
        priority: 'high',
        context: '@office',
        clientId: estimate.clientId,
        clientName: estimate.clientName,
        budgetAmount: estimate.total,
        taskType: 'estimate_conversion',
        source: `estimate:${estimateId}`,
        estimateId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      createdTaskIds.push(parentRef.id);

      // Sub-tasks by category
      const typeLabels: Record<string, string> = {
        material: 'Materials',
        labor: 'Labor',
        service: 'Services',
        other: 'Other',
      };

      for (const [type, group] of Object.entries(byType)) {
        const subRef = db.collection('gtd_tasks').doc();
        const label = typeLabels[type] || type;
        tx.set(subRef, {
          ownerId: agentUserId,
          title: `${estimate.number}: ${label} — $${group.total.toFixed(2)}`,
          description: group.items.map((i: any) => `• ${i.description}: $${i.total}`).join('\n'),
          status: 'next_action',
          priority: 'medium',
          context: '@office',
          clientId: estimate.clientId,
          clientName: estimate.clientName,
          parentTaskId: parentRef.id,
          isSubtask: true,
          budgetAmount: +group.total.toFixed(2),
          budgetCategory: type,
          taskType: 'estimate_conversion',
          source: `estimate:${estimateId}`,
          estimateId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        createdTaskIds.push(subRef.id);
      }

      // Update estimate status atomically
      tx.update(estimateRef, {
        status: 'converted',
        convertedToTaskId: parentRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        error: null,
        parentTaskId: parentRef.id,
        createdTaskIds,
        estimateNumber: estimate.number,
      } as const;
    });

    // Handle transaction results
    if (result.error === 'not_found') {
      res.status(404).json({ error: 'Смета не найдена' });
      return;
    }

    if (result.error === 'already_converted') {
      res.status(409).json({ error: 'Смета уже конвертирована', taskId: result.taskId });
      return;
    }

    logger.info('📐 estimates:converted', { estimateId, taskCount: result.createdTaskIds.length });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'estimate_converted',
      endpoint: `/api/estimates/${estimateId}/convert-to-tasks`,
      metadata: { estimateId, parentTaskId: result.parentTaskId, taskCount: result.createdTaskIds.length },
    });

    res.status(201).json({
      parentTaskId: result.parentTaskId,
      taskIds: result.createdTaskIds,
      taskCount: result.createdTaskIds.length,
      message: `Создано ${result.createdTaskIds.length} задач из сметы ${result.estimateNumber}`,
    });
  } catch (e) {
    next(e);
  }
});


export default router;
