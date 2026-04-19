/**
 * Client Card V2 endpoints — KPI aggregator + AI insights + favorites + quick note.
 *
 * Spec: docs/tasks/CLIENT_CARD_V2_SPEC.md §5.
 *
 * Endpoints:
 *   GET    /api/clients/:id/kpi                — aggregated KPI plashki
 *   GET    /api/clients/:id/insights           — Next Best Action (AI)
 *   POST   /api/clients/:id/recompute-metrics  — admin-only rebuild
 *   POST   /api/clients/:id/favorite           — add to current user's favorites
 *   DELETE /api/clients/:id/favorite           — remove
 *   POST   /api/clients/:id/quick-note         — append note
 */
import { Router } from 'express';
import * as admin from 'firebase-admin';

import { db, FieldValue, logger, logAgentActivity } from '../routeContext';
import { logAudit, AuditHelpers, extractAuditContext } from '../utils/auditLogger';
import { ClientMetricsService } from '../../services/clientMetricsService';

const router = Router();
const metricsService = new ClientMetricsService(db);

// ─── Helpers ────────────────────────────────────────────────────────

function requireManagerOrAbove(req: any, res: any): boolean {
  const role = req.effectiveRole || 'admin';
  if (role === 'worker' || role === 'driver') {
    res.status(403).json({ error: 'insufficient role', requiredRole: 'manager+' });
    return false;
  }
  return true;
}

// ─── GET /api/clients/:id/kpi ──────────────────────────────────────

router.get('/api/clients/:id/kpi', async (req, res, next) => {
  try {
    if (!requireManagerOrAbove(req, res)) return;

    const clientId = req.params.id;
    const clientSnap = await db.collection('clients').doc(clientId).get();
    if (!clientSnap.exists) {
      res.status(404).json({ error: 'client not found' });
      return;
    }
    const client = clientSnap.data()!;

    // Read materialized fields. If stale (>25h) or missing, recompute on the fly.
    const MAX_AGE_MS = 25 * 60 * 60 * 1000;
    const computedAtMs = client.computedAt?.toMillis?.() ?? 0;
    const stale = Date.now() - computedAtMs > MAX_AGE_MS;

    let ltv = client.ltv ?? client.totalRevenue ?? 0;
    let healthScore = client.healthScore ?? null;
    let churnRisk = client.churnRisk ?? 'low';
    let activeDealsCount = client.activeDealsCount ?? 0;
    let activeProjectsCount = client.activeProjectsCount ?? 0;
    let openOverdueTasks = client.openOverdueTasks ?? 0;
    let lastContactAt = client.lastContactAt ?? null;
    let computedAt = client.computedAt ?? null;

    if (stale) {
      try {
        const metrics = await metricsService.recomputeClientMetrics(clientId);
        await metricsService.writeMetricsToClient(clientId, metrics);
        ltv = metrics.ltv;
        healthScore = metrics.healthScore;
        churnRisk = metrics.churnRisk;
        activeDealsCount = metrics.activeDealsCount;
        activeProjectsCount = metrics.activeProjectsCount;
        openOverdueTasks = metrics.openOverdueTasks;
        lastContactAt = metrics.lastContactAt;
        computedAt = metrics.computedAt;
      } catch (e) {
        logger.warn('clientInsights:kpi lazy recompute failed', { clientId, error: String(e) });
      }
    }

    // Find nearest upcoming meeting for this client
    const nowTs = admin.firestore.Timestamp.now();
    const nextMeetingSnap = await db
      .collection('meetings')
      .where('clientId', '==', clientId)
      .where('startAt', '>=', nowTs)
      .orderBy('startAt', 'asc')
      .limit(1)
      .get();
    const nextMeeting = nextMeetingSnap.empty
      ? null
      : {
          id: nextMeetingSnap.docs[0].id,
          type: nextMeetingSnap.docs[0].data().type,
          startAt: nextMeetingSnap.docs[0].data().startAt?.toDate?.()?.toISOString() ?? null,
          daysUntil: Math.round(
            (nextMeetingSnap.docs[0].data().startAt.toMillis() - Date.now()) / 86_400_000,
          ),
        };

    const lastContactDays = lastContactAt
      ? Math.round((Date.now() - lastContactAt.toMillis()) / 86_400_000)
      : null;

    res.json({
      clientId,
      kpi: {
        balance: { value: client.balance ?? 0, trend: 0, trendPct: 0 },
        ltv: { value: ltv, trend: 0 },
        marginUsd: { value: client.totalMargin ?? 0, pct: null },
        activeDeals: { count: activeDealsCount, totalValue: 0 },
        activeProjects: { count: activeProjectsCount },
        openOverdueTasks: { count: openOverdueTasks, overdueDays: null },
        nextMeeting,
        lastContactDaysAgo: lastContactDays === null ? null : { days: lastContactDays, channel: null },
      },
      healthScore: healthScore === null ? null : { score: healthScore, trend: 0, band: bandOf(healthScore) },
      churnRisk: { level: churnRisk, reasons: [] },
      computedAt: computedAt?.toDate?.()?.toISOString() ?? null,
      stale,
    });
  } catch (e) {
    next(e);
  }
});

function bandOf(score: number): 'poor' | 'fair' | 'good' | 'excellent' {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

// ─── GET /api/clients/:id/insights ─────────────────────────────────

router.get('/api/clients/:id/insights', async (req, res, next) => {
  try {
    if (!requireManagerOrAbove(req, res)) return;

    const clientId = req.params.id;
    const nbaSnap = await db.collection('client_next_best_actions').doc(clientId).get();

    if (!nbaSnap.exists) {
      // No NBA yet — return a neutral default. The actual generation happens
      // in a nightly cron (functions/src/scheduled/clientInsightsCron.ts).
      res.json({
        clientId,
        nextBestAction: {
          suggestion: 'Недостаточно данных для рекомендации — повзаимодействуй с клиентом, чтобы AI собрал контекст',
          priority: 'low',
          reasoning: null,
          confidence: 0,
          computedAt: null,
        },
        relatedClients: [],
        aiSummary: null,
      });
      return;
    }

    const nba = nbaSnap.data()!;

    // Confidence gate: if confidence < 0.5, hide the suggestion rather than
    // showing low-quality output (spec open question #5 + UX audit 2026-04-19).
    const tooLowConfidence = (nba.confidence ?? 0) < 0.5;

    // Related clients — referer + referrals-by-this
    const clientSnap = await db.collection('clients').doc(clientId).get();
    const client = clientSnap.exists ? clientSnap.data() : null;
    const relatedClients: Array<{ id: string; name: string; relation: string; ltv: number }> = [];

    if (client?.referralByClientId) {
      const refererSnap = await db.collection('clients').doc(client.referralByClientId).get();
      if (refererSnap.exists) {
        const r = refererSnap.data()!;
        relatedClients.push({
          id: refererSnap.id,
          name: r.name,
          relation: 'referred_by',
          ltv: r.ltv ?? r.totalRevenue ?? 0,
        });
      }
    }

    res.json({
      clientId,
      nextBestAction: tooLowConfidence
        ? { suggestion: null, priority: 'low', reasoning: null, confidence: nba.confidence ?? 0, computedAt: nba.computedAt?.toDate?.()?.toISOString() ?? null }
        : {
            suggestion: nba.suggestion ?? null,
            priority: nba.priority ?? 'medium',
            reasoning: nba.reasoning ?? null,
            confidence: nba.confidence ?? 0,
            computedAt: nba.computedAt?.toDate?.()?.toISOString() ?? null,
          },
      relatedClients,
      aiSummary: nba.aiSummary ?? null,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/clients/:id/recompute-metrics ───────────────────────

router.post('/api/clients/:id/recompute-metrics', async (req, res, next) => {
  try {
    if ((req.effectiveRole || 'admin') !== 'admin') {
      res.status(403).json({ error: 'admin only' });
      return;
    }
    const clientId = req.params.id;

    const metrics = await metricsService.recomputeClientMetrics(clientId);
    await metricsService.writeMetricsToClient(clientId, metrics);

    logger.info('clientInsights:recompute', { clientId, healthScore: metrics.healthScore });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'client_metrics_recomputed',
      endpoint: `/api/clients/${clientId}/recompute-metrics`,
      metadata: { clientId, healthScore: metrics.healthScore, churnRisk: metrics.churnRisk },
    });

    res.json({
      clientId,
      recomputed: true,
      healthScore: metrics.healthScore,
      churnRisk: metrics.churnRisk,
      ltv: metrics.ltv,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/clients/:id/favorite ────────────────────────────────

router.post('/api/clients/:id/favorite', async (req, res, next) => {
  try {
    const clientId = req.params.id;
    const userId = req.effectiveUserId || req.agentUserId;
    if (!userId) {
      res.status(401).json({ error: 'user required' });
      return;
    }
    const favId = `${userId}_${clientId}`;
    await db.collection('client_favorites').doc(favId).set({
      userId,
      clientId,
      addedAt: FieldValue.serverTimestamp(),
    });
    res.json({ clientId, favorited: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/api/clients/:id/favorite', async (req, res, next) => {
  try {
    const clientId = req.params.id;
    const userId = req.effectiveUserId || req.agentUserId;
    if (!userId) {
      res.status(401).json({ error: 'user required' });
      return;
    }
    const favId = `${userId}_${clientId}`;
    await db.collection('client_favorites').doc(favId).delete();
    res.json({ clientId, favorited: false });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/clients/:id/quick-note ──────────────────────────────

router.post('/api/clients/:id/quick-note', async (req, res, next) => {
  try {
    if (!requireManagerOrAbove(req, res)) return;

    const clientId = req.params.id;
    const note = String(req.body.note ?? '').trim();
    if (!note) {
      res.status(400).json({ error: 'note text required' });
      return;
    }

    const auditCtx = extractAuditContext(req);
    const entry = {
      note,
      createdBy: auditCtx.performedBy,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await db
      .collection('clients')
      .doc(clientId)
      .update({
        notesHistory: FieldValue.arrayUnion(entry),
        updatedAt: FieldValue.serverTimestamp(),
      });

    await logAudit(
      AuditHelpers.create('client_quick_note', clientId, { preview: note.slice(0, 80) }, auditCtx.performedBy, auditCtx.source as never),
    );

    res.json({ clientId, added: true });
  } catch (e) {
    next(e);
  }
});

export default router;
