/**
 * Warehouse AI capability routes.
 *
 * Three thin endpoints that load Firestore context, delegate to the pure
 * capability function, and return the proposal. The capability does NOT
 * write to Firestore — the caller (UI / Telegram bot) shows the proposal,
 * gets user confirmation, then POSTs /api/warehouse/documents with the
 * `draftPayload` from the response.
 *
 * Endpoints:
 *   POST /api/warehouse/agent/parse-on-site        UC1
 *   POST /api/warehouse/agent/parse-receipt        UC2
 *   POST /api/warehouse/agent/propose-writeoff     UC3
 */

import { Router } from 'express';
import { z } from 'zod';
import { db, logger, logAgentActivity } from '../../../agent/routeContext';
import {
  parseOnSiteInventory,
  parseReceipt,
  proposeTaskWriteoff,
  buildProcurementPlan,
  buildReservationDrafts,
} from '../../agent';
import {
  loadCatalog,
  loadCatalogFull,
  loadClients,
  loadVendors,
  loadVendorsFull,
  loadWriteoffContext,
  loadBalancesForItems,
} from '../loaders';
import { wrapRoute } from '../errorHandler';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
//  Schemas
// ═══════════════════════════════════════════════════════════════════

const ParseOnSiteSchema = z
  .object({
    userId: z.string().min(1),
    text: z.string().min(1).max(4000),
  })
  .strict();

const ParseReceiptSchema = z
  .object({
    userId: z.string().min(1),
    imageBase64: z.string().min(1),
    imageMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
    photoHash: z.string().optional(),
    targetLocationId: z.string().optional(),
    activeProjectId: z.string().optional(),
    activePhaseCode: z.string().optional(),
  })
  .strict();

const ProposeWriteoffSchema = z
  .object({
    taskId: z.string().min(1),
    templateType: z.string().min(1),
    taskQty: z.number().positive(),
    workerId: z.string().min(1),
    locationId: z.string().min(1),
    projectId: z.string().optional(),
    phaseCode: z.string().optional(),
  })
  .strict();

const ProcurementPlanSchema = z
  .object({
    estimateId: z.string().min(1),
    projectId: z.string().min(1),
    destinationLocationId: z.string().optional(),
    estimateLines: z
      .array(
        z
          .object({
            id: z.string().min(1),
            itemHint: z.string().min(1),
            qty: z.number().positive(),
            unit: z.string().min(1),
            unitCost: z.number().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    buildReservationDrafts: z.boolean().optional(),
    reservationDays: z.number().positive().optional(),
  })
  .strict();

// ═══════════════════════════════════════════════════════════════════
//  POST /api/warehouse/agent/parse-on-site
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/api/warehouse/agent/parse-on-site',
  wrapRoute(async (req, res) => {
    const data = ParseOnSiteSchema.parse(req.body);

    const [catalog, clients] = await Promise.all([loadCatalog(db), loadClients(db)]);

    const result = await parseOnSiteInventory({
      userId: data.userId,
      text: data.text,
      catalog,
      clients,
    });

    logger.info('🏭 warehouse:agent.parse-on-site', {
      userId: data.userId,
      ok: result.ok,
      reason: (result as any).reason,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_ai_parse_on_site',
      endpoint: '/api/warehouse/agent/parse-on-site',
      metadata: {
        targetUserId: data.userId,
        ok: result.ok,
        itemCount: result.ok ? result.items.length : 0,
        reason: (result as any).reason,
      },
    });

    res.status(200).json(result);
  }),
);

// ═══════════════════════════════════════════════════════════════════
//  POST /api/warehouse/agent/parse-receipt
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/api/warehouse/agent/parse-receipt',
  wrapRoute(async (req, res) => {
    const data = ParseReceiptSchema.parse(req.body);

    const [catalog, vendors] = await Promise.all([loadCatalog(db), loadVendors(db)]);

    const result = await parseReceipt({
      userId: data.userId,
      imageBase64: data.imageBase64,
      imageMimeType: data.imageMimeType,
      photoHash: data.photoHash,
      targetLocationId: data.targetLocationId,
      activeProjectId: data.activeProjectId,
      activePhaseCode: data.activePhaseCode,
      catalog,
      vendors,
    });

    logger.info('🏭 warehouse:agent.parse-receipt', {
      userId: data.userId,
      ok: result.ok,
      reason: (result as any).reason,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_ai_parse_receipt',
      endpoint: '/api/warehouse/agent/parse-receipt',
      metadata: {
        targetUserId: data.userId,
        ok: result.ok,
        itemCount: result.ok ? result.items.length : 0,
        vendor: result.ok ? result.vendor.name : null,
        reason: (result as any).reason,
      },
    });

    res.status(200).json(result);
  }),
);

// ═══════════════════════════════════════════════════════════════════
//  POST /api/warehouse/agent/propose-writeoff
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
//  POST /api/warehouse/agent/procurement-plan   (UC4)
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/api/warehouse/agent/procurement-plan',
  wrapRoute(async (req, res) => {
    const data = ProcurementPlanSchema.parse(req.body);

    const [catalog, vendors] = await Promise.all([loadCatalogFull(db), loadVendorsFull(db)]);
    const balances = await loadBalancesForItems(
      db,
      catalog.map((i) => i.id),
    );

    const plan = buildProcurementPlan({
      estimateId: data.estimateId,
      projectId: data.projectId,
      estimateLines: data.estimateLines,
      catalog,
      balances,
      vendors,
    });

    const reservationDrafts = data.buildReservationDrafts && data.destinationLocationId
      ? buildReservationDrafts(plan, {
          destinationLocationId: data.destinationLocationId,
          catalog,
          reservationDays: data.reservationDays ?? 7,
        })
      : [];

    logger.info('🏭 warehouse:agent.procurement-plan', {
      estimateId: data.estimateId,
      projectId: data.projectId,
      lineCount: data.estimateLines.length,
      internalAllocationCount: plan.buckets.internalAllocation.length,
      buyFromVendorCount: plan.buckets.buyFromVendor.length,
      needsQuoteCount: plan.buckets.needsQuote.length,
      needsWebSearchCount: plan.buckets.needsWebSearch.length,
      reservationDraftCount: reservationDrafts.length,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_ai_procurement_plan',
      endpoint: '/api/warehouse/agent/procurement-plan',
      metadata: {
        estimateId: data.estimateId,
        projectId: data.projectId,
        lineCount: data.estimateLines.length,
        totalEstimateValue: plan.summary.totalEstimateValue,
        internallyAllocatedValue: plan.summary.internallyAllocatedValue,
        externalPurchaseValue: plan.summary.externalPurchaseValue,
        allInternallyAvailable: plan.summary.allInternallyAvailable,
      },
    });

    res.status(200).json({ plan, reservationDrafts });
  }),
);

router.post(
  '/api/warehouse/agent/propose-writeoff',
  wrapRoute(async (req, res) => {
    const data = ProposeWriteoffSchema.parse(req.body);

    const ctx = await loadWriteoffContext(db, {
      taskType: data.templateType,
      locationId: data.locationId,
    });

    const result = proposeTaskWriteoff({
      taskId: data.taskId,
      templateType: data.templateType,
      taskQty: data.taskQty,
      workerId: data.workerId,
      locationId: data.locationId,
      projectId: data.projectId,
      phaseCode: data.phaseCode,
      norms: ctx.norm ? [ctx.norm] : [],
      items: ctx.items,
      balances: ctx.balances,
    });

    logger.info('🏭 warehouse:agent.propose-writeoff', {
      taskId: data.taskId,
      templateType: data.templateType,
      ok: result.ok,
      reason: (result as any).reason,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_ai_propose_writeoff',
      endpoint: '/api/warehouse/agent/propose-writeoff',
      metadata: {
        taskId: data.taskId,
        templateType: data.templateType,
        ok: result.ok,
        lineCount: result.ok ? result.lines.length : 0,
        totalEstimatedCost: result.ok ? result.totalEstimatedCost : 0,
        hasAnyShortfall: result.ok ? result.hasAnyShortfall : false,
      },
    });

    res.status(200).json(result);
  }),
);

export default router;
