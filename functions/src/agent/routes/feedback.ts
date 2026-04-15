/**
 * Agent Feedback Routes — bug reports, suggestions, error logs from AI agents
 *
 * POST /api/agent-feedback          Create a feedback entry
 * GET  /api/agent-feedback/list     List recent feedback entries
 */
import { Router } from 'express';
import { db, FieldValue, logger } from '../routeContext';
import { z } from 'zod';

const router = Router();

const FeedbackSchema = z.object({
  type: z.enum(['bug', 'error', 'suggestion', 'info']).default('bug'),
  endpoint: z.string().optional(),
  message: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  httpStatus: z.number().optional(),
  requestPayload: z.any().optional(),
  responseSnippet: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const ListFeedbackSchema = z.object({
  type: z.string().optional(),
  severity: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── POST /api/agent-feedback ──────────────────────────────────────

router.post('/api/agent-feedback', async (req, res, next) => {
  try {
    const data = FeedbackSchema.parse(req.body);

    const entry = {
      ...data,
      source: 'openclaw',
      userId: req.agentUserId || null,
      createdAt: FieldValue.serverTimestamp(),
      status: 'new',
    };

    const docRef = await db.collection('agent_feedbacks').add(entry);

    logger.info('📬 agent-feedback:created', {
      id: docRef.id,
      type: data.type,
      severity: data.severity,
      endpoint: data.endpoint,
      message: data.message.substring(0, 200),
    });

    res.status(201).json({
      id: docRef.id,
      message: 'Feedback received. Thank you!',
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/agent-feedback/list ──────────────────────────────────

router.get('/api/agent-feedback/list', async (req, res, next) => {
  try {
    const params = ListFeedbackSchema.parse(req.query);

    let q: FirebaseFirestore.Query = db.collection('agent_feedbacks');

    // ── RLS: restrict non-admins to own feedback ──
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    if (rlsRole === 'worker' || rlsRole === 'driver' || rlsRole === 'foreman') {
      q = q.where('userId', '==', rlsUserId);
    }

    if (params.type) {
      q = q.where('type', '==', params.type);
    }
    if (params.severity) {
      q = q.where('severity', '==', params.severity);
    }

    q = q.orderBy('createdAt', 'desc');

    if (params.offset > 0) {
      q = q.offset(params.offset);
    }
    q = q.limit(params.limit);

    const snap = await q.get();
    const items = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
    }));

    res.json({
      items,
      total: items.length,
      limit: params.limit,
      offset: params.offset,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
