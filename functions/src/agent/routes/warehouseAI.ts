/**
 * Warehouse AI Routes — pre-trip planner + session management
 *
 * POST /api/warehouse-ai/plan-trip
 * GET  /api/warehouse-ai/sessions/:userId
 * POST /api/warehouse-ai/sessions/:userId/confirm
 * POST /api/warehouse-ai/sessions/:userId/cancel
 *
 * All reads are persisted to warehouse_ai_sessions (document per user).
 * All events go to warehouse_ai_events.
 *
 * Agent tool surface: see docs/tasks/WAREHOUSE_AI_SPEC.md §12.
 */

import { Router } from 'express';
import { z } from 'zod';
import { db, logger, logAgentActivity } from '../routeContext';
import { planTrip, confirmTrip, cancelTrip } from '../../services/warehouseAI';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
//  Zod schemas
// ═══════════════════════════════════════════════════════════════════

const PlanTripSchema = z.object({
  userId: z.string().min(1),
  text: z.string().min(1).max(4000),
  currentLocationId: z.string().optional(),
});

const UserIdParam = z.object({ userId: z.string().min(1) });

const TripIdBody = z.object({ tripId: z.string().min(1) });

// ═══════════════════════════════════════════════════════════════════
//  Routes
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/warehouse-ai/plan-trip ──────────────────────────────

router.post('/api/warehouse-ai/plan-trip', async (req, res, next) => {
  try {
    const data = PlanTripSchema.parse(req.body);
    logger.info('🧠 warehouseAI:plan-trip', { userId: data.userId, textLen: data.text.length });

    const plan = await planTrip(db, {
      userId: data.userId,
      text: data.text,
      currentLocationId: data.currentLocationId,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_ai_plan_trip',
      endpoint: '/api/warehouse-ai/plan-trip',
      metadata: {
        targetUserId: data.userId,
        tripId: plan.tripId,
        taskCount: plan.parsedTasks.length,
        itemCount: plan.proposedItems.length,
        estimatedTotal: plan.estimatedTotal || 0,
      },
    });

    res.status(200).json({ plan });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/warehouse-ai/sessions/:userId ────────────────────────

router.get('/api/warehouse-ai/sessions/:userId', async (req, res, next) => {
  try {
    const { userId } = UserIdParam.parse(req.params);
    const snap = await db.collection('warehouse_ai_sessions').doc(userId).get();
    if (!snap.exists) {
      res.status(200).json({ activeTrip: null, recentTripIds: [] });
      return;
    }
    const data = snap.data() as any;
    res.status(200).json({
      activeTrip: data?.activeTrip || null,
      recentTripIds: Array.isArray(data?.recentTripIds) ? data.recentTripIds : [],
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/warehouse-ai/sessions/:userId/confirm ───────────────

router.post('/api/warehouse-ai/sessions/:userId/confirm', async (req, res, next) => {
  try {
    const { userId } = UserIdParam.parse(req.params);
    const { tripId } = TripIdBody.parse(req.body);
    const result = await confirmTrip(db, userId, tripId);
    if (result.status === 'not_found') {
      res.status(404).json({ error: 'trip_not_found' });
      return;
    }
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_ai_confirm_trip',
      endpoint: `/api/warehouse-ai/sessions/${userId}/confirm`,
      metadata: { targetUserId: userId, tripId },
    });
    res.status(200).json({ status: 'confirmed', tripId });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/warehouse-ai/sessions/:userId/cancel ────────────────

router.post('/api/warehouse-ai/sessions/:userId/cancel', async (req, res, next) => {
  try {
    const { userId } = UserIdParam.parse(req.params);
    const { tripId } = TripIdBody.parse(req.body);
    const result = await cancelTrip(db, userId, tripId);
    if (result.status === 'not_found') {
      res.status(404).json({ error: 'trip_not_found' });
      return;
    }
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'warehouse_ai_cancel_trip',
      endpoint: `/api/warehouse-ai/sessions/${userId}/cancel`,
      metadata: { targetUserId: userId, tripId },
    });
    res.status(200).json({ status: 'cancelled', tripId });
  } catch (e) {
    next(e);
  }
});

export default router;
