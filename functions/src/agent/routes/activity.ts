/**
 * Activity Routes — read-only access to agent_activity log
 */
import { Router } from 'express';
import { db, Timestamp, logger } from '../routeContext';
import { z } from 'zod';

const router = Router();

const ListActivityQuerySchema = z.object({
  action: z.string().optional(),
  userId: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── GET /api/activity/list ───────────────────────────────────────

router.get('/api/activity/list', async (req, res, next) => {
  try {
    const params = ListActivityQuerySchema.parse(req.query);
    logger.info('📊 activity:list', { action: params.action, limit: params.limit });

    let q: FirebaseFirestore.Query = db.collection('agent_activity');

    if (params.action) {
      q = q.where('action', '==', params.action);
    }
    if (params.userId) {
      q = q.where('userId', '==', params.userId);
    }

    // Date range filters
    if (params.from) {
      q = q.where('createdAt', '>=', Timestamp.fromDate(new Date(params.from)));
    }
    if (params.to) {
      q = q.where('createdAt', '<=', Timestamp.fromDate(new Date(params.to)));
    }

    q = q.orderBy('createdAt', 'desc');

    // Count total before pagination
    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    // Apply pagination
    if (params.offset > 0) {
      q = q.offset(params.offset);
    }
    q = q.limit(params.limit);

    const snap = await q.get();
    const activities = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        userId: data.userId || null,
        action: data.action || null,
        endpoint: data.endpoint || null,
        metadata: data.metadata || {},
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({
      activities,
      count: activities.length,
      total,
      hasMore: params.offset + activities.length < total,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
