/**
 * ERP Routes — change-orders, purchase-orders, plan-vs-fact (5 endpoints)
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, FieldValue, Timestamp, logger, logAgentActivity, getCachedClients, fuzzySearchClient, resolveOwnerCompanyId } from '../routeContext';
import {
  CreateChangeOrderSchema,
  UpdateChangeOrderSchema,
  ListChangeOrdersQuerySchema,
  CreatePurchaseOrderSchema,
  ListPurchaseOrdersQuerySchema,
  PlanVsFactQuerySchema,
} from '../schemas';
import { requireScope } from '../agentMiddleware';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
// ERP V4 — Change Orders, Purchase Orders, Plan vs Fact
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/change-orders ────────────────────────────────────────

router.post('/api/change-orders', requireScope('erp:write', 'admin'), async (req, res, next) => {
  try {
    const data = CreateChangeOrderSchema.parse(req.body);
    logger.info('📋 change-orders:create', { projectId: data.projectId, title: data.title });

    // Dedup
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('📋 change-orders:deduplicated', { id: existing.entityId });
        res.status(200).json({ changeOrderId: existing.entityId, deduplicated: true });
        return;
      }
    }

    const companyId = await resolveOwnerCompanyId();

    // Compute totals from items
    const internalTotal = data.items.reduce((s, i) => s + i.totalCost, 0);
    const clientTotal = data.items.reduce((s, i) => s + i.totalClientPrice, 0);
    const markupTotal = clientTotal - internalTotal;

    // Auto-generate CO number
    const existingCOs = await db.collection(`companies/${companyId}/change_orders`)
      .where('projectId', '==', data.projectId)
      .count().get();
    const coNumber = `CO-${String((existingCOs.data().count || 0) + 1).padStart(3, '0')}`;

    const docRef = await db.collection(`companies/${companyId}/change_orders`).add({
      companyId,
      projectId: data.projectId,
      projectName: data.projectName,
      clientId: data.clientId,
      clientName: data.clientName,
      parentEstimateId: data.parentEstimateId,
      number: coNumber,
      title: data.title,
      description: data.description || null,
      status: 'draft',
      items: data.items,
      internalTotal: +internalTotal.toFixed(2),
      clientTotal: +clientTotal.toFixed(2),
      markupTotal: +markupTotal.toFixed(2),
      defaultMarkupPercent: data.defaultMarkupPercent,
      createdBy: req.agentUserId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'change_orders',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('📋 change-orders:created', { id: docRef.id, number: coNumber });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'change_order_created',
      endpoint: '/api/change-orders',
      metadata: { id: docRef.id, number: coNumber, clientTotal },
    });

    res.status(201).json({ changeOrderId: docRef.id, number: coNumber });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/change-orders ─────────────────────────────────────────

router.get('/api/change-orders', requireScope('erp:read', 'admin'), async (req, res, next) => {
  try {
    const params = ListChangeOrdersQuerySchema.parse(req.query);
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
    let q: admin.firestore.Query = db.collection(`companies/${companyId}/change_orders`);

    if (params.projectId) {
      q = q.where('projectId', '==', params.projectId);
    } else if (clientId) {
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

    if (params.offset > 0) q = q.offset(params.offset);
    q = q.limit(params.limit);

    const snap = await q.get();
    const changeOrders = snap.docs.map(d => {
      const c = d.data();
      return {
        id: d.id,
        number: c.number,
        projectId: c.projectId,
        projectName: c.projectName,
        clientId: c.clientId,
        clientName: c.clientName,
        title: c.title,
        status: c.status,
        internalTotal: c.internalTotal,
        clientTotal: c.clientTotal,
        markupTotal: c.markupTotal,
        itemCount: (c.items || []).length,
        createdAt: c.createdAt?.toDate?.()?.toISOString() || null,
        approvedAt: c.approvedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ changeOrders, total, hasMore: params.offset + changeOrders.length < total });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/change-orders/:id ───────────────────────────────────

router.patch('/api/change-orders/:id', requireScope('erp:write', 'admin'), async (req, res, next) => {
  try {
    const coId = req.params.id;
    const data = UpdateChangeOrderSchema.parse(req.body);

    logger.info('📋 change-orders:update', { coId, fields: Object.keys(data) });

    const companyId = await resolveOwnerCompanyId();
    const coRef = db.collection(`companies/${companyId}/change_orders`).doc(coId);
    const coDoc = await coRef.get();

    if (!coDoc.exists) {
      res.status(404).json({ error: 'Change Order не найден' });
      return;
    }

    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.rejectionReason !== undefined) updatePayload.rejectionReason = data.rejectionReason;

    if (data.items) {
      updatePayload.items = data.items;
      const internalTotal = data.items.reduce((s, i) => s + i.totalCost, 0);
      const clientTotal = data.items.reduce((s, i) => s + i.totalClientPrice, 0);
      updatePayload.internalTotal = +internalTotal.toFixed(2);
      updatePayload.clientTotal = +clientTotal.toFixed(2);
      updatePayload.markupTotal = +(clientTotal - internalTotal).toFixed(2);
    }

    if (data.status) {
      updatePayload.status = data.status;
      if (data.status === 'approved') {
        updatePayload.approvedAt = FieldValue.serverTimestamp();
        updatePayload.approvedBy = data.approvedBy || req.agentUserName;
      }
      if (data.status === 'rejected') {
        updatePayload.rejectedAt = FieldValue.serverTimestamp();
      }
    }

    await coRef.update(updatePayload);

    logger.info('📋 change-orders:updated', { coId });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'change_order_updated',
      endpoint: `/api/change-orders/${coId}`,
      metadata: { coId, fields: Object.keys(data) },
    });

    res.json({ changeOrderId: coId, updated: true });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/purchase-orders ──────────────────────────────────────

router.post('/api/purchase-orders', requireScope('erp:write', 'admin'), async (req, res, next) => {
  try {
    const data = CreatePurchaseOrderSchema.parse(req.body);
    logger.info('🧾 purchase-orders:create', { projectId: data.projectId, vendor: data.vendor });

    // Dedup
    if (data.idempotencyKey) {
      const keyDoc = await db.doc(`_idempotency/${data.idempotencyKey}`).get();
      if (keyDoc.exists) {
        const existing = keyDoc.data()!;
        logger.info('🧾 purchase-orders:deduplicated', { id: existing.entityId });
        res.status(200).json({ purchaseOrderId: existing.entityId, deduplicated: true });
        return;
      }
    }

    const companyId = await resolveOwnerCompanyId();

    const subtotal = data.items.reduce((s, i) => s + i.total, 0);
    const total = subtotal + (data.taxAmount || 0);
    const varianceAmount = data.plannedTotal != null ? +(total - data.plannedTotal).toFixed(2) : null;
    const variancePercent = data.plannedTotal && data.plannedTotal > 0
      ? +((varianceAmount! / data.plannedTotal) * 100).toFixed(1) : null;

    const purchaseDate = data.purchaseDate
      ? Timestamp.fromDate(new Date(data.purchaseDate))
      : FieldValue.serverTimestamp();

    // Compute item-level variance
    const itemsWithVariance = data.items.map(item => ({
      ...item,
      variancePercent: item.plannedUnitPrice && item.plannedUnitPrice > 0
        ? +(((item.unitPrice - item.plannedUnitPrice) / item.plannedUnitPrice) * 100).toFixed(1)
        : null,
    }));

    const docRef = await db.collection(`companies/${companyId}/purchase_orders`).add({
      companyId,
      projectId: data.projectId,
      projectName: data.projectName,
      clientId: data.clientId,
      clientName: data.clientName,
      taskId: data.taskId || null,
      taskTitle: data.taskTitle || null,
      estimateId: data.estimateId || null,
      vendor: data.vendor,
      vendorContact: data.vendorContact || null,
      items: itemsWithVariance,
      category: data.category,
      subtotal: +subtotal.toFixed(2),
      taxAmount: data.taxAmount || 0,
      total: +total.toFixed(2),
      plannedTotal: data.plannedTotal || null,
      varianceAmount,
      variancePercent,
      receiptPhotoUrl: data.receiptPhotoUrl || null,
      receiptPhotoUrls: data.receiptPhotoUrls || [],
      status: data.status,
      purchaseDate,
      createdBy: req.agentUserId,
      createdByName: req.agentUserName,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (data.idempotencyKey) {
      await db.doc(`_idempotency/${data.idempotencyKey}`).set({
        entityId: docRef.id,
        collection: 'purchase_orders',
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logger.info('🧾 purchase-orders:created', { id: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'purchase_order_created',
      endpoint: '/api/purchase-orders',
      metadata: { id: docRef.id, vendor: data.vendor, total: +total.toFixed(2) },
    });

    res.status(201).json({ purchaseOrderId: docRef.id, total: +total.toFixed(2) });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/purchase-orders ───────────────────────────────────────

router.get('/api/purchase-orders', requireScope('erp:read', 'admin'), async (req, res, next) => {
  try {
    const params = ListPurchaseOrdersQuerySchema.parse(req.query);
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
    let q: admin.firestore.Query = db.collection(`companies/${companyId}/purchase_orders`);

    if (params.projectId) {
      q = q.where('projectId', '==', params.projectId);
    } else if (clientId) {
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

    if (params.offset > 0) q = q.offset(params.offset);
    q = q.limit(params.limit);

    const snap = await q.get();
    const purchaseOrders = snap.docs.map(d => {
      const po = d.data();
      return {
        id: d.id,
        projectId: po.projectId,
        projectName: po.projectName,
        clientId: po.clientId,
        clientName: po.clientName,
        vendor: po.vendor,
        category: po.category,
        subtotal: po.subtotal,
        total: po.total,
        plannedTotal: po.plannedTotal || null,
        varianceAmount: po.varianceAmount || null,
        variancePercent: po.variancePercent || null,
        status: po.status,
        itemCount: (po.items || []).length,
        purchaseDate: po.purchaseDate?.toDate?.()?.toISOString() || null,
        createdAt: po.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Aggregate
    let totalAmount = 0;
    const byCategory: Record<string, number> = {};
    purchaseOrders.forEach(po => {
      totalAmount += po.total;
      byCategory[po.category] = (byCategory[po.category] || 0) + po.total;
    });

    res.json({
      purchaseOrders,
      total,
      hasMore: params.offset + purchaseOrders.length < total,
      sum: { total: +totalAmount.toFixed(2), byCategory },
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/plan-vs-fact ──────────────────────────────────────────

router.get('/api/plan-vs-fact', requireScope('erp:read', 'dashboard:read', 'admin'), async (req, res, next) => {
  try {
    const params = PlanVsFactQuerySchema.parse(req.query);
    let clientId = params.clientId;
    let clientName = '';

    // Resolve client
    if (!clientId && params.clientName) {
      const match = await fuzzySearchClient(params.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
      clientName = match.name;
    }

    // If projectId given but no clientId, resolve from project
    if (params.projectId && !clientId) {
      const projSnap = await db.collection('projects').doc(params.projectId).get();
      if (projSnap.exists) {
        const projData = projSnap.data()!;
        clientId = projData.clientId;
        clientName = projData.clientName || '';
      }
    }

    if (!clientId) {
      res.status(400).json({ error: 'Could not resolve clientId' });
      return;
    }

    // Fetch client name if not yet resolved
    if (!clientName) {
      const clients = await getCachedClients();
      const found = clients.find((c: any) => c.id === clientId);
      clientName = found?.name || clientId;
    }

    const companyId = await resolveOwnerCompanyId();

    logger.info('📊 plan-vs-fact', { clientId, projectId: params.projectId });

    // ── PLANNED: from estimates (approved / locked / converted) ──
    // Note: estimates live in root collection, not under companies/
    let estimateQuery: admin.firestore.Query = db.collection('estimates')
      .where('clientId', '==', clientId)
      .where('status', 'in', ['approved', 'locked', 'converted']);

    if (params.projectId) {
      estimateQuery = estimateQuery.where('convertedToProjectId', '==', params.projectId);
    }

    const estimateSnap = await estimateQuery.get();

    let plannedMaterials = 0;
    let plannedLabor = 0;
    let plannedSubcontract = 0;
    let clientTotal = 0;

    estimateSnap.docs.forEach(d => {
      const est = d.data();
      if (est.version === 'v4' && est.internalItems) {
        // V4 dual-estimate: use internalItems for plan
        (est.internalItems as any[]).forEach(item => {
          switch (item.type) {
            case 'material':
            case 'equipment':
              plannedMaterials += item.totalCost || 0;
              break;
            case 'labor':
              plannedLabor += item.laborCost || item.totalCost || 0;
              break;
            case 'subcontract':
              plannedSubcontract += item.subcontractCost || item.totalCost || 0;
              break;
            default:
              plannedMaterials += item.totalCost || 0;
          }
        });
        clientTotal += est.clientSubtotal || est.total || 0;
      } else {
        // V3: all items go to materials (no cost breakdown)
        plannedMaterials += est.subtotal || 0;
        clientTotal += est.total || 0;
      }
    });

    // Add approved change orders to plan
    let coQuery: admin.firestore.Query = db.collection(`companies/${companyId}/change_orders`)
      .where('clientId', '==', clientId)
      .where('status', '==', 'approved');
    if (params.projectId) {
      coQuery = coQuery.where('projectId', '==', params.projectId);
    }
    const coSnap = await coQuery.get();
    coSnap.docs.forEach(d => {
      const co = d.data();
      (co.items || []).forEach((item: any) => {
        switch (item.type) {
          case 'material':
          case 'equipment':
            plannedMaterials += item.totalCost || 0;
            break;
          case 'labor':
            plannedLabor += item.totalCost || 0;
            break;
          case 'subcontract':
            plannedSubcontract += item.totalCost || 0;
            break;
          default:
            plannedMaterials += item.totalCost || 0;
        }
      });
      clientTotal += co.clientTotal || 0;
    });

    const plannedTotal = plannedMaterials + plannedLabor + plannedSubcontract;

    // ── ACTUAL: from costs + purchase_orders + work_sessions ──

    // 1. Legacy costs
    let costsQuery: admin.firestore.Query = db.collection('costs')
      .where('clientId', '==', clientId);
    const costsSnap = await costsQuery.get();

    let actualMaterials = 0;
    let actualSubcontract = 0;
    costsSnap.docs.forEach(d => {
      const c = d.data();
      const amt = Math.abs(c.amount || 0);
      if (c.category === 'reimbursement') return; // skip reimbursements
      actualMaterials += amt;
    });

    // 2. Purchase orders (new V4 — if any exist)
    let poQuery: admin.firestore.Query = db.collection(`companies/${companyId}/purchase_orders`)
      .where('clientId', '==', clientId)
      .where('status', 'in', ['approved', 'received']);
    if (params.projectId) {
      poQuery = poQuery.where('projectId', '==', params.projectId);
    }
    const poSnap = await poQuery.get();
    poSnap.docs.forEach(d => {
      const po = d.data();
      if (po.category === 'subcontract' || po.category === 'labor') {
        actualSubcontract += po.total || 0;
      } else {
        actualMaterials += po.total || 0;
      }
    });

    // 3. Work sessions → labor cost
    let sessionsQuery: admin.firestore.Query = db.collection('work_sessions')
      .where('clientId', '==', clientId)
      .where('status', '==', 'completed');
    const sessionsSnap = await sessionsQuery.get();

    let actualLabor = 0;
    sessionsSnap.docs.forEach(d => {
      const s = d.data();
      actualLabor += s.sessionEarnings || 0;
    });

    const actualTotal = actualMaterials + actualLabor + actualSubcontract;

    // ── VARIANCE ──
    const varianceMaterials = +(actualMaterials - plannedMaterials).toFixed(2);
    const varianceLabor = +(actualLabor - plannedLabor).toFixed(2);
    const varianceSubcontract = +(actualSubcontract - plannedSubcontract).toFixed(2);
    const varianceTotal = +(actualTotal - plannedTotal).toFixed(2);

    // ── MARGIN ──
    const plannedMargin = clientTotal > 0
      ? +(((clientTotal - plannedTotal) / clientTotal) * 100).toFixed(1) : 0;
    const actualMargin = clientTotal > 0
      ? +(((clientTotal - actualTotal) / clientTotal) * 100).toFixed(1) : 0;

    // ── ALERTS ──
    const alerts: string[] = [];
    const ALERT_THRESHOLD = 0.10; // 10%

    if (plannedMaterials > 0 && varianceMaterials > plannedMaterials * ALERT_THRESHOLD) {
      const pct = Math.round((varianceMaterials / plannedMaterials) * 100);
      alerts.push(`⚠️ Materials over budget by ${pct}%`);
    }
    if (plannedLabor > 0 && varianceLabor > plannedLabor * ALERT_THRESHOLD) {
      const pct = Math.round((varianceLabor / plannedLabor) * 100);
      alerts.push(`⚠️ Labor over budget by ${pct}%`);
    }
    if (plannedSubcontract > 0 && varianceSubcontract > plannedSubcontract * ALERT_THRESHOLD) {
      const pct = Math.round((varianceSubcontract / plannedSubcontract) * 100);
      alerts.push(`⚠️ Subcontract over budget by ${pct}%`);
    }
    if (plannedTotal > 0 && actualTotal > plannedTotal) {
      alerts.push(`🔴 Total expenses exceed plan by $${Math.abs(varianceTotal).toFixed(2)}`);
    }
    if (actualMargin < plannedMargin * 0.8 && plannedMargin > 0) {
      alerts.push(`📉 Actual margin (${actualMargin}%) significantly below planned (${plannedMargin}%)`);
    }
    if (plannedTotal === 0 && actualTotal > 0) {
      alerts.push(`ℹ️ No approved estimates found — showing actuals only`);
    }

    logger.info('📊 plan-vs-fact:result', {
      clientId,
      plannedTotal,
      actualTotal,
      varianceTotal,
      plannedMargin,
      actualMargin,
    });

    res.json({
      clientId,
      clientName,
      planned: {
        materials: +plannedMaterials.toFixed(2),
        labor: +plannedLabor.toFixed(2),
        subcontract: +plannedSubcontract.toFixed(2),
        total: +plannedTotal.toFixed(2),
      },
      actual: {
        materials: +actualMaterials.toFixed(2),
        labor: +actualLabor.toFixed(2),
        subcontract: +actualSubcontract.toFixed(2),
        total: +actualTotal.toFixed(2),
      },
      variance: {
        materials: varianceMaterials,
        labor: varianceLabor,
        subcontract: varianceSubcontract,
        total: varianceTotal,
      },
      margin: {
        planned: plannedMargin,
        actual: actualMargin,
      },
      alerts,
    });
  } catch (e) {
    next(e);
  }
});


export default router;
